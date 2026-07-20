import { readFile, rm, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { auditTargets } from '../index.js';
import { renderMarkdownReport } from '../report.js';
import { launchVercelBrowser } from './launch-browser.js';
import { normalizeAiOptions, parseViewport } from './input.js';

const MAX_PREVIEW_SCREENSHOT_BYTES = 1.5 * 1024 * 1024;

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
      markdown: renderBrowserMarkdown(audit),
      preview: await readScreenshotPreview(report.screenshotPath),
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

function renderBrowserMarkdown(audit) {
  const browserAudit = toBrowserAudit(audit);
  return renderMarkdownReport({
    ...browserAudit,
    meta: {
      ...browserAudit.meta,
      artifacts: {
        screenshot: '仅在本次浏览器会话中提供，不保存到历史记录',
        flowScreenshots: [],
        domSnapshot: '未持久保存',
        accessibilityTree: '未持久保存',
      },
    },
  });
}

async function readScreenshotPreview(screenshotPath) {
  const screenshot = await readFile(screenshotPath);
  if (screenshot.byteLength > MAX_PREVIEW_SCREENSHOT_BYTES) {
    return {
      screenshotDataUrl: '',
      screenshotOmitted: true,
    };
  }
  return {
    screenshotDataUrl: `data:image/png;base64,${screenshot.toString('base64')}`,
    screenshotOmitted: false,
  };
}
