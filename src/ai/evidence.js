const LIMITS = {
  axeViolations: 6,
  axeNodes: 1,
  headings: 12,
  images: 8,
  forms: 10,
  clickables: 12,
  statusCandidates: 6,
  dialogs: 5,
  links: 10,
  keyboardPath: 16,
  keyboardFailures: 6,
  issues: 10,
  issueGroups: 8,
  accessibilityNodes: 24,
};

export function buildEvidencePack({ target, axe, domSignals, keyboard, accessibilityTree, issues }) {
  return {
    target: {
      name: target?.name || '',
      url: target?.url || '',
      notes: target?.notes || '',
      steps: compactSteps(target?.steps || []),
    },
    page: {
      title: domSignals?.title || '',
      lang: domSignals?.lang || '',
    },
    axe: summarizeAxe(axe),
    dom: summarizeDom(domSignals || {}),
    keyboard: summarizeKeyboard(keyboard || {}),
    accessibilityTree: summarizeAccessibilityTree(accessibilityTree),
    issueStats: summarizeIssueStats(issues || []),
    issues: summarizeIssues(prioritizeIssues(issues || [])),
  };
}

function compactSteps(steps) {
  return steps.slice(0, 20).map((step) => ({
    action: step.action,
    selector: step.selector || '',
    key: step.key || '',
    value: step.value ? truncate(step.value, 80) : '',
    ms: step.ms || undefined,
  }));
}

function summarizeAxe(axe = {}) {
  const violations = (axe.violations || []).slice(0, LIMITS.axeViolations).map((violation) => ({
    id: violation.id,
    impact: violation.impact || '',
    help: violation.help || violation.description || '',
    helpUrl: violation.helpUrl || '',
    nodes: (violation.nodes || []).slice(0, LIMITS.axeNodes).map((node) => ({
      target: node.target,
      html: truncate(node.html, 240),
      failureSummary: truncate(node.failureSummary || '', 260),
    })),
  }));

  return {
    violationCount: axe.violations?.length || 0,
    incompleteCount: axe.incomplete?.length || 0,
    passesCount: axe.passes?.length || 0,
    violations,
  };
}

function summarizeDom(signals) {
  return {
    headings: take(signals.headings, LIMITS.headings).map((item) => pick(item, ['level', 'text', 'selector'])),
    images: take(signals.images, LIMITS.images).map((item) => pick(item, ['tag', 'selector', 'alt', 'role', 'ariaLabel', 'ariaHidden', 'text', 'rect'])),
    forms: take(signals.forms, LIMITS.forms).map((item) => pick(item, ['tag', 'selector', 'type', 'name', 'required', 'invalid'])),
    clickables: take(signals.clickables, LIMITS.clickables).map((item) => pick(item, ['tag', 'selector', 'role', 'type', 'text', 'name', 'disabled', 'tabIndex', 'rect'])),
    statusCandidates: take(signals.statusCandidates, LIMITS.statusCandidates).map((item) => pick(item, ['selector', 'role', 'ariaLive', 'text', 'className'])),
    dialogs: take(signals.dialogs, LIMITS.dialogs).map((item) => pick(item, ['selector', 'role', 'ariaModal', 'name', 'text'])),
    links: take(signals.links, LIMITS.links).map((item) => pick(item, ['selector', 'href', 'text', 'name'])),
  };
}

function summarizeKeyboard(keyboard) {
  return {
    maxTabs: keyboard.maxTabs || 0,
    uniqueFocusedCount: keyboard.uniqueFocusedCount || 0,
    possibleTrap: Boolean(keyboard.possibleTrap),
    path: take(keyboard.path, LIMITS.keyboardPath).map((item) => pick(item, ['step', 'selector', 'tag', 'role', 'name', 'text', 'rect', 'focusVisible'])),
    focusVisibleFailures: take(keyboard.focusVisibleFailures, LIMITS.keyboardFailures).map((item) => pick(item, ['step', 'selector', 'tag', 'role', 'name', 'rect', 'focusStyle'])),
  };
}

