const state = {
  audit: null,
  links: null,
  severityFilter: 'all',
  tierFilter: 'all',
};

const LAST_AUDIT_KEY = 'a11y:lastAuditReport';

const els = {
  form: document.querySelector('[data-audit-form]'),
  runButton: document.querySelector('[data-run-audit]'),
  newAuditButton: document.querySelector('[data-new-audit]'),
  commandLabel: document.querySelector('[data-command-label]'),
  loadingSpinner: document.querySelector('[data-loading-spinner]'),
  stepsList: document.querySelector('[data-steps-list]'),
  stepTemplate: document.querySelector('#step-template'),
  addStepButton: document.querySelector('[data-add-step]'),
  clearStepsButton: document.querySelector('[data-clear-steps]'),
  emptyState: document.querySelector('[data-empty-state]'),
  result: document.querySelector('[data-result]'),
  summaryStrip: document.querySelector('[data-summary-strip]'),
  aiPanel: document.querySelector('[data-ai-panel]'),
  artifactBar: document.querySelector('[data-artifact-bar]'),
  issueList: document.querySelector('[data-issue-list]'),
  severityFilter: document.querySelector('[data-severity-filter]'),
  tierFilter: document.querySelector('[data-tier-filter]'),
};

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await runAudit();
});

els.addStepButton.addEventListener('click', () => addStepRow());
els.clearStepsButton.addEventListener('click', () => {
  els.stepsList.replaceChildren();
});

els.newAuditButton.addEventListener('click', () => {
  clearSavedAudit();
  resetCurrentAudit();
});

els.severityFilter.addEventListener('change', () => {
  state.severityFilter = els.severityFilter.value;
  renderIssues();
});

els.tierFilter.addEventListener('change', () => {
  state.tierFilter = els.tierFilter.value;
  renderIssues();
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.custom-select, .export-menu')) {
    closeOpenDropdowns();
  }
});

enhanceSelects();
setLoading(false);
restoreLastAudit();

async function runAudit() {
  setLoading(true);
  els.runButton.disabled = true;

  try {
    const payload = formPayload();
    const response = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || '审计失败');
    }

    state.audit = data.report.audit;
    state.links = data.report.links;
    saveLastAudit(data.report);
    renderResult();
    toast('审计完成');
  } catch (error) {
    toast(error.message || '审计失败');
  } finally {
    els.runButton.disabled = false;
    setLoading(false);
  }
}

function restoreLastAudit() {
  const saved = readSavedAudit();
  if (!saved?.audit || !saved?.links) {
    return;
  }

  state.audit = saved.audit;
  state.links = saved.links;
  renderResult();
}

function saveLastAudit(report) {
  try {
    window.localStorage.setItem(LAST_AUDIT_KEY, JSON.stringify({
      audit: report.audit,
      links: report.links,
      savedAt: new Date().toISOString(),
    }));
  } catch {
    // Local storage can be unavailable in restrictive browser contexts.
  }
}

function readSavedAudit() {
  try {
    return JSON.parse(window.localStorage.getItem(LAST_AUDIT_KEY) || 'null');
  } catch {
    clearSavedAudit();
    return null;
  }
}

function clearSavedAudit() {
  try {
    window.localStorage.removeItem(LAST_AUDIT_KEY);
  } catch {
    // Ignore storage failures; the visible state can still be reset.
  }
}

function resetCurrentAudit() {
  state.audit = null;
  state.links = null;
  state.severityFilter = 'all';
  state.tierFilter = 'all';
  els.severityFilter.value = 'all';
  els.tierFilter.value = 'all';
  syncCustomSelect(els.severityFilter);
  syncCustomSelect(els.tierFilter);
  els.emptyState.hidden = false;
  els.result.hidden = true;
  els.summaryStrip.replaceChildren();
  els.aiPanel.replaceChildren();
  els.artifactBar.replaceChildren();
  els.issueList.replaceChildren();
}

function formPayload() {
  const form = new FormData(els.form);
  return {
    url: String(form.get('url') || '').trim(),
    name: String(form.get('name') || '').trim(),
    notes: String(form.get('notes') || '').trim(),
    viewport: String(form.get('viewport') || '1440x1000'),
    maxTabs: Number(form.get('maxTabs') || 30),
    ai: {
      enabled: form.get('aiEnabled') === 'on',
    },
    steps: readSteps(),
  };
}

