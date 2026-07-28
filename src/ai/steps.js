import { DEFAULT_AI_BASE_URL, DEFAULT_AI_MODEL, FALLBACK_AI_MODELS } from './model.js';

const DEFAULT_STEP_TIMEOUT_MS = 45000;

const STEP_SYSTEM_INSTRUCTION = `
你是 Web QA 自动化步骤生成器。你只把自然语言任务转换成 Playwright 可执行步骤，不做无障碍走查结论。
输出必须是 JSON，不要输出 Markdown。
步骤只能使用 action: fill, hover, click, press, waitForSelector, wait。
尽量为 hover/click/fill/waitForSelector 提供 selectors 候选数组，并补充 label、role、name 或 text 作为回退。
不要发明账号、密码、验证码或业务数据；如果自然语言没有提供输入值，就不要生成对应 fill 步骤。
`.trim();

const STEP_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    task: { type: 'string' },
    confidence: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          selector: { type: 'string' },
          selectors: { type: 'array', items: { type: 'string' } },
          value: { type: 'string' },
          key: { type: 'string' },
          role: { type: 'string' },
          name: { type: 'string' },
          label: { type: 'string' },
          text: { type: 'string' },
          ms: { type: 'number' },
          timeout: { type: 'number' },
          description: { type: 'string' },
        },
        required: ['action'],
      },
    },
  },
  required: ['task', 'confidence', 'assumptions', 'steps'],
};

const CONTROL_WORDS = [
  '登录',
  '提交',
  '保存',
  '确认',
  '确定',
  '取消',
  '关闭',
  '新增',
  '添加',
  '创建',
  '编辑',
  '删除',
  '搜索',
  '查询',
  '下一步',
  '继续',
  '打开',
];

export async function generateScenarioSteps(input = {}, options = {}) {
  const instruction = String(input.instruction || '').trim();
  if (!instruction) {
    return emptyStepPlan();
  }

  const localPlan = buildLocalStepPlan(instruction);
  const apiKey = options.apiKey || process.env.AI_API_KEY;
  if (!options.enabled || !apiKey) {
    return localPlan;
  }

  try {
    const aiPlan = await requestAiStepPlan({
      apiKey,
      baseUrl: options.baseUrl || process.env.AI_BASE_URL || DEFAULT_AI_BASE_URL,
      model: options.model || process.env.AI_MODEL || DEFAULT_AI_MODEL,
      instruction,
      target: input.target || {},
      localPlan,
      fetchImpl: options.fetchImpl || fetch,
      timeoutMs: options.timeoutMs || DEFAULT_STEP_TIMEOUT_MS,
    });
    const normalized = normalizeStepPlan(aiPlan, instruction, 'openai-compatible');
    return normalized.steps.length ? normalized : localPlan;
  } catch (error) {
    return {
      ...localPlan,
      provider: 'local-fallback',
      warnings: [
        ...(localPlan.warnings || []),
        `AI 步骤生成失败，已使用本地规则解析：${sanitizeError(error)}`,
      ],
    };
  }
}

export function buildLocalStepPlan(instruction) {
  const text = normalizeWhitespace(instruction);
  const segments = splitInstruction(text);
  const steps = [];

  for (const segment of segments) {
    steps.push(...stepsFromSegment(segment));
  }

  const normalized = normalizeStepPlan({
    task: text,
    confidence: steps.length ? 'medium' : 'low',
    assumptions: buildLocalAssumptions(steps),
    steps,
  }, text, 'local-rules');

  return {
    ...normalized,
    warnings: normalized.steps.length ? [] : ['没有从任务描述中识别到可执行操作；走查会直接检测目标页面。'],
  };
}

export function normalizeStepPlan(plan, fallbackTask = '', provider = 'local-rules') {
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  return {
    provider,
    task: String(plan?.task || fallbackTask || '').trim(),
    confidence: normalizeConfidence(plan?.confidence),
    assumptions: arrayOfStrings(plan?.assumptions).slice(0, 8),
    warnings: arrayOfStrings(plan?.warnings).slice(0, 8),
    steps: steps.map(normalizeGeneratedStep).filter(Boolean).slice(0, 30),
  };
}

function emptyStepPlan() {
  return {
    provider: 'local-rules',
    task: '',
    confidence: 'low',
    assumptions: [],
    warnings: [],
    steps: [],
  };
}

