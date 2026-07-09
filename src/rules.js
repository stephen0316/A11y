const GENERIC_LINK_TEXT = /^(click here|here|more|read more|learn more|详情|更多|点击这里|查看|查看详情)$/i;

export function buildIssues({ axe, domSignals, keyboard }) {
  const issues = [];
  const axeRuleIds = new Set((axe.violations || []).map((violation) => violation.id));

  for (const violation of axe.violations || []) {
    issues.push(...axeViolationToIssues(violation));
  }

  issues.push(...customDomIssues(domSignals, axeRuleIds));
  issues.push(...keyboardIssues(keyboard));
  issues.push(...semanticReviewItems(domSignals));

  return issues.map((issue, index) => ({
    id: issue.id || `A11Y-${String(index + 1).padStart(3, '0')}`,
    ...issue,
    ruleUrl: issue.ruleUrl || ruleUrlForSource(issue.ruleSource),
  }));
}

function axeViolationToIssues(violation) {
  const copy = localizedAxeCopy(violation);
  return violation.nodes.map((node, index) => ({
    id: `AXE-${violation.id}-${index + 1}`,
    title: copy.title,
    severity: axeImpactToSeverity(violation.impact),
    tier: '自动规则',
    ruleSource: `axe-core / ${violation.id}`,
    ruleUrl: violation.helpUrl,
    impactUsers: '依赖键盘、读屏器、低视力或认知辅助能力的用户可能无法完成该区域的操作或理解。',
    reproductionSteps: [
      '打开目标页面。',
      `检查元素：${node.target.join(', ')}`,
      `参考规则：${violation.helpUrl}`,
    ],
    evidence: {
      selector: node.target.join(', '),
      html: node.html,
      failureSummary: node.failureSummary || violation.description,
      ...(node.rect ? { rect: node.rect } : {}),
    },
    recommendation: copy.recommendation,
    owner: ownerForAxeRule(violation.id),
    confidence: 'high',
  }));
}

function localizedAxeCopy(violation) {
  const dictionary = {
    'button-name': {
      title: '按钮缺少可访问名称',
      recommendation: '为按钮提供可见文本、aria-label 或 aria-labelledby，确保读屏器能读出按钮用途。',
    },
    'color-contrast': {
      title: '文字颜色对比度不足',
      recommendation: '调整前景色或背景色，使普通文本至少达到 4.5:1，大号文本至少达到 3:1。',
    },
    'heading-order': {
      title: '标题层级顺序不正确',
      recommendation: '按页面结构顺序使用 h1-h6，避免跳级造成读屏器导航混乱。',
    },
    'html-has-lang': {
      title: '页面缺少 lang 语言声明',
      recommendation: '在 html 元素上设置正确语言，例如 <html lang="zh-CN">。',
    },
    'image-alt': {
      title: '图片缺少替代文本',
      recommendation: '为信息性图片提供准确 alt；装饰图片使用空 alt；复杂图表补充等价文本说明。',
    },
    'landmark-one-main': {
      title: '页面应只有一个 main 主内容地标',
      recommendation: '确保页面只有一个主要内容地标：保留一个 <main> 或 role="main"，移除重复 main；如果页面缺少主内容区域，则补充一个 main 地标。',
    },
    label: {
      title: '表单控件缺少可访问标签',
      recommendation: '使用 label for、aria-label 或 aria-labelledby 为表单控件提供明确标签。',
    },
    'link-name': {
      title: '链接缺少可访问名称',
      recommendation: '为链接提供可见文本或 aria-label，避免空链接或只有图标但无名称。',
    },
    'aria-allowed-attr': {
      title: 'ARIA 属性使用在不支持的元素上',
      recommendation: '移除不适用的 aria-* 属性，或改用正确 role/语义元素。',
    },
    'aria-required-attr': {
      title: 'ARIA 角色缺少必需属性',
      recommendation: '按 ARIA 角色要求补齐必需 aria-* 属性，或使用原生 HTML 控件替代。',
    },
    'aria-roles': {
      title: 'ARIA role 不合法',
      recommendation: '使用有效 ARIA role，并优先选择原生 HTML 语义元素。',
    },
    region: {
      title: '页面内容缺少地标区域',
      recommendation: '使用 header、nav、main、footer 或对应 landmark role 标记主要区域。',
    },
  };

  return dictionary[violation.id] || {
    title: `页面未通过 ${violation.id} 无障碍规则`,
    recommendation: '根据该规则调整页面结构、语义、属性或可访问名称，并结合证据中的元素定位完成修复。',
  };
}

