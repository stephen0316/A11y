import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { collectDomSignals } from './signals.js';
import { runKeyboardAudit } from './keyboard.js';
import { buildIssues } from './rules.js';
import { renderMarkdownReport } from './report.js';
import { nowStamp, slugify } from './utils.js';
import { runAiAudit } from './ai/gemini.js';

const WCAG_22_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
];

export async function runTargetAudit(page, target, options = {}) {
  await page.goto(target.url, { waitUntil: 'networkidle' });
  const scenarioExecution = await runScenarioSteps(page, target.steps);

  const stamp = nowStamp();
  const runName = `${slugify(target.name)}-${stamp}`;
  const targetDir = path.resolve(options.outDir || 'reports', runName);
  await mkdir(targetDir, { recursive: true });

  const screenshotPath = path.join(targetDir, 'screenshot.png');
  const domPath = path.join(targetDir, 'dom-snapshot.html');
  const axTreePath = path.join(targetDir, 'accessibility-tree.json');
  const jsonPath = path.join(targetDir, 'audit.json');
  const reportPath = path.join(targetDir, 'report.md');

  await page.screenshot({ path: screenshotPath, fullPage: true });
  const domHtml = await page.content();
  await writeFile(domPath, domHtml, 'utf8');

  const axe = await new AxeBuilder({ page })
    .withTags(WCAG_22_AA_TAGS)
    .analyze();
  await attachAxeNodeRects(page, axe);
  const domSignals = await collectDomSignals(page);
  const keyboard = await runKeyboardAudit(page, {
    maxTabs: options.maxTabs || 30,
  });
  const accessibilityTree = await collectAccessibilityTree(page);
  await writeFile(axTreePath, JSON.stringify(accessibilityTree, null, 2), 'utf8');

  const issues = buildIssues({
    target,
    axe,
    domSignals,
    keyboard,
  });
  const ai = await runAiAudit({
    target,
    axe,
    domSignals,
    keyboard,
    accessibilityTree,
    issues,
  }, options.ai || {});

  const audit = {
    meta: {
      generatedAt: new Date().toISOString(),
      baseline: 'WCAG 2.2 AA',
      target,
      taskConclusion: buildTaskConclusion({
        target,
        issues,
        scenarioExecution,
        finalUrl: page.url(),
      }),
      artifacts: {
        screenshot: 'screenshot.png',
        domSnapshot: 'dom-snapshot.html',
        accessibilityTree: 'accessibility-tree.json',
      },
    },
    summary: summarizeIssues(issues),
    axe,
    domSignals,
    keyboard,
    ai,
    issues,
  };

  await writeFile(jsonPath, JSON.stringify(audit, null, 2), 'utf8');
  await writeFile(reportPath, renderMarkdownReport(audit), 'utf8');

  return {
    target: target.name,
    reportPath,
    jsonPath,
    screenshotPath,
  };
}

async function runScenarioSteps(page, steps = []) {
  const log = [];
  for (const step of steps) {
    const startedAt = Date.now();
    if (step.action === 'fill') {
      await fillStep(page, step);
    } else if (step.action === 'click') {
      await clickStep(page, step);
    } else if (step.action === 'press') {
      await page.keyboard.press(step.key);
    } else if (step.action === 'waitForSelector') {
      await waitForSelectorStep(page, step);
    } else if (step.action === 'wait') {
      await page.waitForTimeout(step.ms || 1000);
    } else {
      throw new Error(`Unsupported scenario step action: ${step.action}`);
    }
    log.push({
      action: step.action,
      description: step.description || '',
      selector: step.selector || '',
      elapsedMs: Date.now() - startedAt,
    });
  }
  return log;
}

async function fillStep(page, step) {
  const selectors = selectorCandidates(step);
  for (const selector of selectors) {
    try {
      await page.fill(selector, step.value || '', { timeout: step.timeout || 5000 });
      return;
    } catch {
      // Try the next candidate.
    }
  }

  if (step.label) {
    try {
      await page.getByLabel(step.label).fill(step.value || '', { timeout: step.timeout || 5000 });
      return;
    } catch {
      // Continue to the final error.
    }
  }

  throw new Error(`Unable to fill step: ${step.description || step.selector || step.label || 'unknown field'}`);
}