function readSteps() {
  return Array.from(els.stepsList.querySelectorAll('.step-row'))
    .map((row) => {
      const action = row.querySelector('[data-step-action]').value;
      const selector = row.querySelector('[data-step-selector]').value.trim();
      const value = row.querySelector('[data-step-value]').value.trim();

      if (action === 'wait') {
        return { action, ms: Number(value || 1000) };
      }
      if (action === 'press') {
        return { action, key: value || 'Enter' };
      }
      if (action === 'fill') {
        return { action, selector, value };
      }
      if (action === 'waitForSelector') {
        return { action, selector };
      }
      return { action, selector };
    })
    .filter((step) => step.action === 'wait' || step.key || step.selector);
}

function addStepRow() {
  const fragment = els.stepTemplate.content.cloneNode(true);
  const row = fragment.querySelector('.step-row');
  row.querySelector('[data-remove-step]').addEventListener('click', () => row.remove());
  enhanceSelect(row.querySelector('select'));
  els.stepsList.append(fragment);
}

function enhanceSelects(root = document) {
  root.querySelectorAll('select').forEach((select) => enhanceSelect(select));
}

function enhanceSelect(select) {
  if (!select || select.dataset.enhancedSelect === 'true') {
    return;
  }

  select.dataset.enhancedSelect = 'true';
  select.classList.add('native-select-hidden');

  const menu = document.createElement('details');
  menu.className = 'custom-select';
  menu.innerHTML = `
    <summary>
      <span data-custom-select-label></span>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M5.5 7.5 10 12l4.5-4.5 1.1 1.1L10 14.2 4.4 8.6l1.1-1.1z"></path>
      </svg>
    </summary>
    <div class="custom-select-options"></div>
  `;

  const options = menu.querySelector('.custom-select-options');
  Array.from(select.options).forEach((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.value = option.value;
    button.textContent = option.textContent;
    button.addEventListener('click', () => {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncCustomSelect(select);
      menu.open = false;
    });
    options.append(button);
  });

  select.insertAdjacentElement('afterend', menu);
  registerDropdown(menu);
  select.addEventListener('change', () => syncCustomSelect(select));
  syncCustomSelect(select);
}

function registerDropdown(dropdown) {
  dropdown.querySelector('summary')?.addEventListener('click', () => {
    closeOpenDropdowns(dropdown);
  });

  dropdown.addEventListener('toggle', () => {
    if (dropdown.open) {
      closeOpenDropdowns(dropdown);
    }
  });
}

function closeOpenDropdowns(except = null) {
  document.querySelectorAll('.custom-select[open], .export-menu[open]').forEach((dropdown) => {
    if (dropdown !== except) {
      dropdown.open = false;
    }
  });
}

