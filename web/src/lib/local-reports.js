const DATABASE_NAME = 'a11y-local-reports';
const DATABASE_VERSION = 1;
const STORE_NAME = 'reports';
const MAX_REPORTS = 30;

export async function listLocalReports() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const reports = await requestResult(transaction.objectStore(STORE_NAME).getAll());
    return reports.sort((left, right) => String(right.generatedAt).localeCompare(String(left.generatedAt)));
  } finally {
    database.close();
  }
}

export async function saveLocalReport(report) {
  const record = toStoredReport(report);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    await requestResult(store.put(record));
    await transactionComplete(transaction);
  } finally {
    database.close();
  }

  const reports = await listLocalReports();
  const expiredIds = reports.slice(MAX_REPORTS).map((item) => item.id);
  if (expiredIds.length) {
    await deleteLocalReports(expiredIds);
  }
  return record;
}

export async function clearLocalReports() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    await requestResult(transaction.objectStore(STORE_NAME).clear());
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export function createLocalDownloadLinks(report, { includePreview = false } = {}) {
  const links = {
    report: createObjectUrl(report.markdown || '', 'text/markdown;charset=utf-8'),
    audit: createObjectUrl(JSON.stringify(report.audit || {}, null, 2), 'application/json;charset=utf-8'),
    screenshot: includePreview ? report.preview?.screenshotDataUrl || '' : '',
    flowScreenshots: {},
  };
  return links;
}

function toStoredReport(report) {
  const audit = report?.audit || {};
  return {
    id: String(report?.id || crypto.randomUUID()),
    target: String(report?.target || audit.meta?.target?.name || '未命名页面'),
    url: String(audit.meta?.target?.url || ''),
    generatedAt: String(audit.meta?.generatedAt || new Date().toISOString()),
    summary: audit.summary || {},
    audit,
    markdown: String(report?.markdown || ''),
  };
}

function createObjectUrl(value, type) {
  return URL.createObjectURL(new Blob([value], { type }));
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开浏览器本地报告存储。'));
  });
}

async function deleteLocalReports(ids) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    for (const id of ids) {
      store.delete(id);
    }
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('浏览器本地报告存储操作失败。'));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('浏览器本地报告存储操作被中断。'));
    transaction.onerror = () => reject(transaction.error || new Error('浏览器本地报告存储操作失败。'));
  });
}
