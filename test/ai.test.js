import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEvidencePack } from '../src/ai/evidence.js';
import { normalizeAiResponse, runAiAudit } from '../src/ai/gemini.js';

const sampleInput = {
  target: {
    name: '示例缺陷页',
    url: 'https://example.com',
    notes: '登录失败流程',
    steps: [{ action: 'click', selector: '#submit' }],
  },
  axe: {
    violations: [
      {
        id: 'button-name',
        impact: 'critical',
        help: 'Buttons must have discernible text',
        helpUrl: 'https://example.com/rule',
        nodes: [{ target: ['button.icon'], html: '<button></button>', failureSummary: 'Missing name' }],
      },
    ],
  },
  domSignals: {
    title: 'Demo',
    lang: 'zh-CN',
    headings: [{ level: 1, text: 'Demo', selector: 'h1' }],
    images: [{ tag: 'img', selector: 'img.logo', alt: '图', ariaLabel: '', ariaHidden: '', text: '', rect: { width: 40, height: 40 } }],
    forms: [{ tag: 'input', selector: '#email', type: 'email', name: '邮箱', required: true, invalid: false }],
    clickables: [{ tag: 'button', selector: 'button.icon', name: '', rect: { width: 20, height: 20 } }],
    statusCandidates: [{ selector: '.toast', role: '', ariaLive: '', text: '失败', className: 'toast' }],
    dialogs: [],
    links: [{ selector: 'a.more', href: '/detail', text: '更多', name: '更多' }],
  },
  keyboard: {
    maxTabs: 30,
    path: [{ step: 1, selector: '#email', tag: 'input', role: '', name: '邮箱', focusVisible: true }],
    focusVisibleFailures: [],
    possibleTrap: false,
    uniqueFocusedCount: 3,
  },
  accessibilityTree: {
    role: 'WebArea',
    name: 'Demo',
    children: [{ role: 'button', name: '' }],
  },
  issues: [
    {
      id: 'AXE-button-name-1',
      title: '按钮缺少可访问名称',
      severity: 'Blocker',
      tier: '自动规则',
      ruleSource: 'axe-core / button-name',
      owner: '研发',
      confidence: 'high',
      impactUsers: '读屏器用户无法理解按钮用途。',
      recommendation: '增加 aria-label。',
      evidence: { selector: 'button.icon' },
    },
  ],
};

test('buildEvidencePack creates compact AI input without full raw artifacts', () => {
  const pack = buildEvidencePack(sampleInput);

  assert.equal(pack.target.name, '示例缺陷页');
  assert.equal(pack.axe.violationCount, 1);
  assert.equal(pack.dom.links[0].text, '更多');
  assert.equal(pack.accessibilityTree.nodes.length > 0, true);
  assert.equal(pack.issues[0].id, 'AXE-button-name-1');
});

test('runAiAudit is disabled without enabled flag or key', async () => {
  const result = await runAiAudit(sampleInput, { enabled: false });

  assert.equal(result.status, 'disabled');
  assert.equal(result.provider, 'gemini');
  assert.equal(result.semanticFindings.length, 0);
  assert.equal(result.evidencePack.target.name, '示例缺陷页');
});

test('runAiAudit parses successful Gemini structured output', async () => {
  const aiPayload = {
    summary: {
      verdict: '页面存在明确阻断问题。',
      riskLevel: 'high',
      keyFindings: ['图标按钮没有名称'],
      recommendedNextSteps: ['优先修复按钮名称'],
    },
    semanticFindings: [
      {
        id: 'AI-S1',
        title: '链接文案需要上下文',
        category: '链接文案',
        severity: 'Minor',
        selector: 'a.more',
        reason: '更多无法单独说明目的。',
        evidence: 'DOM 中链接文本为更多。',
        recommendation: '改为查看订单详情。',
        confidence: 'medium',
        relatedIssueIds: [],
      },
    ],
    issueEnhancements: [
      {
        issueId: 'AXE-button-name-1',
        rootCause: '按钮只有图标。',
        userImpact: '读屏器只能读到按钮。',
        developerFix: '添加 aria-label。',
        uedFix: '补充图标按钮语义命名。',
        codeExample: '<button aria-label="提交"></button>',
        copyableIssue: '标题：按钮缺少可访问名称',
        confidence: 'high',
      },
    ],
  };

  const result = await runAiAudit(sampleInput, {
    enabled: true,
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ output_text: JSON.stringify(aiPayload) }),
    }),
  });

  assert.equal(result.status, 'enabled');
  assert.equal(result.summary.riskLevel, 'high');
  assert.equal(result.semanticFindings[0].title, '链接文案需要上下文');
  assert.equal(result.issueEnhancements[0].issueId, 'AXE-button-name-1');
});

