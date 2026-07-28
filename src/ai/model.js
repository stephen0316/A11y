import { buildEvidencePack } from './evidence.js';

export const DEFAULT_AI_MODEL = 'qwen3.7-max';
export const DEFAULT_AI_BASE_URL = 'https://onerouter.cmaiot.cn/v1/responses';
export const FALLBACK_AI_MODELS = [];
const DEFAULT_AI_TIMEOUT_MS = 90000;
const DEFAULT_AI_MAX_ATTEMPTS = 2;
const DEFAULT_AI_RETRY_DELAY_MS = 800;

export const EMPTY_AI_RESULT = {
  summary: null,
  semanticFindings: [],
  issueEnhancements: [],
};

const SYSTEM_INSTRUCTION = `
你是一个资深 Web 无障碍走查专家，面向 UED、QA 和研发输出结果。
你必须基于提供的页面证据、WCAG/ARIA 规则、DOM、Accessibility Tree 和键盘路径判断。
不要声称已经做了真实读屏器人工测试；如果证据不足，请标为 needs-review。
不要覆盖 axe-core 的确定性结论，只补充语义判断、真实用户影响、根因和修复建议。
summary 必须像产品里的 AI 总结：短、明确、有判断。verdict 先概括总问题数和严重级别分布，再点出首要风险和最高频问题；keyFindings 只写 2 条，每条控制在 60 个中文字符以内。
禁止输出“优先修复阻断和严重问题”“按 selector 分派”“修复后重新运行”这类没有对象和洞见的泛泛建议；每条必须点名具体问题类型、证据模式或责任层。
输出必须是符合 schema 的 JSON，不要输出 Markdown 包裹或额外解释。
`.trim();

export const AI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'object',
      properties: {
        verdict: { type: 'string' },
        riskLevel: { type: 'string' },
        keyFindings: { type: 'array', items: { type: 'string' } },
        recommendedNextSteps: { type: 'array', items: { type: 'string' } },
      },
      required: ['verdict', 'riskLevel', 'keyFindings', 'recommendedNextSteps'],
    },
    semanticFindings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          category: { type: 'string' },
          severity: { type: 'string' },
          selector: { type: 'string' },
          reason: { type: 'string' },
          evidence: { type: 'string' },
          recommendation: { type: 'string' },
          confidence: { type: 'string' },
          relatedIssueIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title', 'category', 'severity', 'selector', 'reason', 'evidence', 'recommendation', 'confidence', 'relatedIssueIds'],
      },
    },
    issueEnhancements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          issueId: { type: 'string' },
          rootCause: { type: 'string' },
          userImpact: { type: 'string' },
          developerFix: { type: 'string' },
          uedFix: { type: 'string' },
          codeExample: { type: 'string' },
          copyableIssue: { type: 'string' },
          confidence: { type: 'string' },
        },
        required: ['issueId', 'rootCause', 'userImpact', 'developerFix', 'uedFix', 'codeExample', 'copyableIssue', 'confidence'],
      },
    },
  },
  required: ['summary', 'semanticFindings', 'issueEnhancements'],
};

export async function runAiAudit(input, options = {}) {
  const model = options.model || process.env.AI_MODEL || DEFAULT_AI_MODEL;
  const models = uniqueModels([
    model,
    ...(options.fallbackModels || modelsFromEnv(process.env.AI_FALLBACK_MODELS) || FALLBACK_AI_MODELS),
  ]);
  const evidencePack = buildEvidencePack(input);
  const base = {
    status: 'disabled',
    provider: 'openai-compatible',
    model,
    attemptedModels: [],
    evidencePack,
    ...EMPTY_AI_RESULT,
  };

  if (!options.enabled) {
    return {
      ...base,
      reason: 'AI audit is disabled for this run.',
    };
  }

  const apiKey = options.apiKey || process.env.AI_API_KEY;
  if (!apiKey) {
    return {
      ...base,
      reason: 'AI_API_KEY is not configured.',
    };
  }

  try {
    const { raw, usedModel, attemptedModels } = await requestAiAuditWithFallback({
      apiKey,
      baseUrl: options.baseUrl || process.env.AI_BASE_URL || DEFAULT_AI_BASE_URL,
      models,
      evidencePack,
      fetchImpl: options.fetchImpl || fetch,
      timeoutMs: options.timeoutMs || Number(process.env.AI_TIMEOUT_MS || DEFAULT_AI_TIMEOUT_MS),
      maxAttempts: options.maxAttempts || Number(process.env.AI_MAX_ATTEMPTS || DEFAULT_AI_MAX_ATTEMPTS),
      retryDelayMs: options.retryDelayMs ?? Number(process.env.AI_RETRY_DELAY_MS || DEFAULT_AI_RETRY_DELAY_MS),
    });
    const normalized = normalizeAiResponse(raw, input.issues || []);
    return {
      ...base,
      status: 'enabled',
      reason: undefined,
      model: usedModel,
      attemptedModels,
      ...normalized,
    };
  } catch (error) {
    const fallback = normalizeAiResponse({}, input.issues || []);
    return {
      ...base,
      ...fallback,
      status: 'failed',
      attemptedModels: error.attemptedModels || models,
      error: sanitizeError(error),
    };
  }
}

