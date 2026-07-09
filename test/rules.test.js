import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIssues } from '../src/rules.js';
import { slugify } from '../src/utils.js';

test('buildIssues maps axe violations and custom signals to reportable issues', () => {
  const issues = buildIssues({
    axe: {
      violations: [
        {
          id: 'button-name',
          impact: 'critical',
          help: 'Buttons must have discernible text',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name',
          description: 'Ensures buttons have discernible text',
          nodes: [
            {
              target: ['button.icon'],
              html: '<button class="icon"></button>',
              failureSummary: 'Fix any of the following...',
            },
          ],
        },
        {
          id: 'landmark-one-main',
          impact: 'moderate',
          help: 'Document should have one main landmark',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/landmark-one-main?application=playwright',
          description: 'Ensures the document has one main landmark',
          nodes: [
            {
              target: ['html'],
              html: '<html lang="zh-CN">',
              failureSummary: 'Document does not have a main landmark',
            },
          ],
        },
      ],
    },
    domSignals: {
      lang: '',
      headings: [
        { level: 1, text: 'Page', selector: 'h1' },
        { level: 3, text: 'Section', selector: 'h3' },
      ],
      clickables: [
        {
          selector: '.tiny',
          disabled: false,
          rect: { width: 18, height: 18 },
        },
      ],
      statusCandidates: [
        {
          selector: '.toast',
          role: '',
          ariaLive: '',
          className: 'toast',
          text: 'Saved',
        },
      ],
      dialogs: [],
      images: [],
      links: [{ selector: 'a', href: '/more', text: '更多', name: '更多' }],
    },
    keyboard: {
      maxTabs: 30,
      path: [],
      uniqueFocusedCount: 3,
      focusVisibleFailures: [],
      possibleTrap: false,
    },
  });

  assert.equal(issues.some((issue) => issue.severity === 'Blocker'), true);
  assert.equal(issues.some((issue) => issue.title === '页面缺少 lang 语言声明'), true);
  assert.equal(issues.some((issue) => issue.title === '动态状态反馈缺少读屏可感知语义'), true);
  assert.equal(issues.some((issue) => issue.tier === 'AI辅助判断'), true);
  assert.equal(issues.some((issue) => issue.title === '页面应只有一个 main 主内容地标'), true);
  assert.equal(issues.some((issue) => issue.ruleUrl?.includes('landmark-one-main')), true);
});

test('slugify keeps readable target names', () => {
  assert.equal(slugify('登录页 https://example.com/a?b=1'), '登录页-example-com-a-b-1');
});