test('runAiAudit falls back to the lightweight model on retryable failures', async () => {
  const aiPayload = {
    summary: {
      verdict: 'fallback ok',
      riskLevel: 'medium',
      keyFindings: [],
      recommendedNextSteps: [],
    },
    semanticFindings: [],
    issueEnhancements: [],
  };
  const requestedModels = [];

  const result = await runAiAudit(sampleInput, {
    enabled: true,
    apiKey: 'test-key',
    model: 'gemini-3.5-flash',
    fallbackModels: ['gemini-2.5-flash-lite'],
    maxAttempts: 1,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requestedModels.push(body.model);
      if (body.model === 'gemini-3.5-flash') {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ error: { message: 'high demand' } }),
        };
      }
      return {
        ok: true,
        json: async () => ({ output_text: JSON.stringify(aiPayload) }),
      };
    },
  });

  assert.equal(result.status, 'enabled');
  assert.equal(result.model, 'gemini-2.5-flash-lite');
  assert.deepEqual(requestedModels, ['gemini-3.5-flash', 'gemini-2.5-flash-lite']);
  assert.deepEqual(result.attemptedModels, ['gemini-3.5-flash', 'gemini-2.5-flash-lite']);
});

test('runAiAudit retries transient model failures before fallback', async () => {
  const aiPayload = {
    summary: {
      verdict: 'retry ok',
      riskLevel: 'medium',
      keyFindings: [],
      recommendedNextSteps: [],
    },
    semanticFindings: [],
    issueEnhancements: [],
  };
  const requestedModels = [];

  const result = await runAiAudit(sampleInput, {
    enabled: true,
    apiKey: 'test-key',
    model: 'gemini-3.5-flash',
    fallbackModels: ['gemini-2.5-flash'],
    maxAttempts: 2,
    retryDelayMs: 0,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requestedModels.push(body.model);
      if (requestedModels.length < 3) {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ error: { message: 'high demand' } }),
        };
      }
      return {
        ok: true,
        json: async () => ({ output_text: JSON.stringify(aiPayload) }),
      };
    },
  });

  assert.equal(result.status, 'enabled');
  assert.equal(result.model, 'gemini-2.5-flash');
  assert.deepEqual(requestedModels, ['gemini-3.5-flash', 'gemini-3.5-flash', 'gemini-2.5-flash']);
  assert.deepEqual(result.attemptedModels, ['gemini-3.5-flash', 'gemini-2.5-flash']);
});

test('runAiAudit requests low thinking level by default to reduce latency', async () => {
  let generationConfig;
  const aiPayload = {
    summary: {
      verdict: 'ok',
      riskLevel: 'low',
      keyFindings: [],
      recommendedNextSteps: [],
    },
    semanticFindings: [],
    issueEnhancements: [],
  };

  await runAiAudit(sampleInput, {
    enabled: true,
    apiKey: 'test-key',
    maxAttempts: 1,
    fetchImpl: async (_url, init) => {
      generationConfig = JSON.parse(init.body).generation_config;
      return {
        ok: true,
        json: async () => ({ output_text: JSON.stringify(aiPayload) }),
      };
    },
  });

  assert.equal(generationConfig.temperature, 0.2);
  assert.equal(generationConfig.thinking_level, 'low');
});