export async function requestAiAuditWithFallback({
  apiKey,
  baseUrl = DEFAULT_AI_BASE_URL,
  models,
  evidencePack,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_AI_TIMEOUT_MS,
  maxAttempts = DEFAULT_AI_MAX_ATTEMPTS,
  retryDelayMs = DEFAULT_AI_RETRY_DELAY_MS,
}) {
  const attemptedModels = [];
  const errors = [];
  const safeMaxAttempts = Math.max(1, Number(maxAttempts) || 1);

  for (const model of uniqueModels(models)) {
    attemptedModels.push(model);

    for (let attempt = 1; attempt <= safeMaxAttempts; attempt += 1) {
      try {
        const raw = await requestAiAudit({
          apiKey,
          baseUrl,
          model,
          evidencePack,
          fetchImpl,
          timeoutMs,
        });
        return { raw, usedModel: model, attemptedModels };
      } catch (error) {
        errors.push(`${model}#${attempt}: ${sanitizeError(error)}`);
        if (!isRetryableAiError(error)) {
          const finalError = new Error(errors.join(' | '));
          finalError.attemptedModels = attemptedModels;
          throw finalError;
        }
        if (attempt < safeMaxAttempts) {
          await sleep(retryDelayForAttempt(attempt, retryDelayMs));
        }
      }
    }
  }

  const finalError = new Error(errors.join(' | ') || 'AI request failed.');
  finalError.attemptedModels = attemptedModels;
  throw finalError;
}

export async function requestAiAudit({ apiKey, baseUrl = DEFAULT_AI_BASE_URL, model, evidencePack, fetchImpl = fetch, timeoutMs = 45000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        instructions: SYSTEM_INSTRUCTION,
        input: buildPrompt(evidencePack),
        temperature: 0.2,
      }),
    });

    const json = await response.json().catch(async () => ({
      rawText: await response.text().catch(() => ''),
    }));

    if (!response.ok) {
      const error = new Error(`AI request failed: ${response.status} ${response.statusText} ${truncate(JSON.stringify(json), 400)}`);
      error.status = response.status;
      error.responseBody = json;
      throw error;
    }

    const text = extractResponseText(json);
    if (!text) {
      throw new Error('AI response did not include output text.');
    }
    return parseJsonText(text);
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeAiResponse(value, issues = []) {
  const issueIds = new Set(issues.map((issue) => issue.id));
  const semanticFindings = Array.isArray(value?.semanticFindings) ? value.semanticFindings : [];
  const issueEnhancements = Array.isArray(value?.issueEnhancements) ? value.issueEnhancements : [];
  const normalizedEnhancements = issueEnhancements
    .filter((item) => !item.issueId || issueIds.has(String(item.issueId)))
    .slice(0, 60)
    .map((item) => normalizeIssueEnhancement(item));

  return {
    summary: normalizeSummary(value?.summary, issues),
    semanticFindings: dedupeSemanticFindings(completeSemanticFindings(semanticFindings, issues)).slice(0, 12).map((item, index) => ({
      id: String(item.id || `AI-S${index + 1}`),
      title: String(item.title || 'AI 语义复核项'),
      category: String(item.category || '语义复核'),
      severity: normalizeSeverity(item.severity),
      selector: String(item.selector || ''),
      reason: String(item.reason || ''),
      evidence: String(item.evidence || ''),
      recommendation: String(item.recommendation || ''),
      confidence: String(item.confidence || 'needs-review'),
      relatedIssueIds: Array.isArray(item.relatedIssueIds) ? item.relatedIssueIds.map(String) : [],
    })),
    issueEnhancements: completeIssueEnhancements(normalizedEnhancements, issues),
  };
}

