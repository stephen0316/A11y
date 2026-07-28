import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLocalStepPlan, generateScenarioSteps, normalizeStepPlan } from '../src/ai/steps.js';

test('buildLocalStepPlan converts login task into executable steps', () => {
  const plan = buildLocalStepPlan('邮箱: qa@example.com，密码: test123，然后点击登录，等待 toast');

  assert.equal(plan.provider, 'local-rules');
  assert.equal(plan.steps.length, 4);
  assert.equal(plan.steps[0].action, 'fill');
  assert.equal(plan.steps[0].value, 'qa@example.com');
  assert.equal(plan.steps[1].selector, '#password');
  assert.equal(plan.steps[2].action, 'click');
  assert.equal(plan.steps[2].name, '登录');
  assert.equal(plan.steps[3].action, 'waitForSelector');
  assert.equal(plan.steps[3].selectors.includes('.toast'), true);
});

test('buildLocalStepPlan supports waits and keyboard steps', () => {
  const plan = buildLocalStepPlan('等待 2 秒，然后按 Enter');

  assert.deepEqual(plan.steps.map((step) => step.action), ['wait', 'press']);
  assert.equal(plan.steps[0].ms, 2000);
  assert.equal(plan.steps[1].key, 'Enter');
});

test('buildLocalStepPlan parses inline field value pairs', () => {
  const plan = buildLocalStepPlan('输入邮箱 qa@example.com 和密码 test123，点击登录，等待 toast');

  assert.deepEqual(plan.steps.map((step) => step.action), ['fill', 'fill', 'click', 'waitForSelector']);
  assert.equal(plan.steps[0].selector, '#email');
  assert.equal(plan.steps[0].value, 'qa@example.com');
  assert.equal(plan.steps[1].selector, '#password');
  assert.equal(plan.steps[1].value, 'test123');
});

test('buildLocalStepPlan supports hover before clicking submenu items', () => {
  const plan = buildLocalStepPlan('鼠标 hover 在顶部导航栏“栏目”菜单，点击栏目下的“我的栏目”，跳转至目标页面');

  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].action, 'hover');
  assert.equal(plan.steps[0].name, '栏目');
  assert.equal(plan.steps[1].action, 'click');
  assert.equal(plan.steps[1].name, '我的栏目');
});

test('generateScenarioSteps uses Gemini output when enabled', async () => {
  let generationConfig = null;
  const result = await generateScenarioSteps({
    instruction: '点击新增，等待弹窗',
    target: { url: 'https://example.com' },
  }, {
    enabled: true,
    apiKey: 'test-key',
    fetchImpl: async (_url, init) => {
      generationConfig = JSON.parse(init.body).generation_config;
      return {
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            task: '点击新增，等待弹窗',
            confidence: 'high',
            assumptions: ['使用按钮文本定位'],
            steps: [
              { action: 'hover', role: 'button', name: '新增', selectors: ['button:has-text("新增")'], description: '悬停新增' },
              { action: 'waitForSelector', selectors: ['[role="dialog"]'], description: '等待弹窗' },
            ],
          }),
        }),
      };
    },
  });

  assert.deepEqual(generationConfig, { temperature: 0.1 });
  assert.equal(result.provider, 'gemini');
  assert.equal(result.confidence, 'high');
  assert.equal(result.steps[0].action, 'hover');
  assert.equal(result.steps[0].name, '新增');
  assert.equal(result.steps[1].selector, '[role="dialog"]');
});

test('normalizeStepPlan drops unsupported actions', () => {
  const plan = normalizeStepPlan({
    steps: [
      { action: 'navigate', selector: 'body' },
      { action: 'click', selector: 'button' },
    ],
  });

  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].action, 'click');
});