test('runAiAudit fails closed when Gemini returns malformed data', async () => {
  const result = await runAiAudit(sampleInput, {
    enabled: true,
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ output_text: 'not json' }),
    }),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.issueEnhancements.length, sampleInput.issues.length);
  assert.match(result.summary.verdict, /按钮缺少可访问名称/);
  assert.match(result.error, /Unexpected token|JSON/);
});

test('normalizeAiResponse filters enhancements for unknown issue ids', () => {
  const normalized = normalizeAiResponse({
    summary: {
      verdict: 'ok',
      riskLevel: 'low',
      keyFindings: [],
      recommendedNextSteps: [],
    },
    semanticFindings: [],
    issueEnhancements: [
      { issueId: 'AXE-button-name-1', rootCause: 'known' },
      { issueId: 'UNKNOWN', rootCause: 'unknown' },
    ],
  }, sampleInput.issues);

  assert.equal(normalized.issueEnhancements.length, 1);
  assert.equal(normalized.issueEnhancements[0].rootCause, 'known');
});

test('normalizeAiResponse creates usable fallback summary and per-issue enhancements', () => {
  const normalized = normalizeAiResponse({}, sampleInput.issues);

  assert.match(normalized.summary.verdict, /按钮缺少可访问名称/);
  assert.equal(normalized.summary.riskLevel, 'high');
  assert.match(normalized.summary.keyFindings[0], /按钮缺少可访问名称/);
  assert.match(normalized.summary.recommendedNextSteps[0], /按钮缺少可访问名称/);
  assert.equal(normalized.issueEnhancements.length, sampleInput.issues.length);
  assert.equal(normalized.issueEnhancements[0].issueId, 'AXE-button-name-1');
  assert.match(normalized.issueEnhancements[0].copyableIssue, /按钮缺少可访问名称/);
});

test('normalizeAiResponse replaces low-value summary text with issue-specific insights', () => {
  const normalized = normalizeAiResponse({
    summary: {
      verdict: '本次审计发现 1 个问题，其中阻断 1 个、严重 0 个。建议先处理阻断和严重问题，再复核语义类建议。',
      riskLevel: 'high',
      keyFindings: ['自动规则：1 个'],
      recommendedNextSteps: [
        '优先修复 Blocker 问题，避免键盘或读屏器用户被阻断。',
        '按规则来源和 selector 分派给研发、UED 或内容负责人。',
      ],
    },
    semanticFindings: [],
    issueEnhancements: [],
  }, sampleInput.issues);

  assert.match(normalized.summary.verdict, /按钮缺少可访问名称/);
  assert.equal(normalized.summary.keyFindings.some((item) => /自动规则：1 个/.test(item)), false);
  assert.equal(normalized.summary.recommendedNextSteps.some((item) => /selector 分派/.test(item)), false);
  assert.match(normalized.summary.recommendedNextSteps.join('\n'), /图标按钮|可访问名称|组件/);
});

test('normalizeAiResponse groups repeated semantic review findings', () => {
  const repeatedIssues = [
    ...sampleInput.issues,
    ...[1, 2, 3].map((index) => ({
      id: `AI-ALT-${index}`,
      title: '需要复核图片替代文本是否准确',
      severity: 'Suggestion',
      tier: 'AI辅助判断',
      ruleSource: 'WCAG 2.2 AA / 1.1.1 Non-text Content',
      owner: 'UED',
      confidence: 'needs-review',
      impactUsers: '读屏器用户依赖替代文本理解图片承载的信息。',
      recommendation: '结合页面任务判断 alt 是否传达了图片的功能或信息；装饰图应使用空 alt。',
      evidence: { selector: `img:nth-of-type(${index})` },
    })),
  ];

  const normalized = normalizeAiResponse({}, repeatedIssues);

  assert.equal(normalized.semanticFindings.length, 1);
  assert.equal(normalized.semanticFindings[0].relatedIssueIds.length, 3);
  assert.match(normalized.semanticFindings[0].evidence, /共 3 个相关元素/);
  assert.equal(normalized.issueEnhancements.length, repeatedIssues.length);
});