function syncCustomSelect(select) {
  const menu = select?.nextElementSibling;
  if (!menu?.classList.contains('custom-select')) {
    return;
  }

  const selected = select.selectedOptions[0];
  menu.querySelector('[data-custom-select-label]').textContent = selected?.textContent || '';
  menu.querySelectorAll('.custom-select-options button').forEach((button) => {
    const isSelected = button.dataset.value === select.value;
    button.classList.toggle('is-selected', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
  });
}

function renderResult() {
  els.emptyState.hidden = true;
  els.result.hidden = false;
  renderSummary();
  renderAiPanel();
  renderArtifacts();
  renderIssues();
}

function renderSummary() {
  const summary = state.audit.summary || {};
  const bySeverity = summary.bySeverity || {};
  const totalMetric = ['total', '全部问题', summary.total || 0, '本次审计发现的全部问题数量，包含自动规则、组件规则、行为检测和建议项。'];
  const severityMetrics = [
    ['blocker', '阻断', bySeverity.Blocker || 0, '会阻碍用户完成核心任务，或导致键盘、读屏等用户无法继续使用；发布前必须优先修复。'],
    ['major', '严重', bySeverity.Major || 0, '明显影响用户理解、操作或完成关键流程，应作为高优先级缺陷修复。'],
    ['minor', '一般', bySeverity.Minor || 0, '影响局部体验或存在可绕过路径，建议纳入常规迭代修复。'],
    ['suggestion', '建议', bySeverity.Suggestion || 0, '偏体验优化、文案理解或需要人工复核的项目，不等同于 WCAG 强制失败项。'],
  ];

  const screenshot = document.createElement('a');
  screenshot.className = 'screenshot-preview';
  screenshot.href = state.links.screenshot;
  screenshot.target = '_blank';
  screenshot.rel = 'noreferrer';
  screenshot.setAttribute('aria-label', '查看完整页面截图');
  screenshot.innerHTML = `
    <img src="${escapeAttribute(state.links.screenshot)}" alt="目标页面首屏截图预览" />
    <span>点击查看完整截图</span>
  `;

  const metricsPanel = document.createElement('div');
  metricsPanel.className = 'metrics-panel';
  metricsPanel.append(
    renderMetric(totalMetric, 'primary'),
    renderMetricGroup(severityMetrics),
  );

  els.summaryStrip.replaceChildren(screenshot, metricsPanel);
}

function renderAiPanel() {
  const ai = state.audit.ai;
  if (!ai) {
    els.aiPanel.replaceChildren();
    return;
  }

  const panel = document.createElement('section');
  panel.className = `ai-card ai-${escapeHtml(ai.status || 'disabled')}`;

  if (ai.status === 'disabled') {
    panel.innerHTML = `
      <header>
        <h4>AI 语义复核未启用</h4>
        <span class="pill subtle">Gemini</span>
      </header>
      <p>${escapeHtml(ai.reason || '未配置 API Key 或本次关闭。')}</p>
    `;
    els.aiPanel.replaceChildren(panel);
    return;
  }

  if (ai.status === 'failed') {
    panel.innerHTML = `
      <header>
        <div>
          <h4>AI 语义复核调用失败</h4>
          <p>${escapeHtml(ai.model || 'gemini')}</p>
        </div>
        <span class="pill Major">降级</span>
      </header>
      <p class="ai-verdict">AI 服务暂时不可用，已使用规则检测结果生成本次报告。</p>
    `;
    els.aiPanel.replaceChildren(panel);
    return;
  }

  const summary = ai.summary || {};
  panel.innerHTML = `
    <header>
      <div>
        <h4>AI 审计摘要</h4>
        <p>${escapeHtml(ai.model || 'gemini')}</p>
      </div>
      <span class="pill ${riskPill(summary.riskLevel)}">${escapeHtml(summary.riskLevel || 'unknown')}</span>
    </header>
    <p class="ai-verdict">${escapeHtml(summary.verdict || 'AI 未返回页面级结论。')}</p>
    ${renderAiList('关键发现', summary.keyFindings)}
    ${renderAiList('建议下一步', summary.recommendedNextSteps)}
    ${renderSemanticFindingList(ai.semanticFindings || [])}
  `;
  els.aiPanel.replaceChildren(panel);
}

function renderAiList(title, items = []) {
  if (!items.length) {
    return '';
  }
  return `
    <div class="ai-list">
      <strong>${escapeHtml(title)}</strong>
      <ul>
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>
    </div>
  `;
}

function renderSemanticFindingList(findings) {
  if (!findings.length) {
    return '<p class="ai-muted">AI 未发现额外语义复核项。</p>';
  }

  return `
    <div class="ai-findings">
      <strong>AI 语义复核</strong>
      ${findings.map((finding) => `
        <article>
          <h5>${escapeHtml(finding.title)}</h5>
          <p>${escapeHtml(finding.reason)}</p>
          <p><strong>建议：</strong>${escapeHtml(finding.recommendation)}</p>
          <div class="issue-meta">
            <span class="pill ${escapeHtml(finding.severity)}">${escapeHtml(severityLabel(finding.severity))}</span>
            <span class="pill">${escapeHtml(finding.category)}</span>
            <span class="pill subtle">${escapeHtml(finding.confidence)}</span>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderArtifacts() {
  const links = [
    ['Markdown', state.links.report],
    ['JSON', state.links.audit],
    ['AX Tree', state.links.accessibilityTree],
  ];

  const menu = document.createElement('details');
  menu.className = 'export-menu';
  menu.innerHTML = `
    <summary>
      <span>导出为</span>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M5.5 7.5 10 12l4.5-4.5 1.1 1.1L10 14.2 4.4 8.6l1.1-1.1z"></path>
      </svg>
    </summary>
    <div class="export-options">
      ${links.map(([label, href]) => `
        <a href="${escapeAttribute(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>
      `).join('')}
    </div>
  `;

  els.artifactBar.replaceChildren(menu);
  registerDropdown(menu);
}

function renderMetric([className, label, value, tooltip], variant = 'secondary') {
  const item = document.createElement('div');
  item.className = `metric ${className} ${variant === 'primary' ? 'primary-metric' : 'submetric'}`;
  item.tabIndex = 0;
  item.dataset.tooltip = tooltip;
  item.setAttribute('aria-label', `${label}：${value}。${tooltip}`);
  item.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
  return item;
}

function renderMetricGroup(metrics) {
  const group = document.createElement('div');
  group.className = 'metric-subgrid';
  group.replaceChildren(...metrics.map((metric) => renderMetric(metric)));
  return group;
}

function renderIssues() {
  if (!state.audit) {
    return;
  }

  const issues = state.audit.issues.filter((issue) => {
    const severityMatch = state.severityFilter === 'all' || issue.severity === state.severityFilter;
    const tierMatch = state.tierFilter === 'all' || issue.tier === state.tierFilter;
    return severityMatch && tierMatch;
  });

  if (!issues.length) {
    const empty = document.createElement('div');
    empty.className = 'issue-card';
    empty.textContent = '当前筛选条件下没有问题。';
    els.issueList.replaceChildren(empty);
    return;
  }

  els.issueList.replaceChildren(...issues.map(renderIssueCard));
}

function renderIssueCard(issue) {
  const card = document.createElement('article');
  card.className = 'issue-card';
  const enhancement = findIssueEnhancement(issue.id);

  const header = document.createElement('header');
  header.innerHTML = `
    <div>
      <h3>${escapeHtml(issue.title)}</h3>
      <div class="issue-meta">
        <span class="pill ${escapeHtml(issue.severity)}">${escapeHtml(severityLabel(issue.severity))}</span>
        <span class="pill">${escapeHtml(issue.tier)}</span>
        <span class="pill">${escapeHtml(issue.owner)}</span>
        <span class="pill subtle">${escapeHtml(issue.id)}</span>
      </div>
    </div>
  `;

  const body = document.createElement('div');
  body.className = 'issue-body';
  body.innerHTML = `
    <section class="issue-fields">
      ${renderIssueElement(issue)}
      ${renderIssueEnhancement(enhancement, issue)}
    </section>
    ${renderIssueEvidenceDetails(issue)}
  `;

  body.querySelector('[data-copy-evidence]')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(JSON.stringify(issue.evidence, null, 2));
    toast('问题定位信息已复制');
  });

  if (enhancement?.copyableIssue) {
    const copyButton = document.createElement('button');
    copyButton.className = 'secondary-action copy-issue-action';
    copyButton.type = 'button';
    copyButton.textContent = '复制 AI Issue';
    copyButton.addEventListener('click', async () => {
      await navigator.clipboard.writeText(enhancement.copyableIssue);
      toast('AI Issue 文案已复制');
    });
    body.insertBefore(copyButton, body.querySelector('.evidence-details'));
  }

  card.append(header, body);
  return card;
}

