import * as React from 'react';
import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ExternalLink,
  History,
  Image as ImageIcon,
  Info,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import { Badge } from './components/ui/badge.jsx';
import { Button } from './components/ui/button.jsx';
import { Card } from './components/ui/card.jsx';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './components/ui/collapsible.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu.jsx';
import { Input } from './components/ui/input.jsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select.jsx';
import { Textarea } from './components/ui/textarea.jsx';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './components/ui/tooltip.jsx';
import { cn } from './lib/utils.js';

const LAST_AUDIT_KEY = 'a11y:lastAuditReport';

const viewportOptions = [
  { value: '1440x1000', label: '桌面 1440×1000' },
  { value: '1280x800', label: '笔记本 1280×800' },
  { value: '390x844', label: '移动 390×844' },
];

const actionOptions = [
  { value: 'click', label: '点击' },
  { value: 'fill', label: '输入' },
  { value: 'press', label: '按键' },
  { value: 'waitForSelector', label: '等待元素' },
  { value: 'wait', label: '等待时间' },
];

const severityOptions = [
  { value: 'all', label: '全部' },
  { value: 'Blocker', label: '阻断' },
  { value: 'Major', label: '严重' },
  { value: 'Minor', label: '一般' },
  { value: 'Suggestion', label: '建议' },
];

const severityMeta = {
  Blocker: {
    label: '阻断',
    color: 'text-red-500',
    badge: 'blocker',
    description: '会直接阻止用户完成核心任务，通常对应必须优先修复的强失败项。',
  },
  Major: {
    label: '严重',
    color: 'text-amber-700',
    badge: 'major',
    description: '明显影响理解、操作或辅助技术使用，应进入当前验收周期修复。',
  },
  Minor: {
    label: '一般',
    color: 'text-blue-600',
    badge: 'minor',
    description: '影响体验质量或局部可用性，通常不阻断主流程，但仍建议修复。',
  },
  Suggestion: {
    label: '建议',
    color: 'text-violet-600',
    badge: 'suggestion',
    description: '偏体验优化、文案理解或增强建议，不等同于 WCAG 强制失败项。',
  },
};

export function App() {
  const isHistoryPage = window.location.pathname.endsWith('/history.html');

  return (
    <TooltipProvider delayDuration={120}>
      {isHistoryPage ? <HistoryPage /> : <AuditPage />}
      <BackToTopButton />
    </TooltipProvider>
  );
}

function BackToTopButton() {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 520);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={cn('back-to-top', visible && 'is-visible')}
          type="button"
          aria-label="回到顶部"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>回到顶部</TooltipContent>
    </Tooltip>
  );
}

