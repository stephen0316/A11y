import * as React from 'react';
import { createPortal } from 'react-dom';
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
  Sparkles,
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
import { MoveRightIcon } from './components/ui/move-right-icon.jsx';
import { cn } from './lib/utils.js';

const LAST_AUDIT_KEY = 'a11y:lastAuditReport';
const AUDIT_DRAFT_KEY = 'a11y:auditDraft';
const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
const DEFAULT_AUDIT_FORM = {
  url: '',
  name: '',
  advancedTaskEnabled: false,
  task: '',
  viewport: '1440x1000',
  maxTabs: '30',
};

function apiUrl(value) {
  if (!value || /^https?:\/\//i.test(value)) {
    return value;
  }
  const pathname = value.startsWith('/') ? value : `/${value}`;
  return API_BASE_URL ? `${API_BASE_URL}${pathname}` : pathname;
}

function resolveReportLinks(links) {
  if (!links || typeof links !== 'object') {
    return links || null;
  }
  const resolved = { ...links };
  for (const key of ['report', 'audit', 'screenshot', 'domSnapshot', 'accessibilityTree']) {
    if (resolved[key]) {
      resolved[key] = apiUrl(resolved[key]);
    }
  }
  if (resolved.flowScreenshots && typeof resolved.flowScreenshots === 'object') {
    resolved.flowScreenshots = Object.fromEntries(
      Object.entries(resolved.flowScreenshots).map(([key, value]) => [key, apiUrl(value)]),
    );
  }
  return resolved;
}

function resolveReport(report) {
  return report ? { ...report, links: resolveReportLinks(report.links) } : report;
}

const viewportOptions = [
  { value: '1440x1000', label: '桌面 1440×1000' },
  { value: '1280x800', label: '笔记本 1280×800' },
  { value: '390x844', label: '移动 390×844' },
];