async function requestAiStepPlan({
  apiKey,
  baseUrl,
  model,
  instruction,
  target,
  localPlan,
  fetchImpl,
  timeoutMs,
}) {
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
        instructions: STEP_SYSTEM_INSTRUCTION,
        input: buildStepPrompt({ instruction, target, localPlan }),
        temperature: 0.1,
      }),
    });

    const json = await response.json().catch(async () => ({
      rawText: await response.text().catch(() => ''),
    }));

    if (!response.ok) {
      const error = new Error(`AI step generation failed: ${response.status} ${response.statusText} ${truncate(JSON.stringify(json), 300)}`);
      error.status = response.status;
      throw error;
    }

    const text = extractResponseText(json);
    if (!text) {
      throw new Error('AI response did not include output text.');
    }
    return parseJsonText(text);
  } catch (error) {
    if (FALLBACK_AI_MODELS.length && !FALLBACK_AI_MODELS.includes(model)) {
      const fallbackModel = FALLBACK_AI_MODELS[0];
      return requestAiStepPlan({
        apiKey,
        baseUrl,
        model: fallbackModel,
        instruction,
        target,
        localPlan,
        fetchImpl,
        timeoutMs,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildStepPrompt({ instruction, target, localPlan }) {
  return [
    '请把下面的页面任务转换为自动化步骤。',
    '目标页面信息：',
    JSON.stringify({
      url: target.url || '',
      name: target.name || '',
      notes: target.notes || '',
    }, null, 2),
    '任务描述：',
    instruction,
    '本地规则初稿，可参考但不必照抄：',
    JSON.stringify(localPlan, null, 2),
    '输出字段要求：',
    '- steps 中每步都写 description，方便 QA 复核。',
    '- hover 用于“悬停、hover、鼠标移入、鼠标放到”等任务；下拉菜单通常先 hover 再 waitForSelector 再 click。',
    '- click 优先给 role/name，例如 role=button name=登录；同时给常见 selectors。',
    '- fill 如果能判断字段名，给 label 和 selectors；value 必须来自任务描述。',
    '- 等待 toast、结果、弹窗时使用 waitForSelector，并给 status/dialog/toast 等候选 selectors。',
  ].join('\n');
}

function stepsFromSegment(segment) {
  const value = segment.trim();
  if (!value) {
    return [];
  }

  const waitMs = parseWaitMs(value);
  if (waitMs) {
    return [{ action: 'wait', ms: waitMs, description: `等待 ${waitMs}ms` }];
  }

  const key = parseKey(value);
  if (key) {
    return [{ action: 'press', key, description: `按 ${key}` }];
  }

  const fills = parseFillSteps(value);
  if (fills.length) {
    return fills;
  }

  const hoverName = parseHoverName(value);
  if (hoverName) {
    return [buildHoverStep(hoverName, value)];
  }

  if (/等待|出现|看到|显示|toast|提示|弹窗|dialog|结果|成功|失败|报错|错误|loading|加载/i.test(value)) {
    return [buildWaitForStep(value)];
  }

  const clickName = parseClickName(value);
  if (clickName) {
    return [buildClickStep(clickName, value)];
  }

  return [];
}

function parseFillSteps(segment) {
  const pairs = [];
  const quotedPairs = matchAll(segment, /(?:在|向)?\s*([^，。；;、]+?)\s*(?:输入|填写|填入|录入)\s*["“']([^"”']+)["”']/gi);
  for (const match of quotedPairs) {
    pairs.push({ field: cleanFieldName(match[1]), value: match[2] });
  }

  const reversePairs = matchAll(segment, /(?:输入|填写|填入|录入)\s*["“']([^"”']+)["”']\s*(?:到|至|在)?\s*([^，。；;、]+)/gi);
  for (const match of reversePairs) {
    pairs.push({ field: cleanFieldName(match[2]), value: match[1] });
  }

  const colonPairs = matchAll(segment, /([^，。；;、:=：]{1,24})[:：=]\s*([^，。；;、]+)/g);
  for (const match of colonPairs) {
    if (/https?:|file:/i.test(match[0])) {
      continue;
    }
    pairs.push({ field: cleanFieldName(match[1]), value: trimQuotes(match[2]) });
  }

  if (!pairs.length) {
    pairs.push(...parseInlineFillPairs(segment));
  }

  return dedupeFillPairs(pairs)
    .filter((pair) => pair.field && pair.value)
    .map((pair) => buildFillStep(pair.field, pair.value));
}

function parseInlineFillPairs(segment) {
  const body = segment.replace(/^(?:输入|填写|填入|录入)\s*/, '').trim();
  if (!body || body === segment) {
    return [];
  }

  return body
    .split(/\s*(?:和|与|及|以及|、|，|,)\s*/g)
    .map((part) => {
      const match = part.match(/^([^\s"'“”]{1,24})\s+(.+)$/);
      if (!match) {
        return null;
      }
      return {
        field: cleanFieldName(match[1]),
        value: trimQuotes(match[2]),
      };
    })
    .filter(Boolean);
}

function buildFillStep(field, value) {
  return {
    action: 'fill',
    selector: selectorsForField(field)[0],
    selectors: selectorsForField(field),
    label: field,
    value,
    description: `填写${field}`,
  };
}

function buildClickStep(name, segment) {
  return {
    action: 'click',
    selector: selectorsForControl(name)[0],
    selectors: selectorsForControl(name),
    role: 'button',
    name,
    text: name,
    description: segment.includes(name) ? segment : `点击${name}`,
  };
}

function buildHoverStep(name, segment) {
  return {
    action: 'hover',
    selector: selectorsForControl(name)[0],
    selectors: selectorsForControl(name),
    role: 'button',
    name,
    text: name,
    description: segment.includes(name) ? segment : `悬停${name}`,
  };
}

function buildWaitForStep(segment) {
  const isDialog = /弹窗|dialog|抽屉|modal/i.test(segment);
  const isStatus = /toast|提示|成功|失败|报错|错误|状态|loading|加载|结果/i.test(segment);
  let selectors = isDialog
    ? ['[role="dialog"]', '[role="alertdialog"]', '.modal', '.dialog', '.drawer']
    : isStatus
      ? ['[role="status"]', '[role="alert"]', '[aria-live]', '.toast', '.snackbar', '.message', '.notification', '.loading', '.error']
      : ['body'];
  if (/toast/i.test(segment)) {
    selectors = ['.toast', '[role="status"]', '[role="alert"]', '[aria-live]', '.snackbar', '.message', '.notification'];
  }

  return {
    action: 'waitForSelector',
    selector: selectors[0],
    selectors,
    timeout: 5000,
    description: segment,
  };
}

function selectorsForField(field) {
  const normalized = field.toLowerCase();
  const selectors = [];

  if (/#|\.|\[/.test(field)) {
    selectors.push(field);
  }
  if (/邮箱|email|账号|账户|用户名|user|login/.test(normalized)) {
    selectors.push('#email', '#user', '#username', 'input[id*="email" i]', 'input[id*="user" i]', 'input[type="email"]', 'input[name*="email" i]', 'input[name*="user" i]');
  } else if (/密码|password|pass/.test(normalized)) {
    selectors.push('#password', 'input[id*="password" i]', 'input[type="password"]', 'input[name*="password" i]');
  } else if (/搜索|关键字|关键词|query|search/.test(normalized)) {
    selectors.push('input[type="search"]', 'input[name*="search" i]', 'input[id*="search" i]', 'input[placeholder*="搜索"]');
  }

  selectors.push(
    `[aria-label*="${escapeSelectorText(field)}"]`,
    `[placeholder*="${escapeSelectorText(field)}"]`,
    `input[name*="${escapeSelectorText(field)}" i]`,
    `input[id*="${escapeSelectorText(field)}" i]`,
    `textarea[name*="${escapeSelectorText(field)}" i]`,
  );

  return unique(selectors).slice(0, 8);
}

function selectorsForControl(name) {
  const escaped = escapeSelectorText(name);
  const selectors = [];
  if (/#|\.|\[/.test(name)) {
    selectors.push(name);
  }
  selectors.push(
    `button:has-text("${escaped}")`,
    `[role="button"]:has-text("${escaped}")`,
    `a:has-text("${escaped}")`,
    `input[type="submit"][value*="${escaped}" i]`,
    `input[type="button"][value*="${escaped}" i]`,
    `[aria-label*="${escaped}"]`,
  );
  return unique(selectors).slice(0, 8);
}

function parseClickName(segment) {
  const quoted = matchAll(segment, /["“']([^"”']+)["”']/g).map((match) => cleanControlName(match[1])).filter(Boolean);
  if (quoted.length && /(?:点击|单击|点|打开|选择|进入|提交|保存|确认|关闭)/i.test(segment)) {
    return quoted[quoted.length - 1];
  }

  const direct = segment.match(/(?:点击|单击|点|打开|选择|进入|提交|保存|确认|关闭)\s*["“']?([^"”'，。；;、]+)["”']?/i);
  if (direct) {
    const name = cleanControlName(direct[1]);
    return name || directVerbName(segment);
  }
  return directVerbName(segment);
}

function parseHoverName(segment) {
  if (!/(?:hover|悬停|鼠标(?:移入|移到|移动到|放到|停在)|移入|移到)/i.test(segment)) {
    return '';
  }

  const quoted = matchAll(segment, /["“']([^"”']+)["”']/g).map((match) => cleanControlName(match[1])).filter(Boolean);
  if (quoted.length) {
    return quoted[quoted.length - 1];
  }

  const direct = segment.match(/(?:hover|悬停|鼠标(?:移入|移到|移动到|放到|停在)|移入|移到)(?:在|到|至)?\s*([^，。；;、]+?)(?:菜单|导航|栏目|入口|按钮|链接)?$/i);
  if (direct) {
    return cleanControlName(direct[1]);
  }

  return '';
}

function directVerbName(segment) {
  for (const word of CONTROL_WORDS) {
    if (segment.includes(word)) {
      return word;
    }
  }
  return '';
}

function parseWaitMs(segment) {
  const match = segment.match(/(?:等待|等)\s*(\d+(?:\.\d+)?)\s*(毫秒|ms|秒|s)?/i);
  if (!match) {
    return 0;
  }
  const amount = Number(match[1]);
  const unit = String(match[2] || '秒').toLowerCase();
  return Math.round(unit === '毫秒' || unit === 'ms' ? amount : amount * 1000);
}

function parseKey(segment) {
  const match = segment.match(/(?:按|键入)\s*(Enter|Tab|Escape|Esc|Space|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)/i);
  if (!match) {
    return '';
  }
  return match[1].toLowerCase() === 'esc' ? 'Escape' : normalizeKeyName(match[1]);
}

function normalizeKeyName(key) {
  const lower = String(key).toLowerCase();
  return {
    enter: 'Enter',
    tab: 'Tab',
    escape: 'Escape',
    space: 'Space',
    backspace: 'Backspace',
    delete: 'Delete',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
  }[lower] || key;
}

function splitInstruction(text) {
  return normalizeWhitespace(text)
    .replace(/[，,]\s*(?=(然后|接着|再|之后|随后|等待|点击|单击|打开|按|输入|填写|填入|录入|提交|保存|确认|关闭))/g, '\n')
    .split(/\n|(?:然后|接着|再|之后|随后)|[。；;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeGeneratedStep(step) {
  if (!step || typeof step !== 'object') {
    return null;
  }
  const action = String(step.action || '').trim();
  if (!['fill', 'hover', 'click', 'press', 'waitForSelector', 'wait'].includes(action)) {
    return null;
  }
  const selectors = unique([
    step.selector,
    ...arrayOfStrings(step.selectors),
  ].filter(Boolean)).slice(0, 10);
  const normalized = {
    action,
    description: truncate(step.description || descriptionForStep(step), 120),
  };

  if (selectors.length) {
    normalized.selector = selectors[0];
    normalized.selectors = selectors;
  }
  if (step.value !== undefined) {
    normalized.value = String(step.value);
  }
  if (step.key) {
    normalized.key = normalizeKeyName(step.key);
  }
  if (step.role) {
    normalized.role = String(step.role);
  }
  if (step.name) {
    normalized.name = String(step.name);
  }
  if (step.label) {
    normalized.label = String(step.label);
  }
  if (step.text) {
    normalized.text = String(step.text);
  }
  if (step.ms !== undefined) {
    normalized.ms = Math.max(0, Number(step.ms) || 0);
  }
  if (step.timeout !== undefined) {
    normalized.timeout = Math.max(100, Number(step.timeout) || 5000);
  }
  return normalized;
}

function descriptionForStep(step) {
  if (step.description) {
    return step.description;
  }
  if (step.action === 'fill') {
    return `填写${step.label || step.selector || '字段'}`;
  }
  if (step.action === 'click') {
    return `点击${step.name || step.text || step.selector || '控件'}`;
  }
  if (step.action === 'hover') {
    return `悬停${step.name || step.text || step.selector || '控件'}`;
  }
  if (step.action === 'press') {
    return `按 ${step.key || 'Enter'}`;
  }
  if (step.action === 'wait') {
    return `等待 ${step.ms || 1000}ms`;
  }
  return `等待${step.selector || '元素'}`;
}

function buildLocalAssumptions(steps) {
  if (!steps.length) {
    return [];
  }
  return [
    '本地规则会按字段名、按钮文本、ARIA 名称和常见 CSS 类名生成候选定位方式。',
    '如果页面使用非标准文案或控件封装，建议在高级步骤里微调选择器。',
  ];
}

function dedupeFillPairs(pairs) {
  const seen = new Set();
  return pairs.filter((pair) => {
    const key = `${pair.field}|${pair.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function cleanFieldName(value) {
  return normalizeWhitespace(value)
    .replace(/^(在|向|给|把|将|字段|输入框|表单项)/, '')
    .replace(/(输入框|字段|里|中|内)$/g, '')
    .trim();
}

function cleanControlName(value) {
  return normalizeWhitespace(value)
    .replace(/^(按钮|链接|菜单|入口|控件)/, '')
    .replace(/(按钮|链接|菜单|入口|控件)$/g, '')
    .trim();
}

function trimQuotes(value) {
  return normalizeWhitespace(value).replace(/^["“']|["”']$/g, '');
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeSelectorText(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').trim();
}

function normalizeConfidence(value) {
  const confidence = String(value || '').toLowerCase();
  if (['high', 'medium', 'low', 'needs-review'].includes(confidence)) {
    return confidence;
  }
  return 'medium';
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function matchAll(text, pattern) {
  return Array.from(text.matchAll(pattern));
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
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
  return truncate(error?.message || String(error), 300);
}

function truncate(value, max = 500) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}
