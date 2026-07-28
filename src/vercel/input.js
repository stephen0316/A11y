import { generateScenarioSteps } from '../ai/steps.js';

export async function normalizeVercelAuditPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Request body must be JSON.');
  }
  if (!payload.url) {
    throw new Error('url is required.');
  }

  const parsedUrl = new URL(payload.url);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Vercel deployment only supports http and https target URLs.');
  }

  const target = {
    url: parsedUrl.href,
    name: String(payload.name || payload.url),
    notes: String(payload.notes || ''),
  };
  const stepPlan = await resolveStepPlan(payload, target);
  return {
    ...target,
    task: stepPlan.task,
    stepPlan,
    steps: normalizeSteps(stepPlan.steps),
  };
}

export async function generateVercelSteps(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Request body must be JSON.');
  }
  return generateScenarioSteps({
    instruction: String(payload.task || payload.stepPrompt || '').trim(),
    target: {
      url: normalizeOptionalUrl(payload.url),
      name: String(payload.name || payload.url || ''),
      notes: String(payload.notes || ''),
    },
  }, {
    enabled: normalizeAiOptions(payload.ai).enabled,
  });
}

export function normalizeAiOptions(ai) {
  if (ai && typeof ai === 'object' && typeof ai.enabled === 'boolean') {
    return { enabled: ai.enabled };
  }
  return { enabled: Boolean(process.env.AI_API_KEY) };
}

export function parseViewport(value) {
  if (!value) {
    return { width: 1440, height: 1000 };
  }
  if (typeof value === 'object') {
    return {
      width: Number(value.width || 1440),
      height: Number(value.height || 1000),
    };
  }
  const match = String(value).match(/^(\d+)x(\d+)$/);
  if (!match) {
    throw new Error('viewport must use WIDTHxHEIGHT.');
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function resolveStepPlan(payload, target) {
  const manualSteps = normalizeSteps(payload.steps);
  const task = String(payload.task || payload.stepPrompt || '').trim();
  if (!task) {
    return {
      provider: 'manual',
      task: '',
      confidence: manualSteps.length ? 'high' : 'low',
      assumptions: [],
      warnings: [],
      steps: manualSteps,
    };
  }
  const generated = await generateScenarioSteps({ instruction: task, target }, {
    enabled: normalizeAiOptions(payload.ai).enabled,
  });
  return {
    ...generated,
    steps: manualSteps.length ? manualSteps : generated.steps,
    manualOverride: manualSteps.length > 0,
  };
}

function normalizeOptionalUrl(value) {
  if (!value) {
    return '';
  }
  try {
    return new URL(value).href;
  } catch {
    return String(value);
  }
}

function normalizeSteps(steps) {
  if (!steps) {
    return [];
  }
  if (!Array.isArray(steps)) {
    throw new Error('steps must be an array.');
  }
  const allowedActions = new Set(['fill', 'hover', 'click', 'press', 'waitForSelector', 'wait']);
  return steps.map((step, index) => {
    if (!step || typeof step !== 'object') {
      throw new Error(`steps[${index}] must be an object.`);
    }
    if (!allowedActions.has(step.action)) {
      throw new Error(`Unsupported step action: ${step.action}`);
    }
    return step;
  });
}
