const SEVERITIES = ['Blocker', 'Major', 'Minor', 'Suggestion'];
const TIERS = ['自动规则', '组件规则', '行为检测', 'AI辅助判断', '人工确认'];

export function renderMarkdownReport(audit) {
  const { meta, summary, issues, ai } = audit;
  const enhancementByIssue = new Map((ai?.issueEnhancements || []).map((item) => [item.issueId, item]));
  const lines = [];

  lines.push(`# ${meta.target.name} 无障碍验收报告`);
  lines.push('');
  lines.push(`- URL: ${meta.target.url}`);
  lines.push(`- 基线: ${meta.baseline}`);
  lines.push(`- 生成时间: ${meta.generatedAt}`);
  if (meta.target.notes) {
    lines.push(`- 环境/账号说明: ${meta.target.notes}`);
  }
  lines.push(`- 截图: ${meta.artifacts.screenshot}`);
  lines.push(`- DOM 快照: ${meta.artifacts.domSnapshot}`);
  lines.push(`- Accessibility Tree: ${meta.artifacts.accessibilityTree}`);
  lines.push('');

  lines.push('## 页面级总览');
  lines.push('');
  lines.push(`- 问题总数: ${summary.total}`);
  for (const severity of SEVERITIES) {
    lines.push(`- ${severityLabel(severity)} (${severity}): ${summary.bySeverity[severity] || 0}`);
  }
  lines.push('');
  lines.push('### 规则层级');
  lines.push('');
  for (const tier of TIERS) {
    lines.push(`- ${tier}: ${summary.byTier[tier] || 0}`);
  }
  lines.push('');
  lines.push('## AI 审计摘要');
  lines.push('');
  lines.push(...renderAiSummary(ai));
  lines.push('');

  lines.push('## AI 语义复核');
  lines.push('');
  lines.push(...renderSemanticFindings(ai));
  lines.push('');

  lines.push('## 问题列表');
  lines.push('');
  if (!issues.length) {
    lines.push('未发现自动化规则问题。仍建议进行真实读屏、复杂流程和认知理解人工验收。');
    lines.push('');
  }

  for (const issue of issues) {
    lines.push(`### ${issue.id} ${issue.title}`);
    lines.push('');
    lines.push(`- 严重级别: ${severityLabel(issue.severity)} (${issue.severity})`);
    lines.push(`- 检测层级: ${issue.tier}`);
    lines.push(`- 规则来源: ${issue.ruleUrl ? `[${issue.ruleSource}](${issue.ruleUrl})` : issue.ruleSource}`);
    lines.push(`- 责任角色: ${issue.owner}`);
    lines.push(`- 置信度: ${issue.confidence}`);
    lines.push(`- 影响用户: ${issue.impactUsers}`);
    lines.push(`- 修复建议: ${issue.recommendation}`);
    const enhancement = enhancementByIssue.get(issue.id);
    if (enhancement) {
      lines.push('');
      lines.push('AI 增强建议:');
      lines.push(`- 根因分析: ${enhancement.rootCause || '未返回'}`);
      lines.push(`- 用户影响: ${enhancement.userImpact || '未返回'}`);
      lines.push(`- 优化建议: ${enhancement.developerFix || '未返回'}`);
      lines.push(`- UED 建议: ${enhancement.uedFix || '未返回'}`);
      if (enhancement.codeExample) {
        lines.push('');
        lines.push('AI 示例代码:');
        lines.push('');
        lines.push('```html');
        lines.push(enhancement.codeExample);
        lines.push('```');
      }
    }
    lines.push('');
    lines.push('复现步骤:');
    for (const step of issue.reproductionSteps) {
      lines.push(`1. ${step}`);
    }
    lines.push('');
    lines.push('开发定位信息:');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(issue.evidence, null, 2));
    lines.push('```');
    lines.push('');
    lines.push('Issue 文案:');
    lines.push('');
    lines.push('```md');
    lines.push(enhancement?.copyableIssue || renderIssueCopy(issue, enhancement));
    lines.push('```');
    lines.push('');
  }

  lines.push('## 人工复核说明');
  lines.push('');
  lines.push('- `自动规则` 和 `行为检测` 可以直接进入缺陷确认。');
  lines.push('- `AI辅助判断` 需要结合截图、DOM 和业务语境复核文案质量、图片含义、链接目的。');
  lines.push('- `人工确认` 覆盖真实读屏体验、复杂业务流程、认知理解、字幕/音频描述等自动化难以保证的项目。');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function renderAiSummary(ai) {
  if (!ai) {
    return ['AI 语义复核未运行。'];
  }

  if (ai.status === 'disabled') {
    return [`AI 语义复核未启用：${ai.reason || '未配置或本次关闭。'}`];
  }

  if (ai.status === 'failed') {
    const lines = [`AI 语义复核调用失败：${ai.error || '未知错误'}。以下为规则结果生成的降级摘要。`];
    if (ai.summary) {
      lines.push(...renderAiSummaryContent(ai.summary, ai.model));
    }
    return lines;
  }

  const summary = ai.summary;
  if (!summary) {
    return ['AI 已启用，但未返回页面级摘要。'];
  }

  return renderAiSummaryContent(summary, ai.model);
}

