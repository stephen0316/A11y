import { chromium } from 'playwright';
import { runTargetAudit } from './runner.js';

export async function auditTargets(targets, options = {}) {
  if (!targets.length) {
    throw new Error('No audit target configured. Pass --url or --scenario.');
  }

  const browser = await (options.launchBrowser || launchLocalBrowser)({
    headless: !options.headful,
  });
  const reports = [];

  try {
    for (const target of targets) {
      const context = await browser.newContext({
        viewport: options.viewport || { width: 1440, height: 1000 },
      });
      const page = await context.newPage();

      try {
        reports.push(await runTargetAudit(page, target, options));
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  return { reports };
}

async function launchLocalBrowser(launchOptions) {
  return chromium.launch(launchOptions);
}