function summarizeIssues(issues) {
  return issues.slice(0, LIMITS.issues).map((issue) => ({
    id: issue.id,
    title: issue.title,
    severity: issue.severity,
    tier: issue.tier,
    ruleSource: issue.ruleSource,
    owner: issue.owner,
    confidence: issue.confidence,
    impactUsers: truncate(issue.impactUsers, 180),
    recommendation: truncate(issue.recommendation, 200),
    selector: issue.evidence?.selector || issue.evidence?.target || '',
  }));
}

function summarizeIssueStats(issues) {
  return {
    total: issues.length,
    bySeverity: countBy(issues, 'severity'),
    byTier: countBy(issues, 'tier'),
    groups: Object.values(issues.reduce((result, issue) => {
      const key = `${issue.tier || ''}|${issue.title || ''}|${issue.ruleSource || ''}`;
      const current = result[key] || {
        title: issue.title,
        severity: issue.severity,
        tier: issue.tier,
        ruleSource: issue.ruleSource,
        count: 0,
        selectors: [],
        issueIds: [],
      };
      current.count += 1;
      if (current.selectors.length < 5) {
        const selector = issue.evidence?.selector || issue.evidence?.target || '';
        if (selector && !current.selectors.includes(selector)) {
          current.selectors.push(selector);
        }
      }
      if (current.issueIds.length < 8) {
        current.issueIds.push(issue.id);
      }
      result[key] = current;
      return result;
    }, {}))
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.count - a.count)
      .slice(0, LIMITS.issueGroups),
  };
}

function prioritizeIssues(issues) {
  return [...issues].sort((a, b) => (
    severityRank(b.severity) - severityRank(a.severity)
    || tierRank(a.tier) - tierRank(b.tier)
    || String(a.id).localeCompare(String(b.id))
  ));
}

function summarizeAccessibilityTree(tree) {
  if (!tree || tree.unavailable) {
    return {
      unavailable: Boolean(tree?.unavailable),
      reason: tree?.reason || '',
      nodes: [],
    };
  }

  const nodes = [];
  collectAccessibilityNodes(tree, nodes);
  return {
    unavailable: false,
    nodeCount: nodes.length,
    nodes: nodes.slice(0, LIMITS.accessibilityNodes),
  };
}

function collectAccessibilityNodes(node, nodes, depth = 0) {
  if (!node || nodes.length >= LIMITS.accessibilityNodes) {
    return;
  }

  if (Array.isArray(node.nodes)) {
    for (const child of node.nodes) {
      collectAccessibilityNodes(child, nodes, depth);
    }
    return;
  }

  const role = stringValue(node.role);
  const name = stringValue(node.name);
  const value = stringValue(node.value);
  if (role || name || value) {
    nodes.push({
      depth,
      role: truncate(role, 80),
      name: truncate(name, 160),
      value: truncate(value, 120),
      ignored: Boolean(node.ignored),
    });
  }

  for (const child of node.children || []) {
    collectAccessibilityNodes(child, nodes, depth + 1);
  }
}

function stringValue(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    return value.value || value.name || '';
  }
  return '';
}

function take(items, limit) {
  return Array.isArray(items) ? items.slice(0, limit) : [];
}

function countBy(items, key) {
  return items.reduce((result, item) => {
    const value = item[key] || '未分类';
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

function severityRank(severity) {
  return {
    Suggestion: 1,
    Minor: 2,
    Major: 3,
    Blocker: 4,
  }[severity] || 0;
}

function tierRank(tier) {
  return {
    自动规则: 1,
    组件规则: 2,
    行为检测: 3,
    AI辅助判断: 4,
    人工确认: 5,
  }[tier] || 9;
}

function pick(item, keys) {
  const result = {};
  for (const key of keys) {
    if (item?.[key] !== undefined) {
      result[key] = typeof item[key] === 'string' ? truncate(item[key], 240) : item[key];
    }
  }
  return result;
}

function truncate(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}