function buildPrompt(evidencePack) {
  return [
    '请基于以下无障碍走查证据输出结构化 JSON。',
    '重点完成三件事：',
    '1. summary：输出产品级 AI 总结。verdict 用 1-2 句话概括：共发现多少问题、阻断/严重/一般/建议各多少、首要风险是什么、最高频问题是什么；keyFindings 只写 2 条判断，每条最多 60 个中文字符；recommendedNextSteps 写 2 条短建议即可。',
    '2. V1 语义复核：alt、链接文案、错误提示、图表说明、焦点顺序、状态反馈。',
    '3. V2 修复建议：为 evidencePack.issues 中的高优先级样本补充根因、用户影响、研发修复、UED 建议、示例代码、可复制 issue。',
    'summary 写作要求：',
    '- 可以复述总数和严重级别数量，但必须接上首要风险和最高频问题，不要只报数字。',
    '- 不要写“优先修复 Blocker/Major”“按规则来源和 selector 分派”“重新运行同一 URL”这类模板话。',
    '- 必须点名具体问题模式，例如：焦点不可见、颜色 token 对比度不足、图标按钮缺少名称、列表语义结构错误、状态反馈缺少 aria-live。',
    '- 对重复问题要判断是否应从组件库、设计变量或内容规范统一修复。',
    '- 对 UED/研发/内容的建议要说清楚各自要改什么，而不是只说负责人是谁。',
    'semanticFindings 必须按问题类型聚合，不要为同类元素重复输出多张卡片；可把多个 issueId 放进 relatedIssueIds。',
    'issueEnhancements 覆盖 evidencePack.issues 里的代表性问题即可，issueId 必须严格匹配；系统会为未覆盖问题补齐规则兜底建议。',
    '要求：证据不足时不要臆断，confidence 使用 high/medium/needs-review。',
    '',
    JSON.stringify(evidencePack, null, 2),
  ].join('\n');
}

function normalizeSummary(summary, issues = []) {
  const fallback = buildFallbackSummary(issues);
  const verdict = String(summary?.verdict || '').trim();
  const keyFindings = filterSummaryList(summary?.keyFindings);
  const recommendedNextSteps = filterSummaryList(summary?.recommendedNextSteps);

  return {
    verdict: verdict && !isLowValueSummaryText(verdict) ? verdict : fallback.verdict,
    riskLevel: String(summary?.riskLevel || fallback.riskLevel),
    keyFindings: keyFindings.length ? keyFindings.slice(0, 8) : fallback.keyFindings,
    recommendedNextSteps: recommendedNextSteps.length ? recommendedNextSteps.slice(0, 8) : fallback.recommendedNextSteps,
  };
}

function buildFallbackSummary(issues) {
  const bySeverity = countBy(issues, 'severity');
  const blocker = bySeverity.Blocker || 0;
  const major = bySeverity.Major || 0;
  const riskLevel = blocker ? 'high' : major ? 'medium' : issues.length ? 'low' : 'none';
  const groups = summarizeIssueGroups(issues);
  const topGroup = groups[0];
  const blockerGroup = groups.find((group) => group.severity === 'Blocker');
  const repeatedGroup = groups.find((group) => group.count >= 3);
  const verdict = buildInsightVerdict({ issues, topGroup, blockerGroup, repeatedGroup });
  const keyFindings = buildFallbackKeyFindings(groups);
  const recommendedNextSteps = buildFallbackNextSteps({ groups, blockerGroup, repeatedGroup });
  return { verdict, riskLevel, keyFindings, recommendedNextSteps };
}

