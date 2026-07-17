import { readFile, rm, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { list, put } from '@vercel/blob';
import { auditTargets } from '../index.js';
import { renderMarkdownReport } from '../report.js';
import { launchVercelBrowser } from './launch-browser.js';
import { normalizeAiOptions, parseViewport } from './input.js';

const BLOB_PREFIX = 'a11y-audit-runs/';

export async function runAndStoreVercelAudit(target, payload = {}) {
  ensureBlobConfigured();
  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'a11y-audit-'));

  try {
    const result = await auditTargets([target], {
      outDir: workingDirectory,
      maxTabs: Number(payload.maxTabs || 30),
      viewport: parseViewport(payload.viewport),
      ai: normalizeAiOptions(payload.ai),
      launchBrowser: launchVercelBrowser,
    });
    const report = result.reports[0];
    const runId = path.basename(path.dirname(report.reportPath));
    const runDirectory = path.dirname(report.reportPath);
    const localAudit = JSON.parse(await readFile(report.jsonPath, 'utf8'));
    const links = await uploadArtifacts(runId, runDirectory, localAudit);
    const artifactAudit = withRemoteArtifacts(localAudit, links);
    links.audit = await uploadText(runId, 'audit.json', JSON.stringify(artifactAudit, null, 2), 'application/json; charset=utf-8');
    links.report = await uploadText(runId, 'report.md', renderMarkdownReport(artifactAudit), 'text/markdown; charset=utf-8');
    const audit = withRemoteArtifacts(localAudit, links);

    await uploadText(runId, 'audit.json', JSON.stringify(audit, null, 2), 'application/json; charset=utf-8');
    await uploadText(runId, 'report.md', renderMarkdownReport(audit), 'text/markdown; charset=utf-8');

    return {
      id: runId,
      target: report.target,
      links,
      audit: {
        meta: audit.meta,
        summary: audit.summary,
        ai: audit.ai,
        issues: audit.issues,
      },
    };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

export async function listStoredVercelReports() {
  ensureBlobConfigured();
  const { blobs } = await list({ prefix: BLOB_PREFIX, limit: 1000 });
  const auditBlobs = blobs.filter((blob) => blob.pathname.endsWith('/audit.json'));
  const reports = await Promise.all(auditBlobs.map(async (blob) => {
    const response = await fetch(blob.url);
    if (!response.ok) {
      return null;
    }
    const audit = await response.json();
    const runId = blob.pathname.slice(BLOB_PREFIX.length, -'/audit.json'.length);
    return {
      id: runId,
      target: audit.meta?.target?.name || runId,
      url: audit.meta?.target?.url || '',
      generatedAt: audit.meta?.generatedAt || blob.uploadedAt,
      summary: audit.summary || {},
      links: linksFromAudit(audit),
    };
  }));
  return reports
    .filter(Boolean)
    .sort((left, right) => String(right.generatedAt).localeCompare(String(left.generatedAt)));
}

function ensureBlobConfigured() {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    throw new Error('未配置 Vercel Blob。请在 Vercel Storage 创建并连接 Blob Store，使项目获得 BLOB_STORE_ID 或 BLOB_READ_WRITE_TOKEN。');
  }
}

async function uploadArtifacts(runId, runDirectory, audit) {
  const links = {
    screenshot: await uploadFile(runId, runDirectory, 'screenshot.png', 'image/png'),
    domSnapshot: await uploadFile(runId, runDirectory, 'dom-snapshot.html', 'text/html; charset=utf-8'),
    accessibilityTree: await uploadFile(runId, runDirectory, 'accessibility-tree.json', 'application/json; charset=utf-8'),
  };
  const flowScreenshots = audit.meta?.artifacts?.flowScreenshots || [];
  if (flowScreenshots.length) {
    links.flowScreenshots = Object.fromEntries(await Promise.all(flowScreenshots.map(async ({ index, screenshot }) => [
      String(index),
      await uploadFile(runId, runDirectory, screenshot, 'image/png'),
    ])));
  }
  return links;
}

async function uploadFile(runId, runDirectory, filename, contentType) {
  const contents = await readFile(path.join(runDirectory, filename));
  return upload(runId, filename, contents, contentType);
}

async function uploadText(runId, filename, contents, contentType) {
  return upload(runId, filename, contents, contentType);
}

async function upload(runId, filename, body, contentType) {
  const blob = await put(`${BLOB_PREFIX}${runId}/${filename}`, body, {
    access: 'public',
    addRandomSuffix: false,
    contentType,
  });
  return blob.url;
}

function withRemoteArtifacts(audit, links) {
  const remoteFlowScreenshots = (audit.meta?.artifacts?.flowScreenshots || []).map((item) => ({
    ...item,
    screenshot: links.flowScreenshots?.[String(item.index)] || item.screenshot,
  }));
  return {
    ...audit,
    meta: {
      ...audit.meta,
      artifacts: {
        ...(audit.meta?.artifacts || {}),
        screenshot: links.screenshot,
        report: links.report,
        audit: links.audit,
        domSnapshot: links.domSnapshot,
        accessibilityTree: links.accessibilityTree,
        flowScreenshots: remoteFlowScreenshots,
      },
    },
  };
}

function linksFromAudit(audit) {
  const artifacts = audit.meta?.artifacts || {};
  return {
    report: artifactUrl(artifacts.report),
    audit: artifactUrl(artifacts.audit),
    screenshot: artifactUrl(artifacts.screenshot),
    domSnapshot: artifactUrl(artifacts.domSnapshot),
    accessibilityTree: artifactUrl(artifacts.accessibilityTree),
    flowScreenshots: Object.fromEntries((artifacts.flowScreenshots || [])
      .filter((item) => item?.index && item?.screenshot)
      .map((item) => [String(item.index), artifactUrl(item.screenshot)])),
  };
}

function artifactUrl(value) {
  return String(value || '');
}
