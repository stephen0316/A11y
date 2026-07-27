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
  const stamp = nowStamp();
  const timings = createAuditTimings();
  const runName = `${slugify(target.name)}-${stamp}`;
  const targetDir = path.resolve(options.outDir || 'reports', runName);
  await timePhase(timings, 'prepare', () => mkdir(targetDir, { recursive: true }));

  await timePhase(timings, 'navigate', () => page.goto(target.url, { waitUntil: 'networkidle' }));
  const flowSnapshots = [];
  const scenarioExecution = await timePhase(timings, 'scenario', () => runScenarioSteps(page, target.steps, {
    onAfterStep: async ({ step, index, entry, stateFingerprint, navigated }) => {
      const snapshot = await timePhase(timings, 'scenarioSnapshots', () => collectFlowStepSnapshot(page, {
        target,
        step,
        index,
        entry,
        stateFingerprint,
        navigated,
        maxTabs: options.maxTabs || 30,
        targetDir,
      }));
      flowSnapshots.push(snapshot);
      return {
        issueCount: snapshot.summary.total,
        bySeverity: snapshot.summary.bySeverity,
      };
    },
  }));

  const screenshotPath = path.join(targetDir, 'screenshot.png');
  const domPath = path.join(targetDir, 'dom-snapshot.html');
  const axTreePath = path.join(targetDir, 'accessibility-tree.json');
  const jsonPath = path.join(targetDir, 'audit.json');
  const reportPath = path.join(targetDir, 'report.md');

  await timePhase(timings, 'screenshot', () => takeStableScreenshot(page, screenshotPath));
  const domHtml = await timePhase(timings, 'domSnapshot', () => page.content());
  await timePhase(timings, 'writeDomSnapshot', () => writeFile(domPath, domHtml, 'utf8'));
  // Capture before keyboard traversal changes focus, so final-state matching
  // compares the same visual and semantic state as the task-step snapshot.
  const finalStateFingerprint = flowStateFingerprint(await timePhase(timings, 'finalStateFingerprint', () => captureFlowState(page)));

  const {
    axe,
    domSignals,
    keyboard,
  } = await timePhase(timings, 'finalAuditState', () => collectAuditState(page, {
    maxTabs: options.maxTabs || 30,
    includeKeyboard: true,
    timings,
    prefix: 'finalAudit',
  }));
  const accessibilityTree = await timePhase(timings, 'accessibilityTree', () => collectAccessibilityTree(page));
  await timePhase(timings, 'writeAccessibilityTree', () => writeFile(axTreePath, JSON.stringify(accessibilityTree, null, 2), 'utf8'));

  const finalIssues = await timePhase(timings, 'buildIssues', () => buildIssues({
    target,
    axe,
    domSignals,
    keyboard,
  }));
  const finalStateResult = await timePhase(timings, 'mergeFlowState', () => mergeFinalAuditIntoFlowState({
    flowSnapshots,
    finalIssues,
    finalStateFingerprint,
    finalUrl: page.url(),
  }));
  const issues = finalStateResult.issues;
  const ai = await timePhase(timings, 'ai', () => runAiAudit({
    target,
    axe,
    domSignals,
    keyboard,
    accessibilityTree,
    issues,
    flowSnapshots,
  }, options.ai || {}));
  const finishedTimings = finishAuditTimings(timings);

  const audit = {
    meta: {
      generatedAt: new Date().toISOString(),
      baseline: 'WCAG 2.2 AA',
      target,
      taskConclusion: buildTaskConclusion({
        target,
        issues,
        scenarioExecution,
        flowSnapshots,
        finalUrl: page.url(),
        finalStateMergedIntoStep: finalStateResult.mergedIntoStep,
        finalStateMergeReason: finalStateResult.mergeReason,
      }),
      artifacts: {
        screenshot: 'screenshot.png',
        flowScreenshots: flowSnapshots
          .filter((snapshot) => snapshot.screenshot)
          .map((snapshot) => ({
            index: snapshot.index,
            screenshot: snapshot.screenshot,
          })),
        domSnapshot: 'dom-snapshot.html',
        accessibilityTree: 'accessibility-tree.json',
      },
      timings: finishedTimings,
    },
    summary: summarizeIssues(issues),
    axe,
    domSignals,
    keyboard,
    ai,
    issues,
  };

  await timePhase(timings, 'writeAuditJson', () => writeFile(jsonPath, JSON.stringify(audit, null, 2), 'utf8'));
  await timePhase(timings, 'writeMarkdownReport', () => writeFile(reportPath, renderMarkdownReport(audit), 'utf8'));
  console.info('audit timings', JSON.stringify({
    target: target.name,
    url: target.url,
    totalMs: finishedTimings.totalMs,
    phases: finishedTimings.phases,
    issueCount: issues.length,
    aiStatus: ai.status,
    aiModel: ai.model,
    attemptedModels: ai.attemptedModels,
  }));

  return {
    target: target.name,
    reportPath,
    jsonPath,
    screenshotPath,
  };
}

