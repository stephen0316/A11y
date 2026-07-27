import assert from 'node:assert/strict';
import test from 'node:test';
import { checklistRow } from '../web/src/lib/inspection-checklist.js';

test('checklistRow maps audit issues into the supplied checklist fields', () => {
  const row = checklistRow({
    title: '文字颜色对比度不足',
    severity: 'Major',
    ruleSource: 'axe-core / color-contrast',
    impactUsers: '低视力用户可能难以辨认按钮文字。',
    recommendation: '调整颜色，使对比度至少达到 4.5:1。',
    evidence: {
      html: '<a class="btn--sm">Sign up</a>',
      failureSummary: 'Element has insufficient color contrast of 4.35. Expected contrast ratio of 4.5:1',
    },
  }, {
    meta: { target: { name: '示例页面' } },
  });

  assert.equal(row[0], '示例页面');
  assert.equal(row[1], '文字颜色对比度不足');
  assert.equal(row[2], '严重');
  assert.match(row[3], /问题元素：链接「Sign up」/);
  assert.match(row[3], /4\.35:1，低于普通文本所需的 4\.5:1/);
  assert.equal(row[4], null);
  assert.equal(row[5], null);
  assert.equal(row[6], '调整颜色，使对比度至少达到 4.5:1。');
});

test('checklistRow keeps system severity labels and page-wide scope', () => {
  const row = checklistRow({
    title: '页面应只有一个 main 主内容地标',
    severity: 'Blocker',
    evidence: { selector: 'html', failureSummary: 'Document does not have a main landmark' },
  }, {
    meta: { target: { name: '示例页面' } },
  });

  assert.equal(row[2], '阻断');
  assert.match(row[3], /问题元素：整个页面/);
  assert.match(row[3], /页面缺少 main 主内容地标/);
});