function AuditPage() {
  const [form, setForm] = React.useState({
    url: '',
    name: '',
    notes: '',
    viewport: '1440x1000',
    maxTabs: '30',
    aiEnabled: true,
  });
  const [steps, setSteps] = React.useState([]);
  const [audit, setAudit] = React.useState(null);
  const [links, setLinks] = React.useState(null);
  const [severityFilter, setSeverityFilter] = React.useState('all');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [screenshotTarget, setScreenshotTarget] = React.useState(null);

  React.useEffect(() => {
    const saved = localStorage.getItem(LAST_AUDIT_KEY);
    if (!saved) {
      return;
    }
    try {
      const report = JSON.parse(saved);
      setAudit(report.audit || null);
      setLinks(report.links || null);
    } catch {
      localStorage.removeItem(LAST_AUDIT_KEY);
    }
  }, []);

  async function runAudit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          maxTabs: Number(form.maxTabs || 30),
          ai: { enabled: Boolean(form.aiEnabled) },
          steps: steps
            .filter((step) => step.selector || step.value)
            .map(normalizeStepPayload),
        }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '审计失败');
      }
      setAudit(data.report.audit);
      setLinks(data.report.links);
      localStorage.setItem(LAST_AUDIT_KEY, JSON.stringify(data.report));
    } catch (runError) {
      setError(runError.message || '审计失败');
    } finally {
      setLoading(false);
    }
  }

  function startNewAudit() {
    localStorage.removeItem(LAST_AUDIT_KEY);
    setAudit(null);
    setLinks(null);
    setSeverityFilter('all');
    setError('');
  }

  const filteredIssues = React.useMemo(() => {
    const issues = audit?.issues || [];
    return issues.filter((issue) => severityFilter === 'all' || issue.severity === severityFilter);
  }, [audit, severityFilter]);

  return (
    <main className="workspace">
      <section className="page-hero">
        <div>
          <h1>无障碍验收台</h1>
          <p>基于 WCAG 标准、页面证据链和多模态 AI 推理的无障碍体验审计助手</p>
        </div>
        <div className="hero-actions">
          <Button type="button" variant="secondary" onClick={startNewAudit}>
            <RotateCcw className="h-4 w-4" />
            新建审计
          </Button>
          <Button asChild variant="secondary">
            <a href="/history.html">
              <History className="h-4 w-4" />
              历史报告
            </a>
          </Button>
        </div>
      </section>

      <div className="audit-layout">
        <form className="setup-panel" onSubmit={runAudit}>
          <PanelHeader title="审计输入" />
          <div className="panel-body">
            <fieldset>
              <legend>目标页面</legend>
              <Field label="URL" htmlFor="target-url">
                <Input
                  id="target-url"
                  name="url"
                  type="url"
                  required
                  placeholder="例如：https://example.com/login"
                  value={form.url}
                  onChange={(event) => setForm({ ...form, url: event.target.value })}
                />
              </Field>
              <Field label="页面名称" htmlFor="target-name">
                <Input
                  id="target-name"
                  name="name"
                  placeholder="例如：系统登录页"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </Field>
              <Field label="环境 / 账号说明" htmlFor="target-notes">
                <Textarea
                  id="target-notes"
                  name="notes"
                  placeholder="测试环境、账号、权限或入口说明"
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                />
              </Field>
            </fieldset>

            <fieldset>
              <legend>运行参数</legend>
              <div className="control-grid">
                <Field
                  label="视口"
                  htmlFor="viewport"
                  tip="模拟不同设备尺寸，影响布局、触控目标、换行和移动端问题。"
                >
                  <Select value={form.viewport} onValueChange={(viewport) => setForm({ ...form, viewport })}>
                    <SelectTrigger id="viewport" data-testid="viewport-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {viewportOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label="键盘遍历次数"
                  htmlFor="max-tabs"
                  tip="连续按 Tab，记录焦点顺序、焦点可见性和疑似键盘陷阱。"
                >
                  <Input
                    id="max-tabs"
                    name="maxTabs"
                    type="number"
                    min="1"
                    max="200"
                    value={form.maxTabs}
                    onChange={(event) => setForm({ ...form, maxTabs: event.target.value })}
                  />
                </Field>
                <label className="ai-toggle">
                  <input
                    type="checkbox"
                    checked={form.aiEnabled}
                    onChange={(event) => setForm({ ...form, aiEnabled: event.target.checked })}
                  />
                  <span>启用 AI 语义复核</span>
                </label>
              </div>
            </fieldset>

            <fieldset>
              <legend>页面操作步骤</legend>
              <p className="field-hint">用于先进入要验收的状态，比如登录、打开新增弹窗、提交表单后检查 toast。简单页面可以不填。</p>
              <div className="step-list">
                {steps.map((step, index) => (
                  <div className="step-row" key={step.id}>
                    <Select
                      value={step.action}
                      onValueChange={(action) => updateStep(steps, setSteps, index, { action })}
                    >
                      <SelectTrigger aria-label={`第 ${index + 1} 步动作`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {actionOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      aria-label={`第 ${index + 1} 步选择器`}
                      placeholder="选择器"
                      value={step.selector}
                      onChange={(event) => updateStep(steps, setSteps, index, { selector: event.target.value })}
                    />
                    <Input
                      aria-label={`第 ${index + 1} 步值`}
                      placeholder="值"
                      value={step.value}
                      onChange={(event) => updateStep(steps, setSteps, index, { value: event.target.value })}
                    />
                    <Button type="button" variant="ghost" size="icon" aria-label={`删除第 ${index + 1} 步`} onClick={() => setSteps(steps.filter((_, stepIndex) => stepIndex !== index))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="step-actions">
                <Button type="button" variant="secondary" onClick={() => setSteps([...steps, { id: crypto.randomUUID(), action: 'click', selector: '', value: '' }])}>
                  <Plus className="h-4 w-4" />
                  添加步骤
                </Button>
                <Button type="button" variant="secondary" onClick={() => setSteps([])}>
                  清空
                </Button>
              </div>
            </fieldset>

            {error ? <p className="error-message">{error}</p> : null}

            <Button className="run-button" size="lg" disabled={loading}>
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5 fill-current" />}
              {loading ? '审计中' : '开始审计'}
            </Button>
          </div>
        </form>

        <section className="result-panel">
          <PanelHeader
            title="本次审计结果"
            action={audit && links ? <ExportMenu links={links} /> : null}
          />
          <div className="result-content">
            {audit ? (
              <ReportDetailContent
                audit={audit}
                links={links}
                severityFilter={severityFilter}
                onSeverityChange={setSeverityFilter}
                filteredIssues={filteredIssues}
                onOpenScreenshot={(target) => setScreenshotTarget(target || { label: '完整页面截图' })}
              />
            ) : (
              <EmptyState title="等待审计结果" description="点击输入面板中的按钮运行后，结果会显示在这里。" />
            )}
          </div>
        </section>
      </div>

      {screenshotTarget && links?.screenshot ? (
        <ScreenshotModal
          src={links.screenshot}
          target={screenshotTarget}
          onClose={() => setScreenshotTarget(null)}
        />
      ) : null}
    </main>
  );
}

function PanelHeader({ title, action }) {
  return (
    <div className="panel-heading">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

function ReportDetailContent({ audit, links, severityFilter, onSeverityChange, filteredIssues, onOpenScreenshot }) {
  const enhancementByIssue = React.useMemo(() => {
    return new Map((audit?.ai?.issueEnhancements || []).map((enhancement) => [enhancement.issueId, enhancement]));
  }, [audit]);
  const issueGroups = React.useMemo(() => groupIssuesForDisplay(filteredIssues, enhancementByIssue), [filteredIssues, enhancementByIssue]);

  return (
    <>
      <SummaryStrip audit={audit} links={links} onOpenScreenshot={onOpenScreenshot} />
      <SeverityPills audit={audit} value={severityFilter} onChange={onSeverityChange} />
      <div className="issue-list">
        {issueGroups.length ? (
          issueGroups.map((group) => (
            <IssueGroupCard group={group} key={group.id} onOpenScreenshot={onOpenScreenshot} />
          ))
        ) : (
          <EmptyState title="没有匹配的问题" description="调整筛选条件后可以查看其他分类。" />
        )}
      </div>
    </>
  );
}

function Field({ label, htmlFor, tip, children }) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span className="field-label">
        {label}
        {tip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="info-trigger" aria-label={`${label}说明`}>
                <Info className="h-4 w-4" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{tip}</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      {children}
    </label>
  );
}

function ExportMenu({ links }) {
  const items = [
    { label: 'Markdown', href: links.report },
    { label: 'JSON', href: links.audit },
    { label: 'AX Tree', href: links.accessibilityTree },
  ];

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button className="export-trigger" variant="secondary" data-testid="export-trigger">
          导出为
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="export-options" data-testid="export-options">
        {items.map((item) => (
          <DropdownMenuItem asChild key={item.label}>
            <a href={item.href} target="_blank" rel="noreferrer">
              {item.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SummaryStrip({ audit, links, onOpenScreenshot }) {
  const summary = audit.summary || {};
  const ai = audit.ai || {};
  const fallbackSummary = buildUiFallbackSummary(audit.issues || []);
  const aiSummary = ai.summary || {};
  const riskLevel = aiSummary.riskLevel || inferRiskLevel(summary);
  const highPriorityCount = (summary.bySeverity?.Blocker || 0) + (summary.bySeverity?.Major || 0);
  const verdict = cleanAiVerdict(aiSummary.verdict || '') || fallbackSummary.verdict || summarySentence(summary, aiSummary);
  const aiFindings = filterAiListItems(aiSummary.keyFindings || []);
  const visibleFindings = (aiFindings.length ? aiFindings : fallbackSummary.keyFindings).slice(0, 2);
  const insightLabel = ai.status === 'failed' ? '降级洞察' : ai.status === 'enabled' ? 'AI 洞察' : '规则洞察';

  return (
    <div className="summary-strip">
      <button className="screenshot-preview" type="button" aria-label="查看完整页面截图" onClick={() => onOpenScreenshot({ label: '完整页面截图' })}>
        {links?.screenshot ? <img src={links.screenshot} alt="页面首屏截图" /> : <div className="screenshot-fallback">暂无截图</div>}
        <span className="screenshot-label">页面截图</span>
        <span className="screenshot-action">点击查看完整截图</span>
      </button>
      <div className="summary-brief">
        <div className="summary-brief-top">
          <div className="summary-total">
            <strong>{summary.total || 0}</strong>
            <span>个问题</span>
          </div>
          <Badge variant={riskBadge(riskLevel)}>{riskLabel(riskLevel)}</Badge>
        </div>
        <div className="summary-metrics" aria-label="问题分布">
          <div>
            <span>高优先级</span>
            <strong>{highPriorityCount}</strong>
          </div>
          <div>
            <span>阻断</span>
            <strong>{summary.bySeverity?.Blocker || 0}</strong>
          </div>
          <div>
            <span>严重</span>
            <strong>{summary.bySeverity?.Major || 0}</strong>
          </div>
        </div>
        <div className="summary-insight">
          <div className="summary-insight-heading">
            <span>{insightLabel}</span>
            {ai.model ? <em>{ai.model}</em> : null}
          </div>
          <p>{verdict}</p>
          {visibleFindings.length ? (
            <ul>
              {visibleFindings.map((item, index) => (
                <li key={`summary-finding-${index}`}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SeverityPills({ audit, value, onChange }) {
  const summary = audit.summary || {};
  const items = [
    { value: 'all', label: '全部', count: summary.total || 0 },
    ...severityOptions
      .filter((option) => option.value !== 'all')
      .map((option) => ({ ...option, count: summary.bySeverity?.[option.value] || 0 })),
  ];

  return (
    <div className="severity-pills" aria-label="按严重级别筛选">
      {items.map((item) => (
        <button
          className={cn('severity-pill', value === item.value && 'is-active')}
          type="button"
          key={item.value}
          onClick={() => onChange(item.value)}
        >
          <span>{item.label}</span>
          <strong>{item.count}</strong>
        </button>
      ))}
    </div>
  );
}

function AiPanel({ ai, issues = [] }) {
  if (!ai) {
    return null;
  }

  if (ai.status === 'disabled') {
    return (
      <Card className="ai-card">
        <div className="ai-card-header">
          <h3>AI 语义复核未启用</h3>
          <Badge>Gemini</Badge>
        </div>
        <p>{ai.reason || '未配置 API Key 或本次关闭。'}</p>
      </Card>
    );
  }

  if (ai.status === 'failed') {
    const summary = ai.summary || {};
    const fallbackSummary = buildUiFallbackSummary(issues);
    const verdict = cleanAiVerdict(summary.verdict || '') || fallbackSummary.verdict;
    const keyFindings = filterAiListItems(summary.keyFindings || []);
    const nextSteps = filterAiListItems(summary.recommendedNextSteps || []);
    const attemptedModels = formatAttemptedModels(ai);
    const errorText = formatAiError(ai.error);

    return (
      <Card className="ai-card">
        <div className="ai-card-header">
          <div>
            <h3>AI 复核降级为规则洞察</h3>
            <p>{attemptedModels || ai.model || 'gemini'}</p>
          </div>
          <Badge variant="major">降级</Badge>
        </div>
        <p className="ai-verdict">{verdict || 'AI 服务暂时不可用，已使用规则检测结果生成本次报告。'}</p>
        <AiList title="规则洞察" items={keyFindings.length ? keyFindings : fallbackSummary.keyFindings} />
        <AiList title="修复策略" items={nextSteps.length ? nextSteps : fallbackSummary.recommendedNextSteps} />
        {errorText ? <p className="ai-muted">失败原因：{errorText}</p> : null}
      </Card>
    );
  }

  const summary = ai.summary || {};
  const fallbackSummary = buildUiFallbackSummary(issues);
  const verdict = cleanAiVerdict(summary.verdict || '') || fallbackSummary.verdict;
  const keyFindings = filterAiListItems(summary.keyFindings || []);
  const nextSteps = filterAiListItems(summary.recommendedNextSteps || []);
  const visibleKeyFindings = keyFindings.length ? keyFindings : fallbackSummary.keyFindings;
  const visibleNextSteps = nextSteps.length ? nextSteps : fallbackSummary.recommendedNextSteps;

  if (!verdict && !visibleKeyFindings.length && !visibleNextSteps.length && !meaningfulSemanticFindings(ai.semanticFindings || []).length) {
    return null;
  }

  return (
    <Card className="ai-card">
      <div className="ai-card-header">
        <div>
          <h3>AI 审计洞察</h3>
        </div>
        <Badge variant={riskBadge(summary.riskLevel)}>{summary.riskLevel || 'unknown'}</Badge>
      </div>
      {verdict ? <p className="ai-verdict">{verdict}</p> : null}
      <AiList title="核心洞察" items={visibleKeyFindings} />
      <AiList title="修复策略" items={visibleNextSteps} />
      <SemanticFindings findings={ai.semanticFindings || []} />
    </Card>
  );
}

function AiList({ title, items }) {
  if (!items.length) {
    return null;
  }

  return (
    <div className="ai-list">
      <strong>{title}</strong>
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function buildUiFallbackSummary(issues = []) {
  const groups = groupIssuesForInsight(issues);
  const blockerGroup = groups.find((group) => group.severity === 'Blocker');
  const repeatedGroup = groups.find((group) => group.count >= 3);
  const topGroup = groups[0];

  if (!groups.length) {
    return {
      verdict: '',
      keyFindings: [],
      recommendedNextSteps: [],
    };
  }

  const verdict = blockerGroup
    ? `首要风险集中在「${blockerGroup.title}」：这类问题会直接影响读屏或键盘用户理解和完成操作，应该作为发布前阻断项处理。`
    : repeatedGroup
      ? `问题呈现系统性重复，「${repeatedGroup.title}」集中出现 ${repeatedGroup.count} 处，优先从${repairLayerForInsight(repeatedGroup)}统一修复。`
      : `主要风险集中在「${topGroup.title}」，更像是组件语义、状态设计或内容命名规则缺口，而不是单个页面的偶发问题。`;

  return {
    verdict,
    keyFindings: groups.slice(0, 4).map((group) => (
      `${group.title}${group.count > 1 ? `集中出现 ${group.count} 处` : '出现'}：${diagnosisForInsight(group)}`
    )),
    recommendedNextSteps: buildInsightNextSteps(groups, blockerGroup, repeatedGroup),
  };
}

function groupIssuesForInsight(issues = []) {
  const grouped = new Map();
  for (const issue of issues) {
    const key = [issue.title, issue.ruleSource, issue.tier].map((value) => String(value || '').trim().toLowerCase()).join('|');
    const current = grouped.get(key) || {
      title: issue.title || '未命名问题',
      severity: issue.severity || 'Suggestion',
      ruleSource: issue.ruleSource || '',
      tier: issue.tier || '',
      recommendation: issue.recommendation || '',
      count: 0,
    };
    current.count += 1;
    current.severity = higherInsightSeverity(current.severity, issue.severity);
    grouped.set(key, current);
  }
  return Array.from(grouped.values()).sort((left, right) => (
    insightSeverityRank(right.severity) - insightSeverityRank(left.severity)
    || right.count - left.count
  ));
}

function buildInsightNextSteps(groups, blockerGroup, repeatedGroup) {
  const steps = [];
  if (blockerGroup) {
    steps.push(`先把「${blockerGroup.title}」修到代表元素可被读屏或键盘完成同等操作，再处理一般体验问题。`);
  }
  if (repeatedGroup) {
    steps.push(`把「${repeatedGroup.title}」回溯到${repairLayerForInsight(repeatedGroup)}，一次修掉同类实例，并补进组件验收规则。`);
  }
  for (const group of groups) {
    if (steps.length >= 4) {
      break;
    }
    const step = nextStepForInsight(group);
    if (step && !steps.includes(step)) {
      steps.push(step);
    }
  }
  return steps;
}

function diagnosisForInsight(group) {
  const text = insightGroupText(group);
  if (/contrast|对比度/i.test(text)) {
    return '更可能是颜色 token、组件默认态或禁用态没有按 WCAG 对比度门槛校准。';
  }
  if (/button-name|link-name|label|可访问名称|按钮缺少|链接/i.test(text)) {
    return '视觉上能看懂的图标或控件，没有同步提供给辅助技术使用的名称。';
  }
  if (/listitem|list|列表|aria-|role|语义|landmark|region/i.test(text)) {
    return '视觉结构和 DOM/ARIA 结构脱节，应优先修组件模板，而不是只改样式。';
  }
  if (/focus|焦点/i.test(text)) {
    return '常见根因是键盘态样式缺失、outline 被重置或组件没有定义 focus-visible。';
  }
  if (/target size|触控|可点击目标|尺寸/i.test(text)) {
    return '点击热区不足会放大移动端、低视力和运动障碍场景下的误触与无法命中。';
  }
  return '需要结合规则证据判断它属于组件层缺陷、页面结构缺陷还是内容规范缺口。';
}

function nextStepForInsight(group) {
  const text = insightGroupText(group);
  if (/contrast|对比度/i.test(text)) {
    return 'UED 先校准颜色变量和组件状态色，研发再替换页面硬编码色值。';
  }
  if (/button-name|link-name|label|可访问名称|按钮缺少|链接/i.test(text)) {
    return '把图标按钮、泛化链接和表单控件的可访问名称做成组件必填项。';
  }
  if (/listitem|list|列表|aria-|role|语义|landmark|region/i.test(text)) {
    return '从组件模板修正 DOM 结构和 ARIA 角色，确保视觉结构与辅助技术结构一致。';
  }
  if (/focus|焦点/i.test(text)) {
    return '补齐全局 focus-visible 样式，并用 Tab 路径验收焦点始终可见。';
  }
  if (/target size|触控|可点击目标|尺寸/i.test(text)) {
    return '优先扩大可点击热区而不只放大图标，用最小触控目标和相邻间距做验收。';
  }
  return group.recommendation || '';
}

function repairLayerForInsight(group) {
  const text = insightGroupText(group);
  if (/contrast|对比度/i.test(text)) {
    return '设计变量和组件状态色';
  }
  if (/button-name|link-name|label|可访问名称|按钮缺少|链接/i.test(text)) {
    return '组件 API 和内容命名规范';
  }
  if (/listitem|list|列表|aria-|role|语义|landmark|region/i.test(text)) {
    return '组件语义模板';
  }
  if (/focus|焦点|target size|触控|可点击目标|尺寸/i.test(text)) {
    return '组件交互状态规范';
  }
  return '组件库或页面模板';
}

function insightGroupText(group) {
  return `${group.title || ''} ${group.ruleSource || ''} ${group.recommendation || ''}`;
}

function higherInsightSeverity(left, right) {
  return insightSeverityRank(right) > insightSeverityRank(left) ? right : left;
}

function insightSeverityRank(severity) {
  return {
    Suggestion: 1,
    Minor: 2,
    Major: 3,
    Blocker: 4,
  }[severity] || 0;
}

function formatAttemptedModels(ai = {}) {
  const models = Array.isArray(ai.attemptedModels) && ai.attemptedModels.length
    ? ai.attemptedModels
    : [ai.model].filter(Boolean);
  return models.length ? `已尝试：${models.join(' -> ')}` : '';
}

function formatAiError(error) {
  const text = String(error || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  return text.length > 220 ? `${text.slice(0, 219)}...` : text;
}

function SemanticFindings({ findings }) {
  const visibleFindings = meaningfulSemanticFindings(findings);
  if (!visibleFindings.length) {
    return null;
  }

  return (
    <div className="ai-findings">
      <strong>AI 语义复核</strong>
      {visibleFindings.map((finding) => {
        const meta = severityMeta[finding.severity] || severityMeta.Suggestion;
        return (
          <article key={finding.id}>
            <h4>{finding.title}</h4>
            <p>{finding.reason}</p>
            <p><strong>建议：</strong>{finding.recommendation}</p>
            <div className="issue-badges">
              <Badge variant={meta.badge}>{meta.label}</Badge>
              <Badge>{finding.category}</Badge>
              <Badge>{finding.confidence}</Badge>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function IssueGroupCard({ group, onOpenScreenshot }) {
  const issue = group.primaryIssue;
  const enhancement = group.primaryEnhancement;
  const meta = severityMeta[issue.severity] || severityMeta.Minor;
  const isGrouped = group.issues.length > 1;

  return (
    <article className={cn('issue-card', isGrouped && 'is-stacked')}>
      <div className="issue-card-title-row">
        <h3>{issue.title}</h3>
        {isGrouped ? <span className="issue-group-count">{group.issues.length} 个元素受影响</span> : null}
      </div>
      <div className="issue-badges">
        <Badge variant={meta.badge}>{meta.label}</Badge>
        <Badge>{tierLabel(issue.tier)}</Badge>
        <Badge>{issue.owner}</Badge>
        {isGrouped ? <Badge>{group.issues.length} 个实例</Badge> : <Badge>{issue.id}</Badge>}
      </div>
      <section className="issue-fields">
        {isGrouped ? null : <IssueEvidence issue={issue} onOpenScreenshot={onOpenScreenshot} />}
        {enhancement ? <IssueEnhancement enhancement={enhancement} issue={issue} /> : null}
      </section>
      {isGrouped ? (
        <AffectedElements issues={group.issues} onOpenScreenshot={onOpenScreenshot} />
      ) : (
        <IssueEvidenceDetails evidence={issue.evidence} />
      )}
    </article>
  );
}

function AffectedElements({ issues, onOpenScreenshot }) {
  return (
    <section className="affected-elements" aria-label={`受影响元素，共 ${issues.length} 个`}>
      <div className="affected-elements-header">
        <strong>受影响元素</strong>
        <span>{issues.length} 个</span>
      </div>
      <ol>
        {issues.map((issue, index) => (
          <li key={issue.id}>
            <div className={cn('affected-element-summary', evidenceRect(issue.evidence) && 'has-screenshot')}>
              <span className="affected-element-index">{index + 1}</span>
              <p>{evidenceSummary(issue.evidence)}</p>
              <IssueScreenshotButton issue={issue} onOpenScreenshot={onOpenScreenshot} />
              <Badge>{issue.id}</Badge>
            </div>
            <IssueEvidenceDetails evidence={issue.evidence} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function IssueEvidence({ issue, onOpenScreenshot }) {
  const evidence = issue?.evidence;
  if (!evidence || !Object.keys(evidence).length) {
    return null;
  }

  return (
    <p className="issue-field-row">
      <strong>问题元素：</strong>
      <span>{evidenceSummary(evidence)}</span>
      <IssueScreenshotButton issue={issue} onOpenScreenshot={onOpenScreenshot} />
    </p>
  );
}

function IssueScreenshotButton({ issue, onOpenScreenshot }) {
  if (!issue || !onOpenScreenshot) {
    return null;
  }

  const rect = evidenceRect(issue.evidence);
  if (!rect) {
    return null;
  }
  const tooltip = '看图定位问题元素';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className="issue-screenshot-button"
          type="button"
          aria-label={`${issue.id} ${tooltip}`}
          onClick={() => onOpenScreenshot({
            label: `${issue.id} ${issue.title}`,
            issueId: issue.id,
            title: issue.title,
            evidence: issue.evidence,
          })}
        >
          <ImageIcon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function IssueEnhancement({ enhancement, issue }) {
  return (
    <>
      {enhancement.userImpact ? <p className="issue-field-row"><strong>用户影响：</strong>{enhancement.userImpact}</p> : null}
      <p className="issue-field-row"><strong>判断依据：</strong><RuleSourceLink issue={issue} /></p>
      {enhancement.developerFix ? <p className="issue-field-row"><strong>优化建议：</strong>{enhancement.developerFix}</p> : null}
      {enhancement.codeExample ? <CopyableCodeBlock code={enhancement.codeExample} /> : null}
    </>
  );
}

function IssueEvidenceDetails({ evidence }) {
  if (!evidence || !Object.keys(evidence).length) {
    return null;
  }

  return (
    <Collapsible className="issue-evidence-details">
      <CollapsibleTrigger className="evidence-trigger">问题定位信息</CollapsibleTrigger>
      <CollapsibleContent>
        <CopyableCodeBlock code={JSON.stringify(evidence, null, 2)} />
      </CollapsibleContent>
    </Collapsible>
  );
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
    if (Number(evidence.rect.x) < 0 || Number(evidence.rect.y) < 0) {
      parts.push('可能位于视口外');
    }
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
  if (Array.isArray(evidence.target)) {
    return evidence.target.join(', ');
  }
  return String(evidence.selector || evidence.target || '').trim();
}

function evidenceRect(evidence) {
  const rect = evidence?.rect || evidence?.current?.rect || evidence?.previous?.rect;
  if (!rect) {
    return null;
  }

  const width = Number(rect.width);
  const height = Number(rect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const x = Number(rect.pageX ?? rect.x);
  const y = Number(rect.pageY ?? rect.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y, width, height };
}

function groupIssuesForDisplay(issues, enhancementByIssue) {
  const groups = new Map();

  for (const issue of issues) {
    const enhancement = enhancementByIssue.get(issue.id);
    const key = issueGroupKey(issue);
    const current = groups.get(key) || {
      id: key,
      primaryIssue: issue,
      primaryEnhancement: enhancement,
      issues: [],
    };

    current.issues.push(issue);
    if (!current.primaryEnhancement && enhancement) {
      current.primaryEnhancement = enhancement;
      current.primaryIssue = issue;
    }
    groups.set(key, current);
  }

  return Array.from(groups.values());
}

function issueGroupKey(issue) {
  const rule = displayRuleForIssue(issue);
  return [
    issue.title,
    issue.severity,
    tierLabel(issue.tier),
    issue.owner,
    rule.source || issue.ruleSource || issue.ruleUrl,
  ].map(normalizeGroupText).join('|');
}

function normalizeGroupText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function RuleSourceLink({ issue }) {
  const rule = displayRuleForIssue(issue);
  const ruleSource = rule.source;
  const ruleUrl = rule.url;

  if (!ruleSource || !ruleUrl) {
    return ruleSource || '未返回规则来源';
  }

  return <RuleLink href={ruleUrl}>{ruleSource}</RuleLink>;
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

function RuleLink({ href, children }) {
  return (
    <a className="root-cause-rule-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

function CopyableCodeBlock({ code }) {
  const [copied, setCopied] = React.useState(false);
  const isSingleLine = !String(code).includes('\n');

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className={cn('code-block-wrap', isSingleLine && 'is-single-line')}>
      <pre className="evidence-block code-block">{code}</pre>
      <button className="copy-code-button" type="button" onClick={handleCopy}>
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  );
}

function EmptyState({ title, description, loading = false, className }) {
  return (
    <div className={cn('empty-state', loading && 'is-loading', className)}>
      <div className="empty-mark" aria-hidden="true" />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function HistoryPage() {
  const [reports, setReports] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedReport, setSelectedReport] = React.useState(null);
  const [selectedAudit, setSelectedAudit] = React.useState(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailError, setDetailError] = React.useState('');
  const [severityFilter, setSeverityFilter] = React.useState('all');
  const [screenshotTarget, setScreenshotTarget] = React.useState(null);
  const historyShellRef = React.useRef(null);
  const historyDetailRef = React.useRef(null);

  React.useEffect(() => {
    fetch('/api/reports')
      .then((response) => readJsonResponse(response))
      .then((data) => setReports(data.reports || []))
      .finally(() => setLoading(false));
  }, []);

  const filteredIssues = React.useMemo(() => {
    const issues = selectedAudit?.issues || [];
    return issues.filter((issue) => severityFilter === 'all' || issue.severity === severityFilter);
  }, [selectedAudit, severityFilter]);

  React.useEffect(() => {
    if (!selectedReport || !historyShellRef.current || !historyDetailRef.current) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      const shell = historyShellRef.current;
      const detail = historyDetailRef.current;
      const centeredLeft = detail.offsetLeft - (shell.clientWidth - detail.offsetWidth) / 2;
      shell.scrollTo({ left: Math.max(0, centeredLeft), behavior: 'smooth' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedReport?.id]);

  async function openReport(report) {
    setSelectedReport(report);
    setSelectedAudit(null);
    setDetailError('');
    setSeverityFilter('all');
    setDetailLoading(true);

    try {
      const response = await fetch(report.links?.audit);
      const audit = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(audit.error || '历史报告读取失败');
      }
      setSelectedAudit(audit);
    } catch (error) {
      setDetailError(error.message || '历史报告读取失败');
    } finally {
      setDetailLoading(false);
    }
  }

  function handleReportKeyDown(event, report) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openReport(report);
    }
  }

  return (
    <main className={cn('workspace history-workspace', selectedReport && 'is-reading')}>
      <section className="page-hero history-hero backdrop-blur-xl">
        <Button asChild variant="ghost" size="icon" className="history-back-button">
          <a href="/" aria-label="返回审计台">
            <ArrowLeft className="h-5 w-5" />
          </a>
        </Button>
        <h1>历史报告</h1>
      </section>
      <section
        className={cn('history-shell', selectedReport && 'has-detail')}
        ref={historyShellRef}
      >
        <section className={cn('history-panel', loading && 'is-loading')}>
          {loading ? <EmptyState title="正在加载" description="正在读取本地报告记录。" loading className="history-loading-state" /> : null}
          {!loading && !reports.length ? <EmptyState title="暂无历史报告" description="完成一次审计后，报告会出现在这里。" /> : null}
          {reports.length ? (
            <div className="history-list">
              {reports.map((report) => (
                <Card
                  className={cn('history-card', selectedReport?.id === report.id && 'is-selected')}
                  key={report.id}
                  role="button"
                  tabIndex={0}
                  aria-current={selectedReport?.id === report.id ? 'true' : undefined}
                  onClick={() => openReport(report)}
                  onKeyDown={(event) => handleReportKeyDown(event, report)}
                >
                  <div className="history-card-content">
                    <div className="history-card-meta">
                      <time>{formatDate(report.generatedAt)}</time>
                      <span>{formatReportSource(report.url)}</span>
                    </div>
                    <h2>{report.target}</h2>
                    <p className="history-card-url">{report.url}</p>
                  </div>
                  <div className="history-stats">
                    <span>全部问题</span>
                    <strong>{report.summary?.total || 0}</strong>
                  </div>
                </Card>
              ))}
            </div>
          ) : null}
        </section>

        {selectedReport ? (
          <section className="result-panel history-detail-panel" ref={historyDetailRef}>
            <PanelHeader
              title={selectedReport.target}
              action={selectedAudit ? <ExportMenu links={selectedReport.links} /> : null}
            />
            <div className="result-content">
              {detailLoading ? <EmptyState title="正在加载报告" description="正在读取这次审计的完整结果。" /> : null}
              {!detailLoading && detailError ? <EmptyState title="报告读取失败" description={detailError} /> : null}
              {!detailLoading && !detailError && selectedAudit ? (
                <ReportDetailContent
                  audit={selectedAudit}
                  links={selectedReport.links}
                  severityFilter={severityFilter}
                  onSeverityChange={setSeverityFilter}
                  filteredIssues={filteredIssues}
                  onOpenScreenshot={(target) => setScreenshotTarget(target || { label: '完整页面截图' })}
                />
              ) : null}
            </div>
          </section>
        ) : null}
      </section>

      {screenshotTarget && selectedReport?.links?.screenshot ? (
        <ScreenshotModal
          src={selectedReport.links.screenshot}
          target={screenshotTarget}
          onClose={() => setScreenshotTarget(null)}
        />
      ) : null}
    </main>
  );
}

function ScreenshotModal({ src, target, onClose }) {
  const [imageSize, setImageSize] = React.useState(null);
  const rect = evidenceRect(target?.evidence);
  const highlightStyle = rect && imageSize
    ? {
      left: `${(rect.x / imageSize.width) * 100}%`,
      top: `${(rect.y / imageSize.height) * 100}%`,
      width: `${(rect.width / imageSize.width) * 100}%`,
      height: `${(rect.height / imageSize.height) * 100}%`,
    }
    : null;
  const title = target?.label || '完整页面截图';

  return (
    <div className="screenshot-modal" role="dialog" aria-modal="true" aria-label={title}>
      <button className="modal-backdrop" type="button" aria-label="关闭完整页面截图" onClick={onClose} />
      <div className="modal-content">
        <Button className="modal-close" variant="secondary" size="icon" type="button" aria-label="关闭完整页面截图" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
        <div className="screenshot-stage">
          <img
            src={src}
            alt={title}
            onLoad={(event) => setImageSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })}
          />
          {highlightStyle ? (
            <div className="screenshot-highlight" style={highlightStyle} aria-hidden="true">
              {target?.issueId ? <span>{target.issueId}</span> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function updateStep(steps, setSteps, index, patch) {
  setSteps(steps.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step)));
}

function normalizeStepPayload(step) {
  if (step.action === 'wait') {
    return { action: step.action, ms: Number(step.value || 1000) };
  }
  if (step.action === 'press') {
    return { action: step.action, key: step.value || 'Enter' };
  }
  if (step.action === 'fill') {
    return { action: step.action, selector: step.selector || undefined, value: step.value || '' };
  }
  return {
    action: step.action,
    selector: step.selector || undefined,
  };
}

function riskBadge(riskLevel) {
  if (riskLevel === 'high') {
    return 'major';
  }
  if (riskLevel === 'medium') {
    return 'minor';
  }
  return 'suggestion';
}

function riskLabel(riskLevel) {
  const labels = {
    high: '风险较高',
    medium: '风险中等',
    low: '风险较低',
  };
  return labels[riskLevel] || '待复核';
}

function tierLabel(tier) {
  if (tier === '自动规则' || tier === '自动检测' || tier === 'AI辅助判断') {
    return '自动规则+AI 辅助判断';
  }
  return tier || '自动规则+AI 辅助判断';
}

function inferRiskLevel(summary = {}) {
  if ((summary.bySeverity?.Blocker || 0) > 0 || (summary.bySeverity?.Major || 0) > 0) {
    return 'high';
  }
  if ((summary.bySeverity?.Minor || 0) > 0) {
    return 'medium';
  }
  return 'low';
}

function summarySentence(summary = {}, aiSummary = {}) {
  const blocker = summary.bySeverity?.Blocker || 0;
  const major = summary.bySeverity?.Major || 0;
  const minor = summary.bySeverity?.Minor || 0;
  const suggestion = summary.bySeverity?.Suggestion || 0;

  if (aiSummary.verdict) {
    const cleaned = cleanAiVerdict(aiSummary.verdict);
    if (cleaned) {
      return cleaned;
    }
  }

  if (blocker || major) {
    return `本次存在 ${blocker + major} 个高优先级问题，建议先处理阻断和严重项，再复核一般问题。`;
  }
  if (minor || suggestion) {
    return `暂未发现阻断和严重问题，主要集中在一般问题与语义复核建议。`;
  }
  return '未发现自动化规则问题，仍建议进行关键流程和读屏体验人工复核。';
}

function cleanAiVerdict(text = '') {
  const cleaned = String(text)
    .replace(/^本次审计发现\s*\d+\s*个问题，?其中阻断\s*\d+\s*个、?严重\s*\d+\s*个。?\s*/u, '')
    .replace(/^本次审计发现\s*\d+\s*个问题。?\s*/u, '')
    .trim();
  return isLowValueAiSummaryItem(cleaned) ? '' : cleaned;
}

function filterAiListItems(items) {
  return items.filter((item) => {
    const text = String(item || '').trim();
    if (!text) {
      return false;
    }
    return !isLowValueAiSummaryItem(text);
  });
}

function isLowValueAiSummaryItem(text = '') {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) {
    return true;
  }

  return [
    /^(建议)?优先(修复|处理|复核)\s*(Blocker|Major|阻断|严重)/i,
    /按(规则来源|selector|选择器).*(分派|分配)/i,
    /重新运行同一\s*URL/i,
    /修复后重新运行/i,
    /建议先处理阻断和严重问题/i,
    /(自动规则|自动检测|AI辅助判断|自动规则\+AI 辅助判断|阻断|严重|一般|建议)[：:\s]*\d+\s*个/u,
  ].some((pattern) => pattern.test(value));
}

function meaningfulSemanticFindings(findings) {
  return findings.filter((finding) => {
    const title = String(finding.title || '').trim();
    const reason = String(finding.reason || '').trim();
    const recommendation = String(finding.recommendation || '').trim();
    return reason || recommendation || (title && title !== 'AI 语义复核项');
  });
}

async function readJsonResponse(response) {
  const raw = await response.text();
  if (!raw.trim()) {
    throw new Error('后端服务未返回数据，请确认 3000 端口的审计服务已启动。');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('后端服务返回了非 JSON 内容，请检查本地审计服务状态。');
  }
}

function formatDate(value) {
  if (!value) {
    return '';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatReportSource(value = '') {
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') {
      return '本地文件';
    }
    return url.hostname.replace(/^www\./, '');
  } catch {
    return value ? '自定义页面' : '未知来源';
  }
}