function createAuditTimings() {
  return {
    startedAt: Date.now(),
    phases: {},
  };
}

async function timePhase(timings, phase, task) {
  const startedAt = Date.now();
  try {
    return await task();
  } finally {
    timings.phases[phase] = (timings.phases[phase] || 0) + Date.now() - startedAt;
  }
}

function finishAuditTimings(timings) {
  return {
    totalMs: Date.now() - timings.startedAt,
    phases: Object.fromEntries(
      Object.entries(timings.phases).sort(([, a], [, b]) => b - a),
    ),
  };
}

export async function runScenarioSteps(page, steps = [], options = {}) {
  const log = [];
  let previousState = await captureFlowState(page);
  let lastChangedStep = null;

  for (const [index, step] of steps.entries()) {
    const startedAt = Date.now();
    if (step.action === 'fill') {
      await fillStep(page, step);
    } else if (step.action === 'hover') {
      await hoverStep(page, step);
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
    const entry = {
      action: step.action,
      description: step.description || '',
      selector: step.selector || '',
      elapsedMs: Date.now() - startedAt,
    };

    await settleScenarioState(page);
    const currentState = await captureFlowState(page);
    const stateChanged = flowStateFingerprint(currentState) !== flowStateFingerprint(previousState);
    const navigated = comparableUrl(currentState.url) !== comparableUrl(previousState.url);

    if (stateChanged) {
      const sample = options.onAfterStep
        ? await options.onAfterStep({
          step,
          index,
          entry,
          stateFingerprint: flowStateFingerprint(currentState),
          navigated,
        })
        : {};
      entry.auditSample = {
        ...sample,
        stateChanged: true,
        navigated,
      };
      lastChangedStep = index + 1;
    } else {
      entry.auditSample = {
        stateChanged: false,
        navigated: false,
        reusedFromStep: lastChangedStep,
      };
    }

    previousState = currentState;
    log.push(entry);
  }
  return log;
}

async function settleScenarioState(page) {
  if (typeof page.waitForLoadState === 'function') {
    await page.waitForLoadState('domcontentloaded', { timeout: 2000 }).catch(() => {});
  }
  await waitForVisualStability(page);
}

/**
 * Wait for the browser to finish the visual work that is not covered by
 * DOMContentLoaded: web fonts, in-document images and a stable layout over
 * consecutive animation frames. This deliberately does not dismiss dialogs,
 * menus or other task-created overlays: they are legitimate page states.
 */
export async function waitForVisualStability(page, { timeout = 6000 } = {}) {
  if (typeof page.evaluate === 'function') {
    await page.evaluate(async ({ timeoutMs }) => {
      const wait = (promise, limit) => Promise.race([
        Promise.resolve(promise).catch(() => {}),
        new Promise((resolve) => window.setTimeout(resolve, limit)),
      ]);
      const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const remaining = (startedAt) => Math.max(0, timeoutMs - (Date.now() - startedAt));
      const startedAt = Date.now();

      if (document.fonts?.ready) {
        await wait(document.fonts.ready, remaining(startedAt));
      }

      const images = Array.from(document.images || []);
      await wait(Promise.all(images.map(async (image) => {
        if (!image.complete) {
          await new Promise((resolve) => {
            const finish = () => {
              image.removeEventListener('load', finish);
              image.removeEventListener('error', finish);
              resolve();
            };
            image.addEventListener('load', finish, { once: true });
            image.addEventListener('error', finish, { once: true });
            window.setTimeout(finish, remaining(startedAt));
          });
        }
        if (typeof image.decode === 'function' && image.complete && image.naturalWidth > 0) {
          await image.decode().catch(() => {});
        }
      })), remaining(startedAt));

      const layoutFingerprint = () => {
        const root = document.documentElement;
        const body = document.body;
        const viewport = window.visualViewport;
        return [
          root.scrollWidth,
          root.scrollHeight,
          root.clientWidth,
          root.clientHeight,
          body?.scrollWidth || 0,
          body?.scrollHeight || 0,
          viewport?.width || window.innerWidth,
          viewport?.height || window.innerHeight,
        ].join(':');
      };

      let previous = '';
      let stableFrames = 0;
      while (remaining(startedAt) > 0 && stableFrames < 2) {
        await frame();
        const current = layoutFingerprint();
        stableFrames = current === previous ? stableFrames + 1 : 0;
        previous = current;
      }
    }, { timeoutMs: timeout }).catch(() => {});
  }

  // Give the compositor a final chance to paint after the last stable frame.
  if (typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(120);
  }
}

async function takeStableScreenshot(page, screenshotPath) {
  await waitForVisualStability(page);
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
}

async function captureFlowState(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && Number(style.opacity || '1') > 0.01;
    };
    const textOf = (element) => (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const markerFor = (element) => {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return '';
      }
      if (element.id) {
        return `#${element.id}`;
      }
      const classes = Array.from(element.classList || []).slice(0, 3).join('.');
      return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`;
    };
    const stateAttributes = [
      'aria-expanded', 'aria-hidden', 'aria-selected', 'aria-checked', 'aria-current',
      'aria-controls', 'aria-haspopup', 'aria-live', 'aria-modal', 'data-state',
      'data-open', 'hidden', 'open',
    ];
    const stateSelector = [
      'a[href]', 'button', 'input', 'select', 'textarea', 'summary', '[role]',
      '[aria-expanded]', '[aria-hidden]', '[aria-live]', '[aria-modal]', '[data-state]',
      '[data-open]', 'dialog', '[class*="menu" i]', '[class*="submenu" i]',
      '[class*="dropdown" i]', '[class*="popover" i]', '[class*="tooltip" i]',
      '[class*="drawer" i]', '[class*="dialog" i]',
    ].join(',');
    const elements = Array.from(document.querySelectorAll(stateSelector))
      .filter(visible)
      .map((element) => ({
        marker: markerFor(element),
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role') || '',
        text: textOf(element),
        className: typeof element.className === 'string' ? element.className : '',
        value: ['input', 'select', 'textarea'].includes(element.tagName.toLowerCase()) ? element.value || '' : '',
        checked: 'checked' in element ? Boolean(element.checked) : false,
        attributes: Object.fromEntries(stateAttributes
          .filter((name) => element.hasAttribute(name))
          .map((name) => [name, element.getAttribute(name) || ''])),
      }));

    return {
      url: window.location.href,
      title: document.title,
      bodyClassName: document.body.className || '',
      activeElement: markerFor(document.activeElement),
      elements,
    };
  });
}

function flowStateFingerprint(state) {
  return JSON.stringify(state || {});
}

async function collectFlowStepSnapshot(page, { target, step, index, entry, stateFingerprint, navigated, maxTabs, targetDir }) {
  const {
    axe,
    domSignals,
    keyboard,
  } = await collectAuditState(page, {
    maxTabs,
    includeKeyboard: false,
  });
  const stepInfo = {
    index: index + 1,
    action: step.action,
    description: step.description || '',
    selector: step.selector || '',
    url: page.url(),
  };
  const issues = buildIssues({
    target,
    axe,
    domSignals,
    keyboard,
  }).map((issue) => annotateFlowStepIssue(issue, stepInfo));
  const screenshot = `flow-step-${index + 1}.png`;
  await takeStableScreenshot(page, path.join(targetDir, screenshot));

  return {
    ...stepInfo,
    elapsedMs: entry.elapsedMs,
    stateFingerprint,
    navigated,
    title: domSignals?.title || '',
    screenshot,
    summary: summarizeIssues(issues),
    issues,
  };
}

async function collectAuditState(page, { maxTabs = 30, includeKeyboard = true, timings, prefix = 'audit' } = {}) {
  const run = (phase, task) => timings
    ? timePhase(timings, `${prefix}.${phase}`, task)
    : task();
  const axe = await run('axeAnalyze', () => new AxeBuilder({ page })
    .withTags(WCAG_22_AA_TAGS)
    .analyze());
  await run('axeRects', () => attachAxeNodeRects(page, axe));
  const domSignals = await run('domSignals', () => collectDomSignals(page));
  const keyboard = includeKeyboard
    ? await run('keyboard', () => runKeyboardAudit(page, { maxTabs }))
    : emptyKeyboardAudit(maxTabs);

  return {
    axe,
    domSignals,
    keyboard,
  };
}

function annotateFlowStepIssue(issue, stepInfo) {
  const stepLabel = flowStepLabel(stepInfo);
  return {
    ...issue,
    id: `FLOW-S${stepInfo.index}-${issue.id}`,
    flowStep: stepInfo,
    reproductionSteps: [
      `执行任务步骤 ${stepInfo.index}：${stepLabel}`,
      ...(issue.reproductionSteps || []),
    ],
    evidence: {
      ...(issue.evidence || {}),
      flowStep: stepInfo,
    },
  };
}

function flowStepLabel(stepInfo) {
  return stepInfo.description || [stepInfo.action, stepInfo.selector].filter(Boolean).join(' ') || '未命名步骤';
}

function emptyKeyboardAudit(maxTabs) {
  return {
    maxTabs,
    uniqueFocusedCount: 0,
    possibleTrap: false,
    path: [],
    focusVisibleFailures: [],
  };
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = issueSignature(issue);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function mergeFinalAuditIntoFlowState({
  flowSnapshots = [],
  finalIssues = [],
  finalStateFingerprint = '',
  finalUrl = '',
}) {
  const lastSnapshot = flowSnapshots.at(-1);
  const mergeReason = lastSnapshot && finalStateFingerprint && lastSnapshot.stateFingerprint === finalStateFingerprint
    ? 'same-state'
    : lastSnapshot?.navigated && comparableUrl(lastSnapshot.url) === comparableUrl(finalUrl)
      ? 'completed-navigation'
      : null;
  if (!mergeReason) {
    return {
      mergedIntoStep: null,
      mergeReason: null,
      issues: dedupeIssues([
        ...finalIssues,
        ...flowSnapshots.flatMap((snapshot) => snapshot.issues),
      ]),
    };
  }

  const stepInfo = {
    index: lastSnapshot.index,
    action: lastSnapshot.action,
    description: lastSnapshot.description,
    selector: lastSnapshot.selector,
    url: lastSnapshot.url,
  };
  const mergedStateIssues = dedupeIssues([
    ...(lastSnapshot.issues || []),
    ...finalIssues.map((issue) => annotateFlowStepIssue(issue, stepInfo)),
  ]);
  lastSnapshot.issues = mergedStateIssues;
  lastSnapshot.summary = summarizeIssues(mergedStateIssues);

  return {
    mergedIntoStep: lastSnapshot.index,
    mergeReason,
    issues: dedupeIssues(flowSnapshots.flatMap((snapshot) => snapshot.issues)),
  };
}

function comparableUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href;
  } catch {
    return String(value || '');
  }
}

function issueSignature(issue) {
  const evidence = issue.evidence || {};
  return [
    issue.title,
    issue.severity,
    issue.tier,
    issue.ruleSource,
    evidence.selector || evidence.target || '',
    evidence.html || '',
    evidence.failureSummary || '',
    evidence.current || '',
  ].map((item) => String(item || '').replace(/\s+/g, ' ').trim().toLowerCase()).join('|');
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

async function hoverStep(page, step) {
  const selectors = selectorCandidates(step);
  for (const selector of selectors) {
    try {
      await page.hover(selector, { timeout: step.timeout || 5000 });
      return;
    } catch {
      // Try the next candidate.
    }
  }

  if (step.role && step.name) {
    try {
      await page.getByRole(step.role, { name: step.name }).hover({ timeout: step.timeout || 5000 });
      return;
    } catch {
      // Continue to text fallback.
    }
  }

  if (step.text || step.name) {
    try {
      await page.getByText(step.text || step.name).first().hover({ timeout: step.timeout || 5000 });
      return;
    } catch {
      // Continue to the final error.
    }
  }

  throw new Error(`Unable to hover step: ${step.description || step.selector || step.name || 'unknown control'}`);
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

function buildTaskConclusion({
  target,
  issues,
  scenarioExecution,
  flowSnapshots,
  finalUrl,
  finalStateMergedIntoStep,
  finalStateMergeReason,
}) {
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
    verdict: buildTaskVerdict({
      blockerCount,
      majorCount,
      scenarioExecution,
      finalStateMergedIntoStep,
      finalStateMergeReason,
    }),
    generatedBy: target.stepPlan?.provider || 'manual',
    confidence: target.stepPlan?.confidence || 'medium',
    assumptions: target.stepPlan?.assumptions || [],
    warnings: target.stepPlan?.warnings || [],
    steps: scenarioExecution,
    flowSnapshots: flowSnapshots.map(({ issues: _issues, stateFingerprint: _stateFingerprint, ...snapshot }) => snapshot),
    finalUrl,
    finalStateMergedIntoStep,
    finalStateMergeReason: finalStateMergeReason || null,
  };
}

function buildTaskVerdict({
  blockerCount,
  majorCount,
  scenarioExecution = [],
  finalStateMergedIntoStep = null,
  finalStateMergeReason = null,
}) {
  const stepCount = scenarioExecution.length;
  const unchangedStepNumbers = scenarioExecution
    .map((step, index) => (step.auditSample?.stateChanged === false ? index + 1 : null))
    .filter(Boolean);
  const unchangedStepLabel = unchangedStepNumbers.map((number) => `第 ${number} 步`).join('、');
  const unchangedStepNote = unchangedStepNumbers.length
    ? ` ${unchangedStepLabel}未产生新的页面或无障碍语义状态，未单独计入问题。`
    : '';
  const finalStateNote = finalStateMergedIntoStep
    ? finalStateMergeReason === 'completed-navigation'
      ? ` 第 ${finalStateMergedIntoStep} 步已进入最终页面，完整检测结果已合并到该步骤。`
      : ` 最终页面与第 ${finalStateMergedIntoStep} 步后状态一致，已合并为同一走查状态。`
    : '';
  const prefix = stepCount
    ? `已自动执行 ${stepCount} 个任务步骤，并对发生变化的流程状态与最终状态完成走查。${unchangedStepNote}${finalStateNote}`
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