async function clickStep(page, step) {
  const selectors = selectorCandidates(step);
  for (const selector of selectors) {
    try {
      await page.click(selector, { timeout: step.timeout || 5000 });
      return;
    } catch {
      // Try the next candidate.
    }
  }

  if (step.role && step.name) {
    try {
      await page.getByRole(step.role, { name: step.name }).click({ timeout: step.timeout || 5000 });
      return;
    } catch {
      // Continue to text fallback.
    }
  }

  if (step.text || step.name) {
    try {
      await page.getByText(step.text || step.name).first().click({ timeout: step.timeout || 5000 });
      return;
    } catch {
      // Continue to the final error.
    }
  }

  throw new Error(`Unable to click step: ${step.description || step.selector || step.name || 'unknown control'}`);
}

async function waitForSelectorStep(page, step) {
  const selectors = selectorCandidates(step);
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: step.timeout || 5000 });
      return;
    } catch {
      // Try the next candidate.
    }
  }

  if (step.text || step.name) {
    try {
      await page.getByText(step.text || step.name).first().waitFor({ timeout: step.timeout || 5000 });
      return;
    } catch {
      // Continue to the final error.
    }
  }

  throw new Error(`Unable to wait for step: ${step.description || step.selector || step.text || 'unknown target'}`);
}

function selectorCandidates(step) {
  return Array.from(new Set([
    step.selector,
    ...(Array.isArray(step.selectors) ? step.selectors : []),
  ].filter(Boolean).map(String)));
}

function buildTaskConclusion({ target, issues, scenarioExecution, finalUrl }) {
  if (!target.task && !scenarioExecution.length) {
    return null;
  }

  const blockerCount = issues.filter((issue) => issue.severity === 'Blocker').length;
  const majorCount = issues.filter((issue) => issue.severity === 'Major').length;
  const status = blockerCount ? 'blocked' : majorCount ? 'needs-fix' : 'pass-with-review';
  const label = {
    blocked: '任务未通过',
    'needs-fix': '任务需修复后通过',
    'pass-with-review': '任务可通过，建议人工抽样复核',
  }[status];

  return {
    task: target.task || target.stepPlan?.task || '',
    status,
    label,
    verdict: buildTaskVerdict({ blockerCount, majorCount, stepCount: scenarioExecution.length }),
    generatedBy: target.stepPlan?.provider || 'manual',
    confidence: target.stepPlan?.confidence || 'medium',
    assumptions: target.stepPlan?.assumptions || [],
    warnings: target.stepPlan?.warnings || [],
    steps: scenarioExecution,
    finalUrl,
  };
}

function buildTaskVerdict({ blockerCount, majorCount, stepCount }) {
  const prefix = stepCount
    ? `已自动执行 ${stepCount} 个任务步骤并在最终状态完成走查。`
    : '未执行前置任务步骤，已直接走查目标页面。';

  if (blockerCount) {
    return `${prefix} 当前存在 ${blockerCount} 个阻断级问题，不建议验收通过。`;
  }
  if (majorCount) {
    return `${prefix} 当前存在 ${majorCount} 个严重问题，需要修复后再验收。`;
  }
  return `${prefix} 自动规则未发现阻断或严重问题，但仍建议对读屏朗读和真实业务语境做人工抽样。`;
}

async function attachAxeNodeRects(page, axe) {
  const nodes = (axe.violations || []).flatMap((violation) => violation.nodes || []);
  await Promise.all(nodes.map(async (node) => {
    node.rect = await rectForAxeTarget(page, node.target);
  }));
}

async function rectForAxeTarget(page, target) {
  return page.evaluate((targetValue) => {
    const selectors = Array.isArray(targetValue) ? targetValue.flat(Infinity) : [targetValue];
    for (const selector of selectors) {
      try {
        const element = document.querySelector(String(selector));
        if (!element) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          continue;
        }
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          pageX: Math.round(rect.x + window.scrollX),
          pageY: Math.round(rect.y + window.scrollY),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      } catch {
        // Some axe targets can represent shadow paths or generated selectors.
      }
    }
    return null;
  }, target).catch(() => null);
}

async function collectAccessibilityTree(page) {
  if (page.accessibility?.snapshot) {
    return page.accessibility.snapshot({ interestingOnly: false });
  }

  try {
    const client = await page.context().newCDPSession(page);
    await client.send('Accessibility.enable');
    const tree = await client.send('Accessibility.getFullAXTree');
    await client.detach();
    return tree;
  } catch (error) {
    return {
      unavailable: true,
      reason: error.message,
    };
  }
}

function summarizeIssues(issues) {
  return issues.reduce(
    (summary, issue) => {
      summary.total += 1;
      summary.bySeverity[issue.severity] = (summary.bySeverity[issue.severity] || 0) + 1;
      summary.byTier[issue.tier] = (summary.byTier[issue.tier] || 0) + 1;
      return summary;
    },
    {
      total: 0,
      bySeverity: {},
      byTier: {},
    },
  );
}