function buildInsightVerdict({ issues, topGroup, blockerGroup, repeatedGroup }) {
  if (!issues.length) {
    return '自动化规则未发现明确失败项，当前更适合把验收重点放在真实键盘路径、读屏朗读顺序和关键业务任务的人工复核。';
  }

  if (blockerGroup) {
    return `首要风险不是数量，而是「${blockerGroup.title}」已经达到阻断级：受影响用户可能无法理解或完成关键控件操作，应作为发布前 gate 处理。`;
  }

  if (repeatedGroup) {
    return `问题呈现系统性重复，「${repeatedGroup.title}」集中出现 ${repeatedGroup.count} 处，优先从${repairLayerForGroup(repeatedGroup)}统一修，而不是逐条补丁式处理。`;
  }

  return `主要风险集中在「${topGroup?.title || '无障碍语义和交互'}」，更像是组件语义、状态设计或内容命名规则缺口，需要把修复沉到可复用层。`;
}

function buildFallbackKeyFindings(groups) {
  if (!groups.length) {
    return ['当前证据没有显示确定性失败项，但自动化无法覆盖真实读屏理解、业务语境和复杂流程可用性。'];
  }

  return groups
    .slice(0, 5)
    .map((group) => `${group.title}${group.count > 1 ? `集中出现 ${group.count} 处` : '出现'}：${diagnosisForGroup(group)}`);
}

function buildFallbackNextSteps({ groups, blockerGroup, repeatedGroup }) {
  if (!groups.length) {
    return [
      '用键盘完整走一遍核心任务，记录焦点顺序、可见焦点和是否能退出弹窗或复杂组件。',
      '抽样使用读屏器复核页面标题、控件名称、错误反馈和结果状态是否能被理解。',
    ];
  }

  const steps = [];
  if (blockerGroup) {
    steps.push(`先把「${blockerGroup.title}」做成发布阻断项，修到代表元素可被键盘或读屏器完成同等操作后再看其他问题。`);
  }
  if (repeatedGroup) {
    steps.push(`把「${repeatedGroup.title}」回溯到${repairLayerForGroup(repeatedGroup)}，一次修掉同类实例，并补设计/组件验收规则防止新增页面复发。`);
  }

  for (const group of groups) {
    if (steps.length >= 4) {
      break;
    }
    const step = nextStepForGroup(group);
    if (step && !steps.includes(step)) {
      steps.push(step);
    }
  }

  if (steps.length < 3) {
    steps.push('回归时不要只看问题数量下降，要抽样复核修复后的控件名称、焦点状态和视觉状态是否仍符合设计稿。');
  }
  return steps.slice(0, 5);
}

function summarizeIssueGroups(issues) {
  const grouped = new Map();
  for (const issue of issues) {
    const key = `${issue.title || ''}|${issue.ruleSource || ''}|${issue.tier || ''}`;
    const current = grouped.get(key) || {
      title: issue.title || '未命名问题',
      severity: issue.severity || 'Suggestion',
      tier: issue.tier || '',
      ruleSource: issue.ruleSource || '',
      owner: issue.owner || '',
      recommendation: issue.recommendation || '',
      count: 0,
      selectors: [],
    };
    current.count += 1;
    current.severity = higherSeverity(current.severity, issue.severity);
    current.owner = mergeOwner(current.owner, issue.owner);
    const selector = issue.evidence?.selector || issue.evidence?.target || '';
    if (selector && current.selectors.length < 3 && !current.selectors.includes(selector)) {
      current.selectors.push(selector);
    }
    grouped.set(key, current);
  }
  return Array.from(grouped.values())
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.count - a.count);
}

function mergeOwner(left = '', right = '') {
  const values = new Set([left, right].filter(Boolean).flatMap((item) => String(item).split(/\s*\+\s*/)));
  return Array.from(values).join(' + ');
}

