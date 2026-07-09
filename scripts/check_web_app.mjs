import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.APP_URL || 'http://127.0.0.1:3000';
const screenshotPath = path.resolve('reports', 'web-ui-check.png');

await mkdir(path.dirname(screenshotPath), { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await assertVisibleText(page, '无障碍验收台');
  await assertVisibleText(page, '历史报告');

  await page.getByLabel('URL').fill(`file://${path.resolve('examples/sample-target.html')}`);
  await page.getByLabel('页面名称').fill('示例缺陷页');
  await page.getByLabel('启用 AI 语义复核').uncheck();
  assert.equal(await page.getByLabel('任务路径').count(), 0, 'Natural language task field should be hidden by default');
  await page.getByLabel('启用自然语言任务').check();
  await page.getByLabel('任务路径').fill('邮箱: qa@example.com，密码: test123，然后等待 toast');
  await page.getByRole('button', { name: '生成步骤' }).click();
  await assertVisibleText(page, '本地规则生成');
  await assertVisibleText(page, '填写邮箱');
  await page.getByRole('button', { name: '开始审计' }).click();
  await assertVisibleText(page, '已自动执行 3 个任务步骤并在最终状态完成审计');
  await assertVisibleText(page, '文字颜色对比度不足');
  await assertVisibleText(page, '图片缺少替代文本');
  await page.getByLabel('查看完整页面截图').waitFor({ timeout: 8000 });
  await page.getByText('导出为').click();
  const exportLabels = await page.locator('[data-testid="export-options"] a').evaluateAll((links) => links.map((link) => link.textContent.trim()));
  assert.deepEqual(exportLabels, ['Markdown', 'JSON', 'AX Tree']);
  await page.mouse.click(20, 20);
  assert.equal(await page.locator('[data-testid="export-options"]').count(), 0, 'Export menu should close after outside click');
  await page.getByRole('button', { name: /阻断\s+\d+/ }).click();
  await page.getByRole('button', { name: /全部\s+\d+/ }).click();
  await page.getByTestId('viewport-trigger').click();
  await page.getByRole('option', { name: '笔记本 1280×800' }).waitFor({ timeout: 4000 });
  const exportTriggerBox = await page.getByTestId('export-trigger').boundingBox();
  await page.mouse.click(exportTriggerBox.x + exportTriggerBox.width / 2, exportTriggerBox.y + exportTriggerBox.height / 2);
  await page.waitForTimeout(200);
  assert.equal(await page.getByRole('option', { name: '笔记本 1280×800' }).count(), 0, 'Opening export menu should close other dropdowns');

  await page.reload({ waitUntil: 'networkidle' });
  await assertVisibleText(page, '文字颜色对比度不足');

  await page.getByRole('button', { name: '新建审计' }).click();
  await assertVisibleText(page, '等待审计结果');

  await page.getByRole('link', { name: '历史报告' }).click();
  await assertVisibleText(page, '历史报告');
  await assertVisibleText(page, '示例缺陷页');

  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Web UI check passed: ${screenshotPath}`);
} finally {
  await browser.close();
}

async function assertVisibleText(page, text) {
  const locator = page.getByText(text).first();
  await locator.waitFor({ timeout: 30000 });
  assert.equal(await locator.isVisible(), true, `Expected visible text: ${text}`);
}