function renderIssueElement(issue) {
  const evidence = issue.evidence || {};

  return `
    <p class="issue-field-row"><strong>问题元素：</strong>${escapeHtml(evidenceSummary(evidence))}</p>
  `;
}

function renderIssueEvidenceDetails(issue) {
  const rawEvidence = JSON.stringify(issue.evidence || {}, null, 2);

  return `
    <details class="evidence-details">
      <summary>问题定位信息</summary>
      <div class="evidence-copy-wrap">
        <pre class="evidence">${escapeHtml(rawEvidence)}</pre>
        <button class="copy-evidence-action" type="button" data-copy-evidence>复制</button>
      </div>
    </details>
  `;
}

function renderIssueEnhancement(enhancement, issue) {
  const userImpact = enhancement?.userImpact || issue.impactUsers;
  const developerFix = enhancement?.developerFix || issue.recommendation;

  return `
      ${userImpact ? `<p class="issue-field-row"><strong>用户影响：</strong>${escapeHtml(userImpact)}</p>` : ''}
      <p class="issue-field-row rule-source-line"><strong>判断依据：</strong>${renderRuleSource(issue)}</p>
      ${developerFix ? `<p class="issue-field-row"><strong>研发修复：</strong>${escapeHtml(developerFix)}</p>` : ''}
      ${enhancement?.codeExample ? `<pre class="evidence">${escapeHtml(enhancement.codeExample)}</pre>` : ''}
  `;
}

