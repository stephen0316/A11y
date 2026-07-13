import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFinalAuditIntoFlowState, runScenarioSteps } from '../src/runner.js';

test('runScenarioSteps only audits steps that change the interaction state', async () => {
  let stateIndex = 0;
  const states = [
    { url: 'https://example.com/', elements: [{ marker: 'button.menu', text: '栏目' }] },
    { url: 'https://example.com/series/my', elements: [{ marker: 'h1', text: '我的栏目' }] },
  ];
  const sampledSteps = [];
  const page = {
    evaluate: async () => states[stateIndex],
    hover: async () => {},
    click: async () => { stateIndex = 1; },
    waitForTimeout: async () => {},
  };

  const execution = await runScenarioSteps(page, [
    { action: 'hover', selector: '.menu', description: '悬停栏目' },
    { action: 'click', selector: '.my-series', description: '点击我的栏目' },
    { action: 'wait', ms: 100, description: '等待页面稳定' },
  ], {
    onAfterStep: async ({ index }) => {
      sampledSteps.push(index + 1);
      return { issueCount: 3 };
    },
  });

  assert.deepEqual(sampledSteps, [2]);
  assert.deepEqual(execution.map((step) => step.auditSample.stateChanged), [false, true, false]);
  assert.deepEqual(execution.map((step) => step.auditSample.navigated), [false, true, false]);
  assert.equal(execution[0].auditSample.reusedFromStep, null);
  assert.equal(execution[2].auditSample.reusedFromStep, 2);
});

test('mergeFinalAuditIntoFlowState assigns final-only checks to the matching last step', () => {
  const flowIssue = {
    id: 'FLOW-S2-AXE-button-name-1',
    title: '按钮缺少可访问名称',
    severity: 'Blocker',
    tier: '自动规则',
    ruleSource: 'axe-core',
    evidence: { selector: '.save-button' },
    flowStep: { index: 2 },
  };
  const flowSnapshots = [{
    index: 2,
    action: 'click',
    description: '点击保存',
    selector: '.save-button',
    url: 'https://example.com/saved',
    stateFingerprint: 'same-state',
    issues: [flowIssue],
    summary: { total: 1, bySeverity: { Blocker: 1 }, byTier: { 自动规则: 1 } },
  }];
  const finalIssues = [{
    id: 'A11Y-001',
    title: '焦点指示可能不可见',
    severity: 'Major',
    tier: '行为检测',
    ruleSource: 'keyboard',
    evidence: { selector: '.save-button' },
  }];

  const result = mergeFinalAuditIntoFlowState({
    flowSnapshots,
    finalIssues,
    finalStateFingerprint: 'same-state',
  });

  assert.equal(result.mergedIntoStep, 2);
  assert.equal(result.issues.length, 2);
  assert.equal(flowSnapshots[0].summary.total, 2);
  assert.ok(result.issues.every((issue) => issue.flowStep?.index === 2));
});

test('mergeFinalAuditIntoFlowState merges the final audit into the last navigated page', () => {
  const flowSnapshots = [{
    index: 3,
    action: 'click',
    description: '进入详情页',
    selector: '.detail-link',
    url: 'https://example.com/detail#summary',
    navigated: true,
    stateFingerprint: 'before-lazy-content',
    issues: [],
    summary: { total: 0, bySeverity: {}, byTier: {} },
  }];
  const finalIssues = [{
    id: 'AXE-link-name-1',
    title: '链接缺少可访问名称',
    severity: 'Major',
    tier: '自动规则',
    ruleSource: 'axe-core',
    evidence: { selector: '.detail-link' },
  }];

  const result = mergeFinalAuditIntoFlowState({
    flowSnapshots,
    finalIssues,
    finalStateFingerprint: 'after-lazy-content',
    finalUrl: 'https://example.com/detail',
  });

  assert.equal(result.mergedIntoStep, 3);
  assert.equal(result.mergeReason, 'completed-navigation');
  assert.equal(flowSnapshots[0].summary.total, 1);
  assert.equal(result.issues[0].flowStep?.index, 3);
});