function customDomIssues(signals, axeRuleIds) {
  const issues = [];

  if (!signals.lang && !axeRuleIds.has('html-has-lang')) {
    issues.push({
      title: '页面缺少 lang 语言声明',
      severity: 'Major',
      tier: '自动规则',
      ruleSource: 'WCAG 2.2 AA / 3.1.1 Language of Page',
      impactUsers: '读屏器可能使用错误语言朗读，影响中文、英文或多语言内容理解。',
      reproductionSteps: ['打开页面。', '检查 html 根元素是否设置 lang。'],
      evidence: { selector: 'html', current: 'missing lang attribute' },
      recommendation: '在 html 元素上设置正确语言，例如 <html lang="zh-CN">。',
      owner: '研发',
      confidence: 'high',
    });
  }

  if (!axeRuleIds.has('heading-order')) {
    issues.push(...headingOrderIssues(signals.headings));
  }
  issues.push(...targetSizeIssues(signals.clickables));
  issues.push(...statusRegionIssues(signals.statusCandidates));
  issues.push(...dialogIssues(signals.dialogs));

  return issues;
}

function headingOrderIssues(headings) {
  const issues = [];
  for (let index = 1; index < headings.length; index += 1) {
    const previous = headings[index - 1];
    const current = headings[index];
    if (current.level - previous.level > 1) {
      issues.push({
        title: '标题层级跳跃',
        severity: 'Minor',
        tier: '自动规则',
        ruleSource: 'WCAG 2.2 AA / 1.3.1 Info and Relationships',
        impactUsers: '读屏器用户依赖标题结构快速理解页面层级，跳级会降低导航效率。',
        reproductionSteps: ['打开页面。', `从 "${previous.text}" 跳到 "${current.text}"。`],
        evidence: { previous, current },
        recommendation: '按页面信息架构顺序使用标题层级，避免从 h1/h2 直接跳到 h4/h5。',
        owner: 'UED + 研发',
        confidence: 'medium',
      });
    }
  }
  return issues;
}

function targetSizeIssues(clickables) {
  return clickables
    .filter((item) => !item.disabled && item.rect.width > 0 && item.rect.height > 0)
    .filter((item) => item.rect.width < 24 || item.rect.height < 24)
    .map((item) => ({
      title: '可点击目标尺寸小于 24px',
      severity: 'Minor',
      tier: '自动规则',
      ruleSource: 'WCAG 2.2 AA / 2.5.8 Target Size (Minimum)',
      impactUsers: '低视力、运动障碍或触屏用户可能难以准确触发控件。',
      reproductionSteps: ['打开页面。', `定位可点击元素：${item.selector}`],
      evidence: item,
      recommendation: '将可点击区域调整到至少 24x24 CSS px，或确保相邻目标间距满足要求。',
      owner: 'UED + 研发',
      confidence: 'medium',
    }));
}

function statusRegionIssues(statusCandidates) {
  return statusCandidates
    .filter((item) => {
      const classText = String(item.className || '').toLowerCase();
      const looksDynamic = /toast|snackbar|message|notification|loading|error/.test(classText);
      const hasLiveSemantics = item.role === 'status' || item.role === 'alert' || Boolean(item.ariaLive);
      return looksDynamic && !hasLiveSemantics;
    })
    .map((item) => ({
      title: '动态状态反馈缺少读屏可感知语义',
      severity: 'Major',
      tier: '组件规则',
      ruleSource: 'WCAG 2.2 AA / 4.1.3 Status Messages',
      impactUsers: '读屏器用户可能无法感知 toast、loading、错误或成功反馈。',
      reproductionSteps: ['触发页面状态反馈。', `检查状态元素：${item.selector}`],
      evidence: item,
      recommendation: '为非阻塞状态使用 role="status" 或 aria-live="polite"；错误或紧急反馈可使用 role="alert"。',
      owner: '研发',
      confidence: 'medium',
    }));
}

function dialogIssues(dialogs) {
  const issues = [];
  for (const dialog of dialogs) {
    if (!dialog.role) {
      issues.push({
        title: '弹窗/抽屉缺少 dialog 语义',
        severity: 'Major',
        tier: '组件规则',
        ruleSource: 'ARIA APG / Dialog Pattern',
        impactUsers: '读屏器用户可能无法识别当前进入了模态交互区域。',
        reproductionSteps: ['打开弹窗或抽屉。', `检查容器：${dialog.selector}`],
        evidence: dialog,
        recommendation: '为弹窗容器设置 role="dialog" 或 role="alertdialog"，并补充可访问名称。',
        owner: '研发',
        confidence: 'medium',
      });
    }

    if (!dialog.name) {
      issues.push({
        title: '弹窗/抽屉缺少可访问名称',
        severity: 'Major',
        tier: '组件规则',
        ruleSource: 'ARIA APG / Dialog Pattern',
        impactUsers: '读屏器用户无法快速判断弹窗目的。',
        reproductionSteps: ['打开弹窗或抽屉。', `检查容器：${dialog.selector}`],
        evidence: dialog,
        recommendation: '通过 aria-labelledby 关联弹窗标题，或使用 aria-label 提供明确名称。',
        owner: 'UED + 研发',
        confidence: 'medium',
      });
    }
  }
  return issues;
}

