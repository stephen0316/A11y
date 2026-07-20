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
  await page.route('**/api/audit', async (route) => {
    const request = route.request();
    const headers = {
      ...request.headers(),
      'content-type': 'application/json',
    };
    const payload = JSON.parse(request.postData() || '{}');
    await route.continue({
      headers,
      postData: JSON.stringify({
        ...payload,
        ai: { enabled: false },
      }),
    });
  });
  await page.route('**/api/steps', async (route) => {
    const request = route.request();
    const headers = {
      ...request.headers(),
      'content-type': 'application/json',
    };
    const payload = JSON.parse(request.postData() || '{}');
    await route.continue({
      headers,
      postData: JSON.stringify({
        ...payload,
        ai: { enabled: false },
      }),
    });
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await assertVisibleText(page, '无障碍走查');
  await assertVisibleText(page, '历史报告');

  await page.getByLabel('URL').fill(`file://${path.resolve('examples/sample-target.html')}`);
  await page.getByLabel('页面名称').fill('示例缺陷页');
  assert.equal(await page.getByLabel('启用 AI 语义复核').count(), 0, 'AI semantic review should not be a user-facing option');
  assert.equal(await page.getByLabel('任务路径').count(), 0, 'Natural language task field should be hidden by default');
  await page.getByLabel('启用自然语言任务').check();
  await page.getByLabel('任务路径').fill('邮箱: qa@example.com，密码: test123，然后等待 toast');
  await page.getByRole('button', { name: '生成步骤' }).click();
  await assertVisibleText(page, '本地规则生成');
  await assertVisibleText(page, '填写邮箱');
  await page.getByRole('button', { name: '开始走查' }).click();
  await assertVisiblePattern(page, /已自动执行 \d+ 个任务步骤，并对发生变化的流程状态与最终状态完成走查/);
  assert.equal(await page.getByText(/已采样 \d+ 个流程状态/).count(), 0, 'Sampled flow-state summary should be removed from the task card');
  assert.equal(await page.getByText(/个问题记录 · \d+ 次状态命中/).count(), 0, 'Aggregate hit summary should be removed from the task section header');
  assert.equal(await page.locator('.task-plan-badge').count(), 1, 'Task generation metadata should render as a badge');
  await assertVisibleText(page, '按任务状态聚合问题');
  await assertVisibleText(page, '第 1 步后');
  assert.equal(await page.locator('.task-issue-group ul').count(), 0, 'Task cards should not duplicate issue summaries');
  const flowStateCard = page.getByTestId('task-state-flow-1');
  assert.equal(await flowStateCard.count(), 1, 'Task step card should be available as a filter');
  await flowStateCard.click();
  await assertVisibleText(page, '当前查看：第 1 步后');
  assert.equal(await flowStateCard.getAttribute('aria-pressed'), 'true', 'Selected task step should be active');
  const stateCardText = await flowStateCard.textContent();
  const stateIssueCount = Number(stateCardText?.match(/(\d+)\s*个问题/)?.[1]);
  const scopedSeverityCounts = (await page.locator('.severity-pill strong').allTextContents()).map(Number);
  assert.ok(Number.isFinite(stateIssueCount), 'Selected task card should show its issue count');
  assert.equal(scopedSeverityCounts[0], stateIssueCount, 'Severity total should follow the selected task state');
  assert.equal(
    scopedSeverityCounts.slice(1).reduce((total, count) => total + count, 0),
    stateIssueCount,
    'Severity buckets should add up to the selected task-state issue count',
  );
  await page.getByRole('button', { name: '查看全部问题' }).click();
  assert.equal(await page.locator('[data-testid="task-state-filter"]').count(), 0, 'Clearing task state should restore all issues');
  assert.equal(await page.locator('.result-content > .ai-findings').count(), 0, 'AI semantic review should not appear on the home result surface');
  await page.getByRole('button', { name: /查看完整分析/ }).click();
  await assertVisibleText(page, 'AI 语义复核');
  await page.locator('.analysis-modal .modal-close').click();
  await assertVisibleText(page, '文字颜色对比度不足');
  await assertVisibleText(page, '图片缺少替代文本');
  await page.getByLabel('查看完整页面截图').click();
  await page.locator('.screenshot-modal').waitFor({ timeout: 8000 });
  const fullScreenshotSrc = await page.locator('.screenshot-stage img').getAttribute('src');
  assert.match(fullScreenshotSrc || '', /^data:image\/png;base64,/, 'Current-run screenshot preview should stay in the browser response');
  await page.locator('.screenshot-modal .modal-close').click();
  await page.getByText('导出为').click();
  const exportLabels = await page.locator('[data-testid="export-options"] a').evaluateAll((links) => links.map((link) => link.textContent.trim()));
  assert.deepEqual(exportLabels, ['Markdown', 'JSON', '截图', 'DOM 快照', '无障碍树']);
  await page.getByRole('heading', { name: '本次走查结果' }).click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('[data-testid="export-options"]').count(), 0, 'Export menu should close after outside click');
  await page.getByRole('button', { name: '阻断 1', exact: true }).click();
  await page.getByRole('button', { name: /全部\s+\d+/ }).click();
  await page.getByTestId('viewport-trigger').click();
  await page.getByRole('option', { name: '笔记本 1280×800' }).waitFor({ timeout: 4000 });
  const exportTriggerBox = await page.getByTestId('export-trigger').boundingBox();
  await page.mouse.click(exportTriggerBox.x + exportTriggerBox.width / 2, exportTriggerBox.y + exportTriggerBox.height / 2);
  await page.waitForTimeout(200);
  assert.equal(await page.getByRole('option', { name: '笔记本 1280×800' }).count(), 0, 'Opening export menu should close other dropdowns');

  await page.reload({ waitUntil: 'networkidle' });
  await assertVisibleText(page, '文字颜色对比度不足');

  await page.getByRole('button', { name: '新建走查' }).click();
  await assertVisibleText(page, '等待走查结果');

  await page.getByRole('link', { name: '历史报告' }).click();
  await assertVisibleText(page, '已存档报告');
  await assertVisibleText(page, '示例缺陷页');
  await page.getByRole('button', { name: /示例缺陷页/ }).first().click();
  await page.getByLabel('查看完整页面截图').click();
  await page.locator('.screenshot-modal').waitFor({ timeout: 8000 });
  const historyScreenshotSrc = await page.locator('.screenshot-stage img').getAttribute('src');
  assert.match(historyScreenshotSrc || '', /^data:image\/png;base64,/, 'Historical reports should keep their local screenshot evidence');
  await page.locator('.screenshot-modal .modal-close').click();

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

async function assertVisiblePattern(page, pattern) {
  const locator = page.getByText(pattern).first();
  await locator.waitFor({ timeout: 30000 });
  assert.equal(await locator.isVisible(), true, `Expected visible text matching: ${pattern}`);
}
