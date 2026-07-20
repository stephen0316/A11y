import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditTargets } from './index.js';
import { generateScenarioSteps } from './ai/steps.js';
import { renderMarkdownReport } from './report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const REPORTS_DIR = path.join(ROOT_DIR, 'reports');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ALLOWED_ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    setCorsHeaders(request, response);

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/audit') {
      await handleAudit(request, response);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/steps') {
      await handleGenerateSteps(request, response);
      return;
    }

    if (request.method === 'GET') {
      const staticPath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      if (await serveFileIfExists(response, DIST_DIR, staticPath)) {
        return;
      }
      if ((staticPath === 'history.html' || !path.extname(staticPath)) && await serveFileIfExists(response, DIST_DIR, 'index.html')) {
        return;
      }
      await serveFile(response, PUBLIC_DIR, staticPath);
      return;
    }

    sendJson(response, 405, { error: 'Method not allowed' });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, {
      error: error.message || 'Internal server error',
    });
  }
});

server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`无障碍走查服务: http://${displayHost}:${PORT}`);
});

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return;
  }
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type');
  response.setHeader('vary', 'Origin');
}

async function handleAudit(request, response) {
  const payload = await readJsonBody(request);
  const target = await normalizeAuditPayload(payload);

  const result = await auditTargets([target], {
    outDir: REPORTS_DIR,
    maxTabs: Number(payload.maxTabs || 30),
    viewport: parseViewport(payload.viewport),
    headful: Boolean(payload.headful),
    ai: normalizeAiOptions(payload.ai),
  });

  const report = result.reports[0];
  const audit = JSON.parse(await readFile(report.jsonPath, 'utf8'));

  sendJson(response, 200, {
    ok: true,
    report: {
      id: path.basename(path.dirname(report.reportPath)),
      target: report.target,
      audit: toBrowserAudit(audit),
      markdown: renderMarkdownReport(audit),
      artifacts: await readBrowserArtifacts(report, audit),
    },
  });
}

function toBrowserAudit(audit) {
  return {
    meta: audit.meta,
    summary: audit.summary,
    ai: audit.ai,
    issues: audit.issues,
  };
}

async function readBrowserArtifacts(report, audit) {
  const artifactNames = audit.meta?.artifacts || {};
  const artifactDirectory = path.dirname(report.screenshotPath);
  const flowScreenshots = await Promise.all(
    (artifactNames.flowScreenshots || []).map(async (item) => ({
      index: item.index,
      name: path.basename(item.screenshot),
      dataUrl: await readImageDataUrl(path.join(artifactDirectory, path.basename(item.screenshot))),
    })),
  );

  return {
    screenshot: {
      name: artifactNames.screenshot || 'screenshot.png',
      dataUrl: await readImageDataUrl(report.screenshotPath),
    },
    flowScreenshots,
    domSnapshot: {
      name: artifactNames.domSnapshot || 'dom-snapshot.html',
      content: await readFile(path.join(artifactDirectory, path.basename(artifactNames.domSnapshot || 'dom-snapshot.html')), 'utf8'),
    },
    accessibilityTree: {
      name: artifactNames.accessibilityTree || 'accessibility-tree.json',
      content: await readFile(path.join(artifactDirectory, path.basename(artifactNames.accessibilityTree || 'accessibility-tree.json')), 'utf8'),
    },
  };
}

async function readImageDataUrl(filePath) {
  const image = await readFile(filePath);
  return `data:image/png;base64,${image.toString('base64')}`;
}

async function handleGenerateSteps(request, response) {
  const payload = await readJsonBody(request);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Request body must be JSON.');
  }
  const task = String(payload.task || payload.stepPrompt || '').trim();
  const plan = await generateScenarioSteps({
    instruction: task,
    target: {
      url: normalizeOptionalUrl(payload.url),
      name: String(payload.name || payload.url || ''),
      notes: String(payload.notes || ''),
    },
  }, {
    enabled: normalizeAiOptions(payload.ai).enabled,
  });
  sendJson(response, 200, { ok: true, plan });
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

async function normalizeAuditPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Request body must be JSON.');
  }

  if (!payload.url) {
    throw new Error('url is required.');
  }

  const parsedUrl = new URL(payload.url);
  if (!['http:', 'https:', 'file:'].includes(parsedUrl.protocol)) {
    throw new Error('url must use http, https, or file protocol.');
  }

  const stepPlan = await resolveStepPlan(payload, {
    url: parsedUrl.href,
    name: String(payload.name || payload.url),
    notes: String(payload.notes || ''),
  });

  return {
    url: parsedUrl.href,
    name: String(payload.name || payload.url),
    notes: String(payload.notes || ''),
    task: stepPlan.task,
    stepPlan,
    steps: normalizeSteps(stepPlan.steps),
  };
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

  const generated = await generateScenarioSteps({
    instruction: task,
    target,
  }, {
    enabled: normalizeAiOptions(payload.ai).enabled,
  });

  return {
    ...generated,
    steps: manualSteps.length ? manualSteps : generated.steps,
    manualOverride: manualSteps.length > 0,
  };
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

function normalizeAiOptions(ai) {
  if (ai && typeof ai === 'object' && typeof ai.enabled === 'boolean') {
    return { enabled: ai.enabled };
  }
  return { enabled: Boolean(process.env.GEMINI_API_KEY) };
}

function parseViewport(value) {
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

async function serveFile(response, root, requestedPath) {
  if (await serveFileIfExists(response, root, requestedPath)) {
    return;
  }
  sendJson(response, 404, { error: 'Not found' });
}

async function serveFileIfExists(response, root, requestedPath) {
  const resolved = path.resolve(root, requestedPath || 'index.html');
  if (!resolved.startsWith(root)) {
    sendJson(response, 403, { error: 'Forbidden' });
    return true;
  }

  try {
    const file = await readFile(resolved);
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[path.extname(resolved)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(file);
    return true;
  } catch {
    return false;
  }
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(data));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new Error('Request body is too large.');
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