function diagnosisForGroup(group) {
  const text = groupText(group);
  if (/contrast|对比度/i.test(text)) {
    return '这通常不是单个颜色写错，而是颜色 token、组件默认态或禁用态没有按 WCAG 对比度门槛校准。';
  }
  if (/focus|焦点/i.test(text)) {
    return '焦点可见性属于全局交互状态问题，常见根因是 outline 被重置、组件状态样式缺失或设计稿没有定义键盘态。';
  }
  if (/button-name|link-name|label|可访问名称|按钮缺少|链接/i.test(text)) {
    return '视觉上可识别的图标、链接或表单名称没有同步给辅助技术，说明控件命名规则没有进入组件 API。';
  }
  if (/target size|触控|可点击目标|尺寸/i.test(text)) {
    return '点击热区和视觉尺寸不一致，会在移动端、低视力和运动障碍场景下放大误触与无法命中的风险。';
  }
  if (/listitem|list|列表|aria-|role|语义|landmark|region/i.test(text)) {
    return 'DOM 结构语义和视觉结构脱节，通常需要修组件输出结构，而不是只调整样式。';
  }
  if (/status|toast|aria-live|状态/i.test(text)) {
    return '页面状态只通过视觉变化传达，读屏用户可能不知道操作是否成功、失败或仍在加载。';
  }
  if (/dialog|弹窗/i.test(text)) {
    return '弹窗语义和命名会直接影响读屏用户是否知道自己进入了模态任务区。';
  }
  if (/image|alt|图片/i.test(text)) {
    return '图片信息需要区分装饰图和信息图，问题往往来自内容规范而不只是前端属性缺失。';
  }
  return `应结合 ${group.ruleSource || group.tier || '规则证据'} 判断它是组件层缺陷还是页面内容缺陷。`;
}

function nextStepForGroup(group) {
  const text = groupText(group);
  if (/contrast|对比度/i.test(text)) {
    return 'UED 先校准颜色变量和组件状态色，研发再替换页面硬编码色值，避免同类对比度问题在多个页面重复出现。';
  }
  if (/focus|焦点/i.test(text)) {
    return '研发恢复或补齐全局 focus-visible 样式，UED 明确键盘态视觉规格，QA 用 Tab 路径验收焦点是否始终可见。';
  }
  if (/button-name|link-name|label|可访问名称|按钮缺少|链接/i.test(text)) {
    return '把图标按钮、泛化链接和表单控件的可访问名称做成组件必填项，内容侧提供具体对象和动作名称。';
  }
  if (/target size|触控|可点击目标|尺寸/i.test(text)) {
    return '优先扩大可点击热区而不只放大图标，移动端验收用最小 24px 触控目标和相邻间距做准入。';
  }
  if (/listitem|list|列表|aria-|role|语义|landmark|region/i.test(text)) {
    return '从组件模板修正 DOM 结构和 ARIA 角色，确保视觉列表、导航区和内容区在辅助技术里也有一致结构。';
  }
  if (/status|toast|aria-live|状态/i.test(text)) {
    return '把 toast、loading、成功和错误反馈接入 role=status 或 aria-live，并明确哪些反馈需要打断式 alert。';
  }
  if (/dialog|弹窗/i.test(text)) {
    return '统一弹窗组件的 role、aria-modal、标题关联和焦点管理，避免每个业务弹窗重复补语义。';
  }
  return group.recommendation || '';
}

function repairLayerForGroup(group) {
  const text = groupText(group);
  if (/contrast|对比度/i.test(text)) {
    return '设计变量和组件状态色';
  }
  if (/focus|焦点|target size|触控|可点击目标|尺寸/i.test(text)) {
    return '组件交互状态规范';
  }
  if (/button-name|link-name|label|可访问名称|按钮缺少|链接|image|alt|图片/i.test(text)) {
    return '组件 API 和内容命名规范';
  }
  if (/listitem|list|列表|aria-|role|语义|landmark|region|dialog|弹窗|status|toast|aria-live/i.test(text)) {
    return '组件语义模板';
  }
  return '组件库或页面模板';
}

function groupText(group) {
  return `${group.title || ''} ${group.ruleSource || ''} ${group.recommendation || ''}`;
}

function filterSummaryList(items) {
  return toStringList(items).filter((item) => !isLowValueSummaryText(item));
}