function renderAiSummaryContent(summary, model) {
  const lines = [
    `- 模型: ${model || 'gemini'}`,
    `- 结论: ${summary.verdict}`,
    `- 风险等级: ${summary.riskLevel}`,
  ];

  if (summary.keyFindings?.length) {
    lines.push('- 核心洞察:');
    for (const item of summary.keyFindings) {
      lines.push(`  - ${item}`);
    }
  }

  if (summary.recommendedNextSteps?.length) {
    lines.push('- 修复策略:');
    for (const item of summary.recommendedNextSteps) {
      lines.push(`  - ${item}`);
    }
  }

  return lines;
}

function renderSemanticFindings(ai) {
  if (ai?.status !== 'enabled' && !ai?.semanticFindings?.length) {
    return ['AI 语义复核未产生结果。'];
  }

  if (!ai.semanticFindings?.length) {
    return ['AI 未发现额外语义复核项。'];
  }

  const lines = [];
  for (const finding of ai.semanticFindings) {
    lines.push(`### ${finding.id} ${finding.title}`);
    lines.push('');
    lines.push(`- 类别: ${finding.category}`);
    lines.push(`- 严重级别: ${severityLabel(finding.severity)} (${finding.severity})`);
    lines.push(`- 置信度: ${finding.confidence}`);
    if (finding.selector) {
      lines.push(`- 相关元素: ${finding.selector}`);
    }
    if (finding.relatedIssueIds?.length) {
      lines.push(`- 关联问题: ${finding.relatedIssueIds.join(', ')}`);
    }
    lines.push(`- 判断理由: ${finding.reason}`);
    lines.push(`- 证据: ${finding.evidence}`);
    lines.push(`- 建议: ${finding.recommendation}`);
    lines.push('');
  }
  return lines;
}

function renderIssueCopy(issue, enhancement) {
  return [
    `标题：${issue.title}`,
    `严重级别：${severityLabel(issue.severity)} (${issue.severity})`,
    `规则来源：${issue.ruleUrl ? `${issue.ruleSource} (${issue.ruleUrl})` : issue.ruleSource}`,
    `影响用户：${issue.impactUsers}`,
    `责任角色：${issue.owner}`,
    '',
    '复现步骤：',
    ...issue.reproductionSteps.map((step, index) => `${index + 1}. ${step}`),
    '',
    `修复建议：${issue.recommendation}`,
    ...(enhancement?.developerFix ? [`AI 优化建议：${enhancement.developerFix}`] : []),
    ...(enhancement?.uedFix ? [`AI UED 建议：${enhancement.uedFix}`] : []),
    '',
    '开发定位信息：',
    JSON.stringify(issue.evidence, null, 2),
  ].join('\n');
}

function severityLabel(severity) {
  const labels = {
    Blocker: '阻断',
    Major: '严重',
    Minor: '一般',
    Suggestion: '建议',
  };
  return labels[severity] || severity;
}