function findIssueEnhancement(issueId) {
  return (state.audit.ai?.issueEnhancements || []).find((item) => item.issueId === issueId);
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

function renderRuleSource(issue) {
  const rule = displayRuleForIssue(issue);
  const source = escapeHtml(rule.source);
  if (!rule.url) {
    return source;
  }

  return `
    <span>${source}</span>
    <a class="rule-source-link" href="${escapeAttribute(rule.url)}" target="_blank" rel="noreferrer" aria-label="打开 ${source} 规则说明">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z"></path>
        <path d="M5 5h6v2H7v10h10v-4h2v6H5V5z"></path>
      </svg>
    </a>
  `;
}

function displayRuleForIssue(issue = {}) {
  const explicitRuleUrl = ruleUrlForSource(issue.ruleSource);
  if (explicitRuleUrl) {
    return { source: issue.ruleSource, url: explicitRuleUrl };
  }

  const axeRule = wcagRuleForAxeIssue(issue);
  if (axeRule) {
    return axeRule;
  }

  return {
    source: issue.ruleSource || '',
    url: issue.ruleUrl || '',
  };
}

function wcagRuleForAxeIssue(issue = {}) {
  const key = [issue.id, issue.ruleSource, issue.ruleUrl].filter(Boolean).join(' ').toLowerCase();
  const mappings = [
    {
      pattern: /color-contrast/,
      source: 'WCAG 2.2 AA / 1.4.3 Contrast (Minimum)',
      url: 'https://www.w3.org/TR/WCAG22/#contrast-minimum',
    },
    {
      pattern: /heading-order|landmark-one-main|region/,
      source: 'WCAG 2.2 AA / 1.3.1 Info and Relationships',
      url: 'https://www.w3.org/TR/WCAG22/#info-and-relationships',
    },
    {
      pattern: /html-has-lang/,
      source: 'WCAG 2.2 AA / 3.1.1 Language of Page',
      url: 'https://www.w3.org/TR/WCAG22/#language-of-page',
    },
    {
      pattern: /image-alt/,
      source: 'WCAG 2.2 AA / 1.1.1 Non-text Content',
      url: 'https://www.w3.org/TR/WCAG22/#non-text-content',
    },
    {
      pattern: /aria-|button-name|label|link-name/,
      source: 'WCAG 2.2 AA / 4.1.2 Name, Role, Value',
      url: 'https://www.w3.org/TR/WCAG22/#name-role-value',
    },
  ];

  return mappings.find((mapping) => mapping.pattern.test(key)) || null;
}

function ruleUrlForSource(ruleSource = '') {
  if (ruleSource.includes('1.4.3')) {
    return 'https://www.w3.org/TR/WCAG22/#contrast-minimum';
  }
  if (ruleSource.includes('3.1.1')) {
    return 'https://www.w3.org/TR/WCAG22/#language-of-page';
  }
  if (ruleSource.includes('1.3.1')) {
    return 'https://www.w3.org/TR/WCAG22/#info-and-relationships';
  }
  if (ruleSource.includes('2.5.8')) {
    return 'https://www.w3.org/TR/WCAG22/#target-size-minimum';
  }
  if (ruleSource.includes('4.1.3')) {
    return 'https://www.w3.org/TR/WCAG22/#status-messages';
  }
  if (ruleSource.includes('2.1.2')) {
    return 'https://www.w3.org/TR/WCAG22/#no-keyboard-trap';
  }
  if (ruleSource.includes('2.4.7')) {
    return 'https://www.w3.org/TR/WCAG22/#focus-visible';
  }
  if (ruleSource.includes('1.1.1')) {
    return 'https://www.w3.org/TR/WCAG22/#non-text-content';
  }
  if (ruleSource.includes('2.4.4')) {
    return 'https://www.w3.org/TR/WCAG22/#link-purpose-in-context';
  }
  if (ruleSource.includes('4.1.2')) {
    return 'https://www.w3.org/TR/WCAG22/#name-role-value';
  }
  if (ruleSource.includes('Dialog Pattern')) {
    return 'https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/';
  }
  return '';
}

function evidenceSummary(evidence) {
  if (evidence.previous && evidence.current) {
    return `从「${evidenceText(evidence.previous)}」跳到「${evidenceText(evidence.current)}」，需要复核页面结构顺序。`;
  }

  if (Array.isArray(evidence.path)) {
    return `键盘遍历记录包含 ${evidence.path.length} 个焦点节点，实际聚焦到 ${evidence.uniqueFocusedCount || evidence.path.length} 个不同元素。`;
  }

  const parts = [];
  const elementType = elementTypeLabel(evidence);
  const text = evidenceText(evidence);
  const selector = evidenceSelector(evidence);

  if (elementType && text) {
    parts.push(`${elementType}「${text}」`);
  } else if (elementType) {
    parts.push(elementType);
  } else if (text) {
    parts.push(`文本「${text}」`);
  }

  if (selector) {
    parts.push(selector);
  }
  if (evidence.role) {
    parts.push(`role=${evidence.role}`);
  }
  if (evidence.type) {
    parts.push(`type=${evidence.type}`);
  }
  if (evidence.tabIndex !== undefined && evidence.tabIndex !== null && Number(evidence.tabIndex) >= 0) {
    parts.push('可键盘聚焦');
  }
  if (evidence.disabled === true) {
    parts.push('禁用状态');
  }
  if (evidence.rect?.width !== undefined && evidence.rect?.height !== undefined) {
    parts.push(`当前尺寸 ${evidence.rect.width}×${evidence.rect.height}px`);
  }
  if (evidence.current) {
    parts.push(`当前状态：${String(evidence.current)}`);
  }
  if (evidence.failureSummary) {
    parts.push(evidence.failureSummary);
  }

  return parts.length ? parts.join(' · ') : '系统记录到该问题的运行时元素和检测上下文，可展开查看问题定位信息。';
}

function elementTypeLabel(evidence) {
  const tag = String(evidence.tag || '').toLowerCase();
  const role = String(evidence.role || '').toLowerCase();
  const type = String(evidence.type || '').toLowerCase();

  if (tag === 'a' || role === 'link') {
    return '链接';
  }
  if (tag === 'button' || role === 'button') {
    return '按钮';
  }
  if (tag === 'img') {
    return '图片';
  }
  if (tag === 'input') {
    return type ? `${type} 输入框` : '输入框';
  }
  if (tag === 'textarea') {
    return '多行输入框';
  }
  if (tag === 'select') {
    return '下拉选择框';
  }
  if (tag === 'dialog' || role === 'dialog' || role === 'alertdialog') {
    return '弹窗';
  }
  if (tag) {
    return `<${tag}> 元素`;
  }
  return '';
}

function evidenceText(evidence) {
  return String(evidence.name || evidence.text || evidence.alt || evidence.label || evidence.selector || '').trim();
}

function evidenceSelector(evidence) {
  if (Array.isArray(evidence?.target)) {
    return evidence.target.join(', ');
  }
  return String(evidence?.selector || evidence?.target || '').trim();
}

function riskPill(riskLevel) {
  if (riskLevel === 'high') {
    return 'Major';
  }
  if (riskLevel === 'medium') {
    return 'Minor';
  }
  return 'Suggestion';
}

function setLoading(isLoading) {
  els.runButton.classList.toggle('is-loading', isLoading);
  els.commandLabel.textContent = isLoading ? '审计中...' : '开始审计';
}

function toast(message) {
  const existing = document.querySelector('.toast');
  existing?.remove();

  const node = document.createElement('div');
  node.className = 'toast';
  node.setAttribute('role', 'status');
  node.textContent = message;
  document.body.append(node);
  window.setTimeout(() => node.remove(), 3600);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}