const actionOptions = [
  { value: 'click', label: '点击' },
  { value: 'hover', label: '悬停' },
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

function NewAuditIcon({ className }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M24.0605 10L24.0239 38" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 24L38 24" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function readAuditDraft() {
  const fallback = { form: { ...DEFAULT_AUDIT_FORM }, steps: [] };
  try {
    const saved = localStorage.getItem(AUDIT_DRAFT_KEY);
    if (!saved) {
      return fallback;
    }
    const draft = JSON.parse(saved);
    const savedForm = draft?.form && typeof draft.form === 'object' ? draft.form : {};
    const { aiEnabled: _legacyAiEnabled, ...formDraft } = savedForm;
    return {
      form: {
        ...DEFAULT_AUDIT_FORM,
        ...formDraft,
        advancedTaskEnabled: Boolean(draft?.form?.advancedTaskEnabled),
      },
      steps: Array.isArray(draft?.steps) ? draft.steps.map(normalizeDraftStep).filter(Boolean) : [],
    };
  } catch {
    localStorage.removeItem(AUDIT_DRAFT_KEY);
    return fallback;
  }
}

function normalizeDraftStep(step) {
  if (!step || typeof step !== 'object') {
    return null;
  }
  const actionValues = new Set(actionOptions.map((option) => option.value));
  return {
    id: step.id || crypto.randomUUID(),
    action: actionValues.has(step.action) ? step.action : 'click',
    selector: String(step.selector || ''),
    selectors: Array.isArray(step.selectors) ? step.selectors.map(String).filter(Boolean) : [],
    value: String(step.value || ''),
    key: String(step.key || ''),
    role: String(step.role || ''),
    name: String(step.name || ''),
    label: String(step.label || ''),
    text: String(step.text || ''),
    description: String(step.description || ''),
    ms: step.ms === undefined ? '' : String(step.ms),
    timeout: step.timeout === undefined ? '' : String(step.timeout),
  };
}

function AuditPage() {
  const draft = React.useMemo(() => readAuditDraft(), []);
  const [form, setForm] = React.useState(draft.form);
  const [steps, setSteps] = React.useState(draft.steps);
  const [audit, setAudit] = React.useState(null);
  const [links, setLinks] = React.useState(null);
  const [severityFilter, setSeverityFilter] = React.useState('all');
  const [taskStateFilter, setTaskStateFilter] = React.useState('all');
  const [loading, setLoading] = React.useState(false);
  const [generatingSteps, setGeneratingSteps] = React.useState(false);
  const [error, setError] = React.useState('');
  const [stepPlan, setStepPlan] = React.useState(null);
  const [screenshotTarget, setScreenshotTarget] = React.useState(null);

  React.useEffect(() => {
    const saved = localStorage.getItem(LAST_AUDIT_KEY);
    if (!saved) {
      return;
    }
    try {
      const report = JSON.parse(saved);
      setAudit(report.audit || null);
      setLinks(resolveReportLinks(report.links));
      setStepPlan(report.audit?.meta?.target?.stepPlan || null);
    } catch {
      localStorage.removeItem(LAST_AUDIT_KEY);
    }
  }, []);

  React.useEffect(() => {
    localStorage.setItem(AUDIT_DRAFT_KEY, JSON.stringify({ form, steps }));
  }, [form, steps]);

  async function runAudit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    setAudit(null);
    setLinks(null);
    setSeverityFilter('all');
    setTaskStateFilter('all');
    setScreenshotTarget(null);

    try {
      const response = await fetch(apiUrl('/api/audit'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: form.url,
          name: form.name,
          viewport: form.viewport,
          maxTabs: Number(form.maxTabs || 30),
          ai: { enabled: true },
          task: form.advancedTaskEnabled ? form.task : '',
          steps: form.advancedTaskEnabled
            ? steps
              .filter((step) => step.selector || step.value || step.key || step.name || step.text)
              .map(normalizeStepPayload)
            : [],
        }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '走查失败');
      }
      const report = resolveReport(data.report);
      setAudit(report.audit);
      setLinks(report.links);
      setStepPlan(report.audit?.meta?.target?.stepPlan || null);
      localStorage.setItem(LAST_AUDIT_KEY, JSON.stringify(report));
    } catch (runError) {
      setError(runError.message || '走查失败');
    } finally {
      setLoading(false);
    }
  }

  function startNewAudit() {
    localStorage.removeItem(LAST_AUDIT_KEY);
    localStorage.removeItem(AUDIT_DRAFT_KEY);
    setForm(DEFAULT_AUDIT_FORM);
    setSteps([]);
    setStepPlan(null);
    setAudit(null);
    setLinks(null);
    setSeverityFilter('all');
    setTaskStateFilter('all');
    setError('');
    setScreenshotTarget(null);
  }

  async function generateSteps() {
    setError('');
    setGeneratingSteps(true);
    try {
      const response = await fetch(apiUrl('/api/steps'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: form.url,
          name: form.name,
          task: form.task,
          ai: { enabled: true },
        }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '步骤生成失败');
      }
      const plan = data.plan || null;
      setStepPlan(plan);
      setSteps((plan?.steps || []).map((step) => normalizeDraftStep({ ...step, id: crypto.randomUUID() })).filter(Boolean));
    } catch (stepError) {
      setError(stepError.message || '步骤生成失败');
    } finally {
      setGeneratingSteps(false);
    }
  }

  const filteredIssues = React.useMemo(() => {
    const issues = audit?.issues || [];
    return issues.filter((issue) => (
      (severityFilter === 'all' || issue.severity === severityFilter)
      && (taskStateFilter === 'all' || issueTaskStateKey(issue) === taskStateFilter)
    ));
  }, [audit, severityFilter, taskStateFilter]);

  return (
    <main className="workspace home-workspace">
      <section className="page-hero">
        <div>
          <h1>无障碍走查</h1>
          <p>基于 WCAG 标准、页面证据链和多模态 AI 推理的无障碍体验走查助手</p>
        </div>
        <div className="hero-actions">
          <Button type="button" variant="secondary" onClick={startNewAudit}>
            <NewAuditIcon className="h-4 w-4" />
            新建走查
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
          <PanelHeader title="输入" />
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
              </div>
            </fieldset>

            <fieldset>
              <legend>高级设置</legend>
              <label className="advanced-toggle">
                <input
                  type="checkbox"
                  checked={form.advancedTaskEnabled}
                  onChange={(event) => setForm({ ...form, advancedTaskEnabled: event.target.checked })}
                />
                <span>
                  <strong>启用自然语言任务</strong>
                  <em>需要先跑登录、表单提交、弹窗等业务路径时再开启</em>
                </span>
              </label>
            </fieldset>

            {form.advancedTaskEnabled ? (
              <>
                <fieldset>
                  <legend>自然语言任务</legend>
                  <p className="field-hint">描述要验收的业务路径，系统会自动解析成具体步骤</p>
                  <Textarea
                    id="target-task"
                    name="task"
                    aria-label="任务路径"
                    placeholder="例如：打开新增弹窗，填写名称为测试项目，提交表单，等待成功 toast"
                    value={form.task}
                    onChange={(event) => setForm({ ...form, task: event.target.value })}
                  />
                  <div className="task-actions">
                    <Button type="button" variant="secondary" onClick={generateSteps} disabled={generatingSteps || !form.task.trim()}>
                      {generatingSteps ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      {generatingSteps ? '生成中' : '生成步骤'}
                    </Button>
                    <span>{stepPlan ? stepPlanLabel(stepPlan) : '可先生成预览，也可以直接开始走查。'}</span>
                  </div>
                  {stepPlan?.assumptions?.length || stepPlan?.warnings?.length ? (
                    <div className="step-plan-note">
                      {[...(stepPlan.assumptions || []), ...(stepPlan.warnings || [])].slice(0, 3).map((item) => (
                        <p key={item}>{item}</p>
                      ))}
                    </div>
                  ) : null}
                </fieldset>

                <fieldset>
                  <legend>生成步骤预览</legend>
                  <p className="field-hint">展示 AI 或本地规则生成的可执行步骤，可手动调整</p>
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
                          placeholder={stepValuePlaceholder(step.action)}
                          value={stepInputValue(step)}
                          onChange={(event) => updateStep(steps, setSteps, index, valuePatchForStep(step.action, event.target.value))}
                        />
                        <Button type="button" variant="ghost" size="icon" aria-label={`删除第 ${index + 1} 步`} onClick={() => setSteps(steps.filter((_, stepIndex) => stepIndex !== index))}>
                          <X className="h-4 w-4" />
                        </Button>
                        {step.description ? <p className="step-description">{step.description}</p> : null}
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
              </>
            ) : null}

            {error ? <p className="error-message">{error}</p> : null}

            <Button className="run-button" size="lg" disabled={loading}>
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5 fill-current" />}
              {loading ? '走查中' : '开始走查'}
            </Button>
          </div>
        </form>

        <section className="result-panel">
          <PanelHeader
            title="本次走查结果"
            action={!loading && audit && links ? <ExportMenu links={links} /> : null}
          />
          <div className="result-content">
            {loading ? (
              <EmptyState
                title="正在生成走查报告"
                description="稍等片刻，正在检测目标页面"
                loading
              />
            ) : audit ? (
              <ReportDetailContent
                audit={audit}
                links={links}
                severityFilter={severityFilter}
                onSeverityChange={setSeverityFilter}
                taskStateFilter={taskStateFilter}
                onTaskStateChange={setTaskStateFilter}
                filteredIssues={filteredIssues}
                onOpenScreenshot={(target) => setScreenshotTarget(target || { label: '完整页面截图' })}
              />
            ) : (
              <EmptyState title="等待走查结果" description="点击输入面板中的按钮运行后，结果会显示在这里。" />
            )}
          </div>
        </section>
      </div>

      {screenshotTarget && screenshotSrcForTarget(links, screenshotTarget) ? (
        <ScreenshotModal
          src={screenshotSrcForTarget(links, screenshotTarget)}
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

function ReportDetailContent({ audit, links, severityFilter, onSeverityChange, taskStateFilter, onTaskStateChange, filteredIssues, onOpenScreenshot }) {
  const enhancementByIssue = React.useMemo(() => {
    return new Map((audit?.ai?.issueEnhancements || []).map((enhancement) => [enhancement.issueId, enhancement]));
  }, [audit]);
  const issueGroups = React.useMemo(() => groupIssuesForDisplay(filteredIssues, enhancementByIssue), [filteredIssues, enhancementByIssue]);
  const taskScopedIssues = React.useMemo(() => {
    if (taskStateFilter === 'all') {
      return audit.issues || [];
    }
    return (audit.issues || []).filter((issue) => issueTaskStateKey(issue) === taskStateFilter);
  }, [audit, taskStateFilter]);

  function handleTaskStateChange(nextState) {
    onTaskStateChange(nextState);
  }

  return (
    <>
      <SummaryStrip
        audit={audit}
        links={links}
        taskStateFilter={taskStateFilter}
        onTaskStateChange={handleTaskStateChange}
        onOpenScreenshot={onOpenScreenshot}
      />
      {taskStateFilter !== 'all' ? (
        <div className="task-state-filter" data-testid="task-state-filter">
          <span>当前查看：{taskStateLabel(audit.meta?.taskConclusion, taskStateFilter)}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => handleTaskStateChange('all')}>
            查看全部问题
          </Button>
        </div>
      ) : null}
      <SeverityPills audit={audit} issues={taskScopedIssues} value={severityFilter} onChange={onSeverityChange} />
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

function SummaryStrip({ audit, links, taskStateFilter, onTaskStateChange, onOpenScreenshot }) {
  const [analysisOpen, setAnalysisOpen] = React.useState(false);
  const analysisIconRef = React.useRef(null);
  const summary = audit.summary || {};
  const aiSummary = audit.ai?.summary || {};
  const taskConclusion = audit.meta?.taskConclusion;
  const riskLevel = aiSummary.riskLevel || inferRiskLevel(summary);
  const analysis = buildAuditAnalysis(audit.issues || [], summary);

  return (
    <>
      <div className="summary-strip">
        <button className="screenshot-preview" type="button" aria-label="查看完整页面截图" onClick={() => onOpenScreenshot({ label: '完整页面截图', screenshotSrc: links?.screenshot })}>
          {links?.screenshot ? <img src={links.screenshot} alt="页面首屏截图" /> : <div className="screenshot-fallback">暂无截图</div>}
          <span>点击查看完整截图</span>
        </button>
        <div className="summary-brief">
          <div className="summary-metric-row">
            <div className="summary-total">
              <strong>{summary.total || 0}</strong>
              <span>个问题</span>
            </div>
            <Badge variant={riskBadge(riskLevel)}>{riskLabel(riskLevel)}</Badge>
          </div>
          <div className="summary-ai-brief">
            <div className="summary-ai-title">
              <div>
                <span><Sparkles className="h-4 w-4" />走查分析</span>
                {audit.ai?.status === 'failed' ? <Badge variant="major">降级</Badge> : null}
              </div>
              <Button
                className="summary-analysis-button"
                type="button"
                variant="ghost"
                onClick={() => setAnalysisOpen(true)}
                onMouseEnter={() => analysisIconRef.current?.startAnimation()}
                onMouseLeave={() => analysisIconRef.current?.stopAnimation()}
              >
                查看完整分析
                <MoveRightIcon
                  ref={analysisIconRef}
                  className="summary-analysis-icon"
                  size={15}
                  duration={0.72}
                  aria-hidden="true"
                />
              </Button>
            </div>
            <p>{analysis.shortSummary}</p>
          </div>
        </div>
      </div>
      {taskConclusion ? (
        <TaskConclusionCard
          conclusion={taskConclusion}
          issues={audit.issues || []}
          selectedTaskState={taskStateFilter}
          onSelectTaskState={onTaskStateChange}
        />
      ) : null}
      {analysisOpen ? <AuditAnalysisModal analysis={analysis} ai={audit.ai} onClose={() => setAnalysisOpen(false)} /> : null}
    </>
  );
}

function TaskConclusionCard({ conclusion, issues = [], selectedTaskState = 'all', onSelectTaskState }) {
  const taskIssueGroups = React.useMemo(() => buildTaskStateIssueGroups(conclusion, issues), [conclusion, issues]);
  return (
    <section className={cn('task-conclusion-card', `is-${conclusion.status || 'review'}`)}>
      <div>
        <div className="task-conclusion-status-row">
          <Badge variant={conclusion.status === 'blocked' ? 'blocker' : conclusion.status === 'needs-fix' ? 'major' : 'minor'}>
            {conclusion.label || '任务走查结论'}
          </Badge>
          <Badge variant="default" className="task-plan-badge">
            {stepPlanLabel({ provider: conclusion.generatedBy, confidence: conclusion.confidence, steps: conclusion.steps })}
          </Badge>
        </div>
        <h3>{conclusion.task || '页面任务路径'}</h3>
        <p>{conclusion.verdict}</p>
      </div>
      {taskIssueGroups.length ? (
        <div className="task-issue-groups">
          <div className="task-issue-groups-title">
            <div>
              <strong>按任务状态聚合问题</strong>
              <small>同一问题出现在多个流程状态时，会分别计数</small>
            </div>
          </div>
          <div className="task-issue-group-list">
            {taskIssueGroups.map((group) => (
              <button
                key={group.key}
                className={cn('task-issue-group', selectedTaskState === group.key && 'is-active')}
                type="button"
                data-testid={`task-state-${group.key}`}
                aria-pressed={selectedTaskState === group.key}
                onClick={() => onSelectTaskState?.(selectedTaskState === group.key ? 'all' : group.key)}
              >
                <div>
                  <strong>{group.label}</strong>
                  {group.description ? <span>{group.description}</span> : null}
                </div>
                <p>
                  {group.total} 个问题，阻断 {group.bySeverity.Blocker || 0}、严重 {group.bySeverity.Major || 0}
                </p>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function AuditAnalysisModal({ analysis, ai, onClose }) {
  const pieStyle = { background: distributionPieGradient(analysis.distribution) };

  return createPortal(
    <div className="analysis-modal" role="dialog" aria-modal="true" aria-labelledby="analysis-title">
      <button className="modal-backdrop" type="button" aria-label="关闭完整分析报告" onClick={onClose} />
      <article className="analysis-modal-content">
        <Button className="modal-close" variant="secondary" size="icon" type="button" aria-label="关闭完整分析报告" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
        <header className="analysis-report-header">
          <p><Sparkles className="h-4 w-4" />AI 完整分析</p>
          <h3 id="analysis-title">本次无障碍走查总结</h3>
          <strong>{analysis.shortSummary}</strong>
        </header>
        <section className="analysis-section">
          <h4>问题分布</h4>
          <div className="analysis-distribution-chart">
            <div className="analysis-pie" style={pieStyle} role="img" aria-label={analysis.distribution.map((item) => `${item.label} ${item.count} 个，占比 ${item.percent}`).join('，')}>
              <span>{analysis.total}</span>
              <small>总问题</small>
            </div>
            <div className="analysis-distribution-legend">
              {analysis.distribution.map((item) => (
                <div key={item.label}>
                  <span className="analysis-legend-dot" style={{ background: item.color }} aria-hidden="true" />
                  <strong>{item.label}</strong>
                  <em>{item.count} 个</em>
                  <b>{item.percent}</b>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="analysis-section">
          <h4>核心问题（按修复优先级）</h4>
          <ol className="analysis-core-list">
            {analysis.coreIssues.map((item, index) => (
              <li key={`${item.title}-${item.count}`}>
                <span className="analysis-core-number">{index + 1}</span>
                <div>
                  <strong>{item.title}（{item.severityLabel}，{item.count} 处）</strong>
                  <span>{item.description}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="analysis-section">
          <h4>修复策略建议</h4>
          <p>{analysis.repairSummary}</p>
        </section>
        <section className="analysis-section">
          <SemanticFindings ai={ai} />
        </section>
      </article>
    </div>,
    document.body,
  );
}

function SeverityPills({ audit, issues, value, onChange }) {
  const scopedIssues = issues || audit.issues || [];
  const scopedBySeverity = countIssuesBySeverity(scopedIssues);
  const items = [
    { value: 'all', label: '全部', count: scopedIssues.length || 0 },
    ...severityOptions
      .filter((option) => option.value !== 'all')
      .map((option) => ({ ...option, count: scopedBySeverity[option.value] || 0 })),
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

function buildAuditAnalysis(issues = [], summary = {}) {
  const groups = groupIssuesForInsight(issues);
  const bySeverity = {
    ...countIssuesBySeverity(issues),
    ...(summary.bySeverity || {}),
  };
  const total = summary.total ?? issues.length;
  const highPriority = (bySeverity.Blocker || 0) + (bySeverity.Major || 0);
  const blockerGroup = groups.find((group) => group.severity === 'Blocker');
  const majorGroup = groups.find((group) => group.severity === 'Major');
  const mostFrequentGroup = [...groups].sort((left, right) => right.count - left.count || insightSeverityRank(right.severity) - insightSeverityRank(left.severity))[0];
  const riskGroup = blockerGroup || majorGroup || groups[0];
  const riskLevel = blockerGroup || majorGroup ? '高' : issues.length ? '中' : '低';
  const shortSummary = issues.length
    ? `本次共发现 ${total} 个问题，整体风险等级为${riskLevel}，其中高优先级问题 ${highPriority} 个，建议优先处理「${shortIssueTitle(riskGroup?.title)}」。`
    : '本次未发现自动化规则问题，仍建议进行关键流程和读屏体验人工复核。';
  const distribution = [
    { label: '阻断', count: bySeverity.Blocker || 0, percent: formatIssuePercent(bySeverity.Blocker || 0, total), color: '#dc2626' },
    { label: '严重', count: bySeverity.Major || 0, percent: formatIssuePercent(bySeverity.Major || 0, total), color: '#f97316' },
    { label: '一般', count: bySeverity.Minor || 0, percent: formatIssuePercent(bySeverity.Minor || 0, total), color: '#2563eb' },
    { label: '建议', count: bySeverity.Suggestion || 0, percent: formatIssuePercent(bySeverity.Suggestion || 0, total), color: '#7c3aed' },
  ];
  const coreIssues = groups.slice(0, 7).map((group) => ({
    title: shortIssueTitle(group.title, 42),
    severityLabel: severityLabelForInsight(group.severity),
    count: group.count,
    description: diagnosisForInsight(group, total),
  }));
  const repairSummary = mostFrequentGroup
    ? buildRepairSummary(groups, total)
    : '没有形成明显集中问题，建议保留人工抽样复核。';

  return {
    total,
    shortSummary,
    distribution,
    coreIssues,
    repairSummary,
  };
}

function buildTaskStateIssueGroups(conclusion, issues = []) {
  if (!conclusion || !issues.length) {
    return [];
  }

  const snapshots = Array.isArray(conclusion.flowSnapshots) ? conclusion.flowSnapshots : [];
  const snapshotByIndex = new Map(snapshots.map((snapshot) => [Number(snapshot.index), snapshot]));
  const groups = new Map();

  function ensureGroup(key, label, description = '', order = 0) {
    const current = groups.get(key) || {
      key,
      label,
      description,
      order,
      issues: [],
    };
    if (!current.description && description) {
      current.description = description;
    }
    groups.set(key, current);
    return current;
  }

  for (const snapshot of snapshots) {
    ensureGroup(
      `flow-${snapshot.index}`,
      `第 ${snapshot.index} 步后`,
      snapshot.description || snapshot.action || '',
      Number(snapshot.index) || 0,
    );
  }

  for (const issue of issues) {
    const stepIndex = Number(issue.flowStep?.index || issue.evidence?.flowStep?.index || 0);
    const snapshot = stepIndex ? snapshotByIndex.get(stepIndex) : null;
    const group = stepIndex
      ? ensureGroup(`flow-${stepIndex}`, `第 ${stepIndex} 步后`, snapshot?.description || issue.flowStep?.description || '', stepIndex)
      : ensureGroup('final', '最终页面', conclusion.finalUrl ? shortUrl(conclusion.finalUrl) : '', snapshots.length + 1);
    group.issues.push(issue);
  }

  return Array.from(groups.values())
    .filter((group) => group.issues.length)
    .sort((left, right) => left.order - right.order)
    .map((group) => {
      return {
        ...group,
        total: group.issues.length,
        bySeverity: countIssuesBySeverity(group.issues),
      };
    });
}

function issueTaskStateKey(issue) {
  const stepIndex = Number(issue?.flowStep?.index || issue?.evidence?.flowStep?.index || 0);
  return stepIndex ? `flow-${stepIndex}` : 'final';
}

function taskStateLabel(conclusion, stateKey) {
  if (stateKey === 'final') {
    return '最终页面';
  }
  const snapshot = (conclusion?.flowSnapshots || []).find((item) => `flow-${item.index}` === stateKey);
  return snapshot ? `第 ${snapshot.index} 步后` : stateKey;
}

function buildUiFallbackSummary(issues = []) {
  const groups = groupIssuesForInsight(issues);
  const bySeverity = countIssuesBySeverity(issues);
  const blockerGroup = groups.find((group) => group.severity === 'Blocker');
  const majorGroup = groups.find((group) => group.severity === 'Major');
  const mostFrequentGroup = [...groups].sort((left, right) => right.count - left.count || insightSeverityRank(right.severity) - insightSeverityRank(left.severity))[0];
  const riskGroup = blockerGroup || majorGroup || groups[0];
  const topGroup = groups[0];

  if (!groups.length) {
    return {
      verdict: '',
      keyFindings: [],
      recommendedNextSteps: [],
    };
  }

  const verdict = [
    `共发现 ${issues.length} 个问题，其中阻断 ${bySeverity.Blocker}、严重 ${bySeverity.Major}、一般 ${bySeverity.Minor}、建议 ${bySeverity.Suggestion}。`,
    `首要风险是「${shortIssueTitle(riskGroup.title)}」，出现最多的是「${shortIssueTitle(mostFrequentGroup.title)}」（${mostFrequentGroup.count} 处）。`,
  ].join('');

  return {
    verdict,
    keyFindings: [
      `首要风险：${shortIssueTitle(riskGroup.title)}（${severityLabelForInsight(riskGroup.severity)}），${diagnosisForInsight(riskGroup)}`,
      mostFrequentGroup && mostFrequentGroup !== riskGroup
        ? `最高频问题：${shortIssueTitle(mostFrequentGroup.title)}出现 ${mostFrequentGroup.count} 处，建议从${repairLayerForInsight(mostFrequentGroup)}统一处理。`
        : `最高频问题同样是首要风险，共出现 ${riskGroup.count} 处，建议从${repairLayerForInsight(riskGroup)}统一处理。`,
    ].filter(Boolean),
    recommendedNextSteps: buildInsightNextSteps(groups, blockerGroup, mostFrequentGroup),
  };
}

function countIssuesBySeverity(issues = []) {
  return issues.reduce((result, issue) => {
    const severity = issue.severity || 'Suggestion';
    result[severity] = (result[severity] || 0) + 1;
    return result;
  }, { Blocker: 0, Major: 0, Minor: 0, Suggestion: 0 });
}

function shortIssueTitle(title, maxLength = 24) {
  const value = String(title || '未命名问题').replace(/\s+/g, ' ').trim();
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function formatIssuePercent(count, total) {
  if (!total) {
    return '0%';
  }
  return `${((count / total) * 100).toFixed(1)}%`;
}

function distributionPieGradient(distribution = []) {
  const total = distribution.reduce((sum, item) => sum + item.count, 0);
  if (!total) {
    return 'conic-gradient(rgb(226 232 240) 0deg 360deg)';
  }
  let cursor = 0;
  const segments = distribution
    .filter((item) => item.count > 0)
    .map((item) => {
      const start = cursor;
      const end = cursor + (item.count / total) * 360;
      cursor = end;
      return `${item.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
    });
  return `conic-gradient(${segments.join(', ')})`;
}

function severityLabelForInsight(severity) {
  return {
    Blocker: '阻断',
    Major: '严重',
    Minor: '一般',
    Suggestion: '建议',
  }[severity] || '建议';
}

function groupIssuesForInsight(issues = []) {
  const grouped = new Map();
  for (const issue of issues) {
    const category = insightCategoryForIssue(issue);
    const key = category || [issue.title, issue.ruleSource, issue.tier].map((value) => String(value || '').trim().toLowerCase()).join('|');
    const current = grouped.get(key) || {
      category,
      title: insightTitleForIssue(issue, category),
      severity: issue.severity || 'Suggestion',
      ruleSource: issue.ruleSource || '',
      tier: issue.tier || '',
      recommendation: issue.recommendation || '',
      count: 0,
    };
    current.count += 1;
    current.severity = higherInsightSeverity(current.severity, issue.severity);
    if (!current.ruleSource && issue.ruleSource) {
      current.ruleSource = issue.ruleSource;
    }
    if (!current.recommendation && issue.recommendation) {
      current.recommendation = issue.recommendation;
    }
    grouped.set(key, current);
  }
  return Array.from(grouped.values()).sort((left, right) => (
    insightPriorityRank(left) - insightPriorityRank(right)
    || insightSeverityRank(right.severity) - insightSeverityRank(left.severity)
    || right.count - left.count
  ));
}

function insightCategoryForIssue(issue = {}) {
  const text = insightIssueText(issue);
  if (/button-name|按钮缺少|按钮.*可访问名称/i.test(text)) {
    return 'accessible-name-button';
  }
  if (/link-name|链接缺少|链接.*可访问名称/i.test(text)) {
    return 'accessible-name-link';
  }
  if (/\blabel\b|表单.*标签|输入框.*名称|表单控件/i.test(text)) {
    return 'accessible-name-form';
  }
  if (/accessible name|可访问名称|缺少可访问名称|aria-label|aria-labelledby/i.test(text)) {
    return 'accessible-name-control';
  }
  if (/target-size|target size|触控|点击目标|可点击目标|尺寸小于|24px/i.test(text)) {
    return 'target-size';
  }
  if (/color-contrast|contrast|对比度/i.test(text)) {
    return 'color-contrast';
  }
  if (/listitem|list item|列表结构|<li>|ul>|ol>|列表项/i.test(text)) {
    return 'list-structure';
  }
  if (/landmark|one-main|main-is-top-level|region|页面结构|<main>|main landmark/i.test(text)) {
    return 'landmark';
  }
  if (/meta-viewport|viewport|maximum-scale|user-scalable|禁用缩放|缩放/i.test(text)) {
    return 'viewport';
  }
  if (/image-alt|alt|替代文本|图片/i.test(text)) {
    return 'image-alt';
  }
  return '';
}

function insightTitleForIssue(issue = {}, category = '') {
  return {
    'accessible-name-button': '按钮缺少可访问名称',
    'accessible-name-link': '链接缺少可访问名称',
    'accessible-name-form': '表单控件缺少可访问名称',
    'accessible-name-control': '控件缺少可访问名称',
    'target-size': '可点击目标尺寸小于 24px',
    'color-contrast': '文字颜色对比度不足',
    'list-structure': '列表结构错误',
    landmark: '页面结构 / landmark 问题',
    viewport: '移动端禁用缩放',
    'image-alt': '图片替代文本需人工复核',
  }[category] || issue.title || '未命名问题';
}

function insightIssueText(issue = {}) {
  return [
    issue.title,
    issue.id,
    issue.ruleSource,
    issue.ruleUrl,
    issue.recommendation,
    issue.evidence?.failureSummary,
  ].filter(Boolean).join(' ');
}

function insightPriorityRank(group) {
  if (String(group.category || '').startsWith('accessible-name')) {
    return 1;
  }
  const categoryOrder = {
    'target-size': 2,
    'color-contrast': 3,
    'list-structure': 4,
    landmark: 5,
    viewport: 6,
    'image-alt': 7,
  };
  if (categoryOrder[group.category]) {
    return categoryOrder[group.category];
  }
  return 20 - insightSeverityRank(group.severity);
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

function diagnosisForInsight(group, total = 0) {
  const text = insightGroupText(group);
  const percent = formatIssuePercent(group.count, total);
  if (String(group.category || '').startsWith('accessible-name')) {
    const prefix = group.severity === 'Blocker' && group.count === 1
      ? '这是唯一的阻断级问题，也是首要风险。'
      : '这是会直接影响读屏和键盘用户完成任务的高优先级问题。';
    return `${prefix}图标按钮、组合框触发器或无文本控件视觉上能看懂，但没有同步提供 aria-label、aria-labelledby 或可见文本；依赖辅助技术的用户可能无法理解控件用途，应最先修复。`;
  }
  if (group.category === 'target-size') {
    return `这是数量最多的体验类问题之一，占全部问题 ${percent}。大量头像链接、图标按钮或紧凑数字按钮未达到 WCAG 2.2 的 24×24px 最小触控目标；如果它们来自同一套卡片或列表组件，建议在组件层统一扩大热区或调整相邻间距，一次性批量解决。`;
  }
  if (group.category === 'color-contrast') {
    return `文本与背景色对比度低于 WCAG 4.5:1 要求，常集中在弱化文字、侧边栏导航、计数数字或禁用态上。它通常不是单点文案问题，而是颜色 token、组件默认态或状态色没有统一校准。`;
  }
  if (group.category === 'list-structure') {
    return '大量 <li> 缺少 <ul>/<ol> 父元素，读屏器无法正确识别列表层级和列表项数量。应修正 DOM 结构或组件模板，而不是只依赖视觉排版模拟列表。';
  }
  if (group.category === 'landmark') {
    return '这类问题通常来自页面模板或布局容器重复输出 landmark，例如嵌套 <main>、重复 main landmark 或 landmark 缺少唯一标识。根因在页面结构层，修一次模板往往可以同时消除多个相关告警。';
  }
  if (group.category === 'viewport') {
    return 'viewport 配置限制缩放会让低视力用户无法放大页面查看内容。重点检查 maximum-scale、user-scalable 等属性，移除禁止缩放的配置即可。';
  }
  if (group.category === 'image-alt') {
    return '图片替代文本需要结合语义人工复核：承载信息的图片应说明内容和用途，装饰性背景图或无意义头像应使用空 alt，避免读屏器读出噪音。';
  }
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

function buildRepairSummary(groups = [], total = 0) {
  const blockerGroup = groups.find((group) => group.severity === 'Blocker');
  const reusableGroups = groups.filter((group) => ['target-size', 'color-contrast', 'list-structure'].includes(group.category));
  const reusableTotal = reusableGroups.reduce((sum, group) => sum + group.count, 0);
  const lead = blockerGroup
    ? `${blockerGroup.count} 个阻断项需要单独优先修复`
    : '当前没有阻断项，但仍应先处理高优先级问题';
  const reusableText = reusableGroups.length
    ? `${reusableGroups.map((group) => `${shortIssueTitle(group.title)}（${group.count}）`).join('、')} 合计占 ${formatIssuePercent(reusableTotal, total)}，多半可以在组件、设计 token 或 DOM 模板层统一改动`
    : `${groups.slice(0, 3).map((group) => `${shortIssueTitle(group.title)}（${group.count}）`).join('、')} 是本次主要问题来源`;

  return `问题虽多，但集中在少数可复用源头上：${lead}；${reusableText}，实际改动点通常少于问题实例数。建议按“阻断项 -> 组件级批量项 -> 页面结构项 -> alt 与内容人工复核”的顺序推进。`;
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

function SemanticFindings({ ai }) {
  const visibleFindings = meaningfulSemanticFindings(ai?.semanticFindings || []);
  const state = semanticReviewState(ai, visibleFindings.length);

  return (
    <div className="ai-findings">
      <div className="ai-findings-header">
        <strong>AI 语义复核</strong>
        <Badge variant={state.badge}>{state.label}</Badge>
      </div>
      <p className="ai-muted">{state.description}</p>
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

function semanticReviewState(ai, findingCount) {
  if (!ai) {
    return {
      label: '未运行',
      badge: 'default',
      description: '本次报告没有 AI 语义复核记录。',
    };
  }

  if (ai.status === 'enabled') {
    return {
      label: findingCount ? `${findingCount} 项` : '已运行',
      badge: findingCount ? 'minor' : 'default',
      description: findingCount
        ? 'AI 已基于页面证据补充语义类复核项。'
        : 'AI 已参与本次走查，未发现额外语义复核项。',
    };
  }

  if (ai.status === 'failed') {
    return {
      label: '降级',
      badge: 'major',
      description: `AI 语义复核调用失败，报告已使用自动规则和本地降级分析继续生成。${ai.error ? `原因：${ai.error}` : ''}`,
    };
  }

  return {
    label: '未运行',
    badge: 'default',
    description: ai.reason ? `AI 语义复核未运行：${ai.reason}` : 'AI 语义复核未运行。',
  };
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
        {issue.flowStep ? <Badge>{`第 ${issue.flowStep.index} 步后`}</Badge> : null}
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
  const flowPrefix = evidence.flowStep?.index ? `第 ${evidence.flowStep.index} 步后 · ` : '';
  if (evidence.previous && evidence.current) {
    return `${flowPrefix}从「${evidenceText(evidence.previous)}」跳到「${evidenceText(evidence.current)}」，需要复核页面结构顺序。`;
  }

  if (Array.isArray(evidence.path)) {
    return `${flowPrefix}键盘遍历记录包含 ${evidence.path.length} 个焦点节点，实际聚焦到 ${evidence.uniqueFocusedCount || evidence.path.length} 个不同元素。`;
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

  return `${flowPrefix}${parts.length ? parts.join(' · ') : '系统记录到该问题的运行时元素和检测上下文，可展开查看问题定位信息。'}`;
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
    issue.flowStep?.index ? `flow-step-${issue.flowStep.index}` : 'final-state',
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
  const [taskStateFilter, setTaskStateFilter] = React.useState('all');
  const [screenshotTarget, setScreenshotTarget] = React.useState(null);
  const historyShellRef = React.useRef(null);
  const historyDetailRef = React.useRef(null);

  React.useEffect(() => {
    fetch(apiUrl('/api/reports'))
      .then((response) => readJsonResponse(response))
      .then((data) => setReports((data.reports || []).map(resolveReport)))
      .finally(() => setLoading(false));
  }, []);

  const filteredIssues = React.useMemo(() => {
    const issues = selectedAudit?.issues || [];
    return issues.filter((issue) => (
      (severityFilter === 'all' || issue.severity === severityFilter)
      && (taskStateFilter === 'all' || issueTaskStateKey(issue) === taskStateFilter)
    ));
  }, [selectedAudit, severityFilter, taskStateFilter]);

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
    setTaskStateFilter('all');
    setDetailLoading(true);

    try {
      const response = await fetch(apiUrl(report.links?.audit));
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
          <a href="/" aria-label="返回无障碍走查">
            <ArrowLeft className="h-5 w-5" />
          </a>
        </Button>
        <div className="history-nav-brand">
          <span className="history-nav-summary" aria-label="已存档报告数量">
            已存档报告 <strong>{reports.length}</strong>
          </span>
          <span className="history-nav-summary history-nav-summary-latest" aria-label="最近一次记录">
            最近一次记录 <strong>{reports[0] ? formatDate(reports[0].generatedAt) : '—'}</strong>
          </span>
        </div>
      </section>
      <section
        className={cn('history-shell', selectedReport && 'has-detail', loading && 'is-loading')}
        ref={historyShellRef}
      >
        <section className={cn('history-panel', loading && 'is-loading')}>
          {loading ? (
            <div className="history-loading-state" role="status" aria-live="polite">
              <div className="empty-mark" aria-hidden="true" />
              <h3>正在加载</h3>
              <p>正在读取本地报告记录。</p>
            </div>
          ) : null}
          {!loading && !reports.length ? <EmptyState title="暂无历史报告" description="完成一次走查后，报告会出现在这里。" /> : null}
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
              {detailLoading ? <EmptyState title="正在加载报告" description="正在读取这次走查的完整结果。" /> : null}
              {!detailLoading && detailError ? <EmptyState title="报告读取失败" description={detailError} /> : null}
              {!detailLoading && !detailError && selectedAudit ? (
                <ReportDetailContent
                  audit={selectedAudit}
                  links={selectedReport.links}
                  severityFilter={severityFilter}
                  onSeverityChange={setSeverityFilter}
                  taskStateFilter={taskStateFilter}
                  onTaskStateChange={setTaskStateFilter}
                  filteredIssues={filteredIssues}
                  onOpenScreenshot={(target) => setScreenshotTarget(target || { label: '完整页面截图' })}
                />
              ) : null}
            </div>
          </section>
        ) : null}
      </section>

      {screenshotTarget && screenshotSrcForTarget(selectedReport?.links, screenshotTarget) ? (
        <ScreenshotModal
          src={screenshotSrcForTarget(selectedReport.links, screenshotTarget)}
          target={screenshotTarget}
          onClose={() => setScreenshotTarget(null)}
        />
      ) : null}
    </main>
  );
}

function ScreenshotModal({ src, target, onClose }) {
  const [imageSize, setImageSize] = React.useState(null);
  const modalRef = React.useRef(null);
  const imageRef = React.useRef(null);
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

  React.useEffect(() => {
    setImageSize(null);
  }, [src]);

  React.useEffect(() => {
    const modal = modalRef.current;
    const image = imageRef.current;
    if (!modal || !image || !imageSize) {
      return;
    }
    if (!rect) {
      modal.scrollTo({ top: 0, left: 0 });
      return;
    }

    const scaleX = image.clientWidth / imageSize.width;
    const scaleY = image.clientHeight / imageSize.height;
    const targetX = (rect.x + rect.width / 2) * scaleX - modal.clientWidth / 2;
    const targetY = (rect.y + rect.height / 2) * scaleY - modal.clientHeight / 2;
    const frame = window.requestAnimationFrame(() => {
      modal.scrollTo({
        left: Math.max(0, targetX),
        top: Math.max(0, targetY),
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [imageSize, rect?.x, rect?.y, rect?.width, rect?.height]);

  return (
    <div className="screenshot-modal" role="dialog" aria-modal="true" aria-label={title}>
      <button className="modal-backdrop" type="button" aria-label="关闭完整页面截图" onClick={onClose} />
      <div className="screenshot-modal-shell">
        <Button className="modal-close" variant="secondary" size="icon" type="button" aria-label="关闭完整页面截图" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
        <div className="modal-content screenshot-modal-content" ref={modalRef}>
          <div className="screenshot-stage">
            <img
              ref={imageRef}
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
    </div>
  );
}

function screenshotSrcForTarget(links, target) {
  if (target?.screenshotSrc) {
    return target.screenshotSrc;
  }
  if (!links) {
    return '';
  }
  const stepIndex = target?.evidence?.flowStep?.index || target?.flowStep?.index;
  if (stepIndex && links.flowScreenshots?.[String(stepIndex)]) {
    return links.flowScreenshots[String(stepIndex)];
  }
  return links.screenshot || '';
}

function updateStep(steps, setSteps, index, patch) {
  setSteps(steps.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step)));
}

function stepInputValue(step) {
  if (step.action === 'press') {
    return step.key || step.value || '';
  }
  if (step.action === 'wait') {
    return step.ms || step.value || '';
  }
  return step.value || '';
}

function stepValuePlaceholder(action) {
  if (action === 'press') {
    return '按键';
  }
  if (action === 'wait') {
    return '毫秒';
  }
  if (action === 'fill') {
    return '输入值';
  }
  return '值';
}

function valuePatchForStep(action, value) {
  if (action === 'press') {
    return { key: value, value: '' };
  }
  if (action === 'wait') {
    return { ms: value, value: '' };
  }
  return { value };
}

function normalizeStepPayload(step) {
  const base = {
    action: step.action,
    description: step.description || undefined,
    selectors: step.selectors?.length ? step.selectors : undefined,
    role: step.role || undefined,
    name: step.name || undefined,
    label: step.label || undefined,
    text: step.text || undefined,
    timeout: step.timeout ? Number(step.timeout) : undefined,
  };
  if (step.action === 'wait') {
    return { ...base, ms: Number(step.ms || step.value || 1000) };
  }
  if (step.action === 'press') {
    return { ...base, key: step.key || step.value || 'Enter' };
  }
  if (step.action === 'fill') {
    return { ...base, selector: step.selector || undefined, value: step.value || '' };
  }
  return {
    ...base,
    selector: step.selector || undefined,
  };
}

function stepPlanLabel(plan) {
  const source = {
    gemini: 'AI 生成',
    'local-rules': '本地规则生成',
    'local-fallback': '本地兜底生成',
    manual: '手动步骤',
  }[plan.provider] || plan.provider || '已生成';
  return `${source} · ${plan.steps?.length || 0} 步 · ${confidenceLabel(plan.confidence)}`;
}

function confidenceLabel(confidence) {
  return {
    high: '高置信',
    medium: '中等置信',
    low: '低置信',
    'needs-review': '需复核',
  }[confidence] || '需复核';
}

function shortUrl(value = '') {
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') {
      return '本地文件';
    }
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return value;
  }
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
    .replace(/^本次(?:审计|走查)发现\s*\d+\s*个问题，?其中阻断\s*\d+\s*个、?严重\s*\d+\s*个。?\s*/u, '')
    .replace(/^本次(?:审计|走查)发现\s*\d+\s*个问题。?\s*/u, '')
    .trim();
  return isLowValueAiSummaryItem(cleaned) ? '' : cleaned;
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
    throw new Error('走查服务未返回数据，请确认线上 Node 服务已启动且 /api 路径可访问。');
  }
  try {
    return JSON.parse(raw);
  } catch {
    const contentType = response.headers.get('content-type') || '';
    const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    const responsePreview = raw.replace(/\s+/g, ' ').trim().slice(0, 160);
    const looksLikeHtml = contentType.includes('text/html') || /^\s*<!doctype html|^\s*<html[\s>]/i.test(raw);
    const looksLikeVercelNotFound = response.status === 404 && /\bNOT_FOUND\b|The page could not be found/i.test(raw);
    if (looksLikeHtml || looksLikeVercelNotFound) {
      const deploymentHint = API_BASE_URL
        ? `请检查 VITE_API_BASE_URL 指向的走查服务是否可用。`
        : '当前 Vercel 部署未包含 /api/audit Function。请确认已部署最新代码，并在 Vercel Storage 中连接 Blob Store。';
      throw new Error(`当前站点只部署了前端静态页面，走查 API 未运行（HTTP ${status}）。${deploymentHint}`);
    }
    const detail = responsePreview ? `，响应：${responsePreview}` : '';
    throw new Error(`走查服务返回了非 JSON 内容（${contentType || '未知类型'}，HTTP ${status}${detail}）。请检查 /api 路由配置。`);
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
