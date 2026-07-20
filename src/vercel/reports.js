import { readFile, rm, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { auditTargets } from '../index.js';
import { renderMarkdownReport } from '../report.js';
import { launchVercelBrowser } from './launch-browser.js';
import { normalizeAiOptions, parseViewport } from './input.js';

export async function runVercelAudit(target, payload = {}) {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'a11y-audit-'));

  try {
    const result = await auditTargets([target], {
      outDir: workingDirectory,
      maxTabs: Number(payload.maxTabs || 30),
      viewport: parseViewport(payload.viewport),
      ai: normalizeAiOptions(payload.ai),
      launchBrowser: launchVercelBrowser,
    });
    const report = result.reports[0];
    const audit = JSON.parse(await readFile(report.jsonPath, 'utf8'));

    return {
      id: path.basename(path.dirname(report.reportPath)),
      target: report.target,
      audit: toBrowserAudit(audit),
      markdown: renderMarkdownReport(audit),
      artifacts: await readBrowserArtifacts(report, audit),
    };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

function toBrowserAudit(audit) {
  return {
    meta: audit.meta,
    summary: audit.summary,
    ai: audit.ai,
    issues: audit.issues,
  };
}

async function readBrowserArtifacts(report, audit) {
  const artifactNames = audit.meta?.artifacts || {};
  const artifactDirectory = path.dirname(report.screenshotPath);
  const flowScreenshots = await Promise.all(
    (artifactNames.flowScreenshots || []).map(async (item) => ({
      index: item.index,
      name: path.basename(item.screenshot),
      dataUrl: await readImageDataUrl(path.join(artifactDirectory, path.basename(item.screenshot))),
    })),
  );

  return {
    screenshot: {
      name: artifactNames.screenshot || 'screenshot.png',
      dataUrl: await readImageDataUrl(report.screenshotPath),
    },
    flowScreenshots,
    domSnapshot: {
      name: artifactNames.domSnapshot || 'dom-snapshot.html',
      content: await readFile(path.join(artifactDirectory, path.basename(artifactNames.domSnapshot || 'dom-snapshot.html')), 'utf8'),
    },
    accessibilityTree: {
      name: artifactNames.accessibilityTree || 'accessibility-tree.json',
      content: await readFile(path.join(artifactDirectory, path.basename(artifactNames.accessibilityTree || 'accessibility-tree.json')), 'utf8'),
    },
  };
}

async function readImageDataUrl(filePath) {
  const image = await readFile(filePath);
  return `data:image/png;base64,${image.toString('base64')}`;
}