function isLowValueSummaryText(text) {
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

function completeSemanticFindings(findings, issues) {
  if (findings.length) {
    return findings;
  }
  const semanticIssues = issues
    .filter((issue) => issue.tier === 'AI辅助判断' || issue.tier === '人工确认');
  const groups = groupSemanticIssues(semanticIssues);
  return groups
    .slice(0, 8)
    .map((group, index) => ({
      id: `AI-FALLBACK-${index + 1}`,
      title: group.title,
      category: group.category,
      severity: group.severity,
      selector: group.selectors.join(', '),
      reason: group.reason,
      evidence: group.selectors.length
        ? `共 ${group.count} 个相关元素，代表元素：${group.selectors.join(', ')}`
        : `共 ${group.count} 个关联问题`,
      recommendation: group.recommendation,
      confidence: 'needs-review',
      relatedIssueIds: group.issueIds,
    }));
}

function groupSemanticIssues(issues) {
  const grouped = new Map();
  for (const issue of issues) {
    const key = `${issue.tier}|${issue.title}|${issue.recommendation}`;
    const current = grouped.get(key) || {
      title: issue.title,
      category: issue.tier,
      severity: issue.severity,
      reason: issue.impactUsers,
      recommendation: issue.recommendation,
      count: 0,
      selectors: [],
      issueIds: [],
    };
    current.count += 1;
    const selector = issue.evidence?.selector || issue.evidence?.target || '';
    if (selector && current.selectors.length < 5 && !current.selectors.includes(selector)) {
      current.selectors.push(selector);
    }
    if (current.issueIds.length < 12) {
      current.issueIds.push(issue.id);
    }
    current.severity = higherSeverity(current.severity, issue.severity);
    grouped.set(key, current);
  }
  return Array.from(grouped.values()).sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.count - a.count);
}

