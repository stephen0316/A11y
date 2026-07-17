import chromium from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';

export async function launchVercelBrowser() {
  return playwrightChromium.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
}