function keyboardIssues(keyboard) {
  const issues = [];

  if (keyboard.possibleTrap) {
    issues.push({
      title: '疑似键盘焦点陷阱',
      severity: 'Blocker',
      tier: '行为检测',
      ruleSource: 'WCAG 2.2 AA / 2.1.2 No Keyboard Trap',
      impactUsers: '键盘用户可能无法离开当前控件或继续完成任务。',
      reproductionSteps: ['打开页面。', `连续按 Tab ${keyboard.maxTabs} 次。`, '观察焦点是否始终停留在同一元素。'],
      evidence: { uniqueFocusedCount: keyboard.uniqueFocusedCount, path: keyboard.path },
      recommendation: '修正焦点管理，确保 Tab/Shift+Tab 能进入、遍历并离开组件。',
      owner: '研发',
      confidence: 'medium',
    });
  }

  for (const item of keyboard.focusVisibleFailures.slice(0, 10)) {
    issues.push({
      title: '焦点指示可能不可见',
      severity: 'Major',
      tier: '行为检测',
      ruleSource: 'WCAG 2.2 AA / 2.4.7 Focus Visible',
      impactUsers: '键盘用户可能不知道当前操作位置。',
      reproductionSteps: ['打开页面。', `按 Tab 到第 ${item.step} 个焦点元素。`, `观察元素：${item.selector}`],
      evidence: item,
      recommendation: '为该控件保留或补充清晰可见的 focus 样式，避免 outline: none 后没有替代样式。',
      owner: 'UED + 研发',
      confidence: 'medium',
    });
  }

  return issues;
}

function semanticReviewItems(signals) {
  const issues = [];

  for (const image of signals.images.filter((item) => item.alt || item.ariaLabel).slice(0, 20)) {
    issues.push({
      title: '需要复核图片替代文本是否准确',
      severity: 'Suggestion',
      tier: 'AI辅助判断',
      ruleSource: 'WCAG 2.2 AA / 1.1.1 Non-text Content',
      impactUsers: '读屏器用户依赖替代文本理解图片承载的信息。',
      reproductionSteps: ['查看截图与 DOM 证据。', `复核图片：${image.selector}`],
      evidence: image,
      recommendation: '结合页面任务判断 alt 是否传达了图片的功能或信息；装饰图应使用空 alt。',
      owner: 'UED',
      confidence: 'needs-review',
    });
  }

  for (const link of signals.links.filter((item) => GENERIC_LINK_TEXT.test(item.name || item.text)).slice(0, 20)) {
    issues.push({
      title: '链接文案需要补充上下文',
      severity: 'Minor',
      tier: 'AI辅助判断',
      ruleSource: 'WCAG 2.2 AA / 2.4.4 Link Purpose',
      impactUsers: '读屏器用户单独浏览链接列表时，可能无法判断链接目的。',
      reproductionSteps: ['打开页面。', `检查链接：${link.selector}`],
      evidence: link,
      recommendation: '将“更多/查看详情/点击这里”改为能独立表达目的的链接文本，或通过 aria-label 补充上下文。',
      owner: 'UED + 研发',
      confidence: 'medium',
    });
  }

  for (const image of signals.images.filter((item) => item.tag === 'canvas' || item.tag === 'svg').slice(0, 20)) {
    issues.push({
      title: '图表或复杂图形需要等价文本说明',
      severity: 'Major',
      tier: '人工确认',
      ruleSource: 'WCAG 2.2 AA / 1.1.1 Non-text Content',
      impactUsers: '无法查看图形的用户需要通过文本获得同等信息。',
      reproductionSteps: ['查看页面图形区域。', `复核元素：${image.selector}`],
      evidence: image,
      recommendation: '为图表提供摘要、数据表或可访问名称；复杂趋势应提供等价文本说明。',
      owner: 'UED + 内容',
      confidence: 'needs-review',
    });
  }

  return issues;
}

function ruleUrlForSource(ruleSource = '') {
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
  if (ruleSource.includes('Dialog Pattern')) {
    return 'https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/';
  }
  return '';
}

function axeImpactToSeverity(impact) {
  if (impact === 'critical') {
    return 'Blocker';
  }
  if (impact === 'serious') {
    return 'Major';
  }
  if (impact === 'moderate') {
    return 'Major';
  }
  return 'Minor';
}

function ownerForAxeRule(ruleId) {
  if (/color-contrast|target-size/.test(ruleId)) {
    return 'UED + 研发';
  }
  if (/label|aria|button-name|link-name|html-has-lang/.test(ruleId)) {
    return '研发';
  }
  if (/image-alt|link-in-text-block/.test(ruleId)) {
    return 'UED + 内容';
  }
  return 'UED + 研发';
}