function dedupeSemanticFindings(findings) {
  const grouped = new Map();
  for (const finding of findings) {
    const key = `${finding.category || ''}|${finding.title || ''}|${finding.recommendation || ''}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        ...finding,
        relatedIssueIds: Array.isArray(finding.relatedIssueIds) ? [...finding.relatedIssueIds] : [],
      });
      continue;
    }
    const selector = finding.selector || '';
    if (selector && !String(current.selector || '').includes(selector)) {
      current.selector = [current.selector, selector].filter(Boolean).join(', ');
    }
    const ids = new Set([...(current.relatedIssueIds || []), ...(Array.isArray(finding.relatedIssueIds) ? finding.relatedIssueIds : [])].map(String));
    current.relatedIssueIds = Array.from(ids).slice(0, 12);
    current.severity = higherSeverity(current.severity, finding.severity);
  }
  return Array.from(grouped.values());
}

function completeIssueEnhancements(enhancements, issues) {
  const byIssueId = new Map(enhancements.filter((item) => item.issueId).map((item) => [item.issueId, item]));
  return issues.map((issue) => {
    const current = byIssueId.get(issue.id);
    const fallback = buildFallbackIssueEnhancement(issue);
    return {
      ...fallback,
      ...Object.fromEntries(Object.entries(current || {}).filter(([, value]) => value !== '')),
      issueId: issue.id,
    };
  });
}

function normalizeIssueEnhancement(item) {
  return {
    issueId: String(item.issueId || ''),
    rootCause: String(item.rootCause || ''),
    userImpact: String(item.userImpact || ''),
    developerFix: String(item.developerFix || ''),
    uedFix: String(item.uedFix || ''),
    codeExample: String(item.codeExample || ''),
    copyableIssue: String(item.copyableIssue || ''),
    confidence: String(item.confidence || 'needs-review'),
  };
}

function buildFallbackIssueEnhancement(issue) {
  const selector = issue.evidence?.selector || issue.evidence?.target || '';
  const codeExample = codeExampleForIssue(issue);
  return {
    issueId: issue.id,
    rootCause: `该问题由 ${issue.ruleSource || issue.tier} 发现，通常来自页面语义、结构、样式或交互状态与无障碍规则不一致。`,
    userImpact: issue.impactUsers || '辅助技术用户、键盘用户或低视力用户可能受到影响。',
    developerFix: issue.recommendation || '根据规则来源和证据定位元素，补充语义、可访问名称、状态关联或样式修复。',
    uedFix: ownerNeedsUed(issue.owner) ? '复核该控件的文案、视觉状态、信息层级和交互反馈，确保设计稿中有明确无障碍要求。' : '确认修复后视觉和交互仍符合设计系统要求。',
    codeExample,
    copyableIssue: renderFallbackIssueCopy(issue, selector),
    confidence: issue.confidence || 'medium',
  };
}

function codeExampleForIssue(issue) {
  const text = `${issue.title} ${issue.ruleSource}`.toLowerCase();
  if (text.includes('button') || issue.title.includes('按钮')) {
    return '<button aria-label="明确的按钮用途">...</button>';
  }
  if (text.includes('link') || issue.title.includes('链接')) {
    return '<a href="/target" aria-label="查看具体对象详情">查看具体对象详情</a>';
  }
  if (text.includes('image') || issue.title.includes('图片')) {
    return '<img src="..." alt="描述图片传达的信息" />';
  }
  if (text.includes('label') || issue.title.includes('标签')) {
    return '<label for="email">邮箱</label><input id="email" name="email" />';
  }
  if (text.includes('lang') || issue.title.includes('语言')) {
    return '<html lang="zh-CN">';
  }
  if (text.includes('dialog') || issue.title.includes('弹窗')) {
    return '<div role="dialog" aria-modal="true" aria-labelledby="dialog-title">...</div>';
  }
  if (text.includes('status') || text.includes('toast') || issue.title.includes('状态')) {
    return '<div role="status" aria-live="polite">保存成功</div>';
  }
  if (text.includes('contrast') || issue.title.includes('对比度')) {
    return '/* 调整颜色变量，使普通文字对比度 >= 4.5:1，大号文字 >= 3:1 */';
  }
  return '';
}

function renderFallbackIssueCopy(issue, selector) {
  return [
    `标题：${issue.title}`,
    `严重级别：${issue.severity}`,
    `规则来源：${issue.ruleSource}`,
    selector ? `定位元素：${selector}` : '',
    `影响用户：${issue.impactUsers}`,
    `修复建议：${issue.recommendation}`,
  ].filter(Boolean).join('\n');
}

function ownerNeedsUed(owner) {
  return /UED|内容|设计/.test(owner || '');
}

function countBy(items, key) {
  return items.reduce((result, item) => {
    const value = item[key] || '未分类';
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

function higherSeverity(left, right) {
  return severityRank(right) > severityRank(left) ? right : left;
}

function severityRank(severity) {
  return {
    Suggestion: 1,
    Minor: 2,
    Major: 3,
    Blocker: 4,
  }[severity] || 0;
}

function normalizeSeverity(value) {
  const text = String(value || 'Suggestion');
  return ['Blocker', 'Major', 'Minor', 'Suggestion'].includes(text) ? text : 'Suggestion';
}

function toStringList(value) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function extractResponseText(json) {
  if (typeof json?.output_text === 'string') {
    return json.output_text;
  }
  const output = Array.isArray(json?.output) ? json.output : [];
  const text = output.flatMap((item) => item?.content || [])
    .map((part) => part?.text || '')
    .join('');
  if (text) {
    return text;
  }
  return json?.choices?.[0]?.message?.content || '';
}

function parseJsonText(text) {
  const cleaned = String(text)
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

function sanitizeError(error) {
  if (error?.name === 'AbortError') {
    return 'AI request timed out.';
  }
  return truncate(error?.message || String(error), 500);
}

function isRetryableAiError(error) {
  if (error?.name === 'AbortError') {
    return true;
  }
  if ([429, 500, 502, 503, 504].includes(Number(error?.status))) {
    return true;
  }
  const message = String(error?.message || '').toLowerCase();
  return /timed out|high demand|temporar|try again|rate limit|overloaded/.test(message);
}

function retryDelayForAttempt(attempt, baseDelayMs) {
  const delay = Number(baseDelayMs) || 0;
  if (!delay) {
    return 0;
  }
  return Math.min(delay * (2 ** Math.max(0, attempt - 1)), 5000);
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function modelsFromEnv(value) {
  if (!value) {
    return null;
  }
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function uniqueModels(models) {
  return Array.from(new Set((models || []).filter(Boolean)));
}

function truncate(value, max = 500) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}
