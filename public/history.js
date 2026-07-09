const els = {
  reportList: document.querySelector('[data-report-list]'),
  refreshReportsButton: document.querySelector('[data-refresh-reports]'),
};

els.refreshReportsButton.addEventListener('click', loadReports);

loadReports();

async function loadReports() {
  els.refreshReportsButton.disabled = true;
  try {
    const response = await fetch('/api/reports');
    const data = await response.json();
    renderReports(data.reports || []);
  } catch (error) {
    const empty = document.createElement('div');
    empty.className = 'report-card';
    empty.textContent = error.message || '历史报告加载失败。';
    els.reportList.replaceChildren(empty);
  } finally {
    els.refreshReportsButton.disabled = false;
  }
}

function renderReports(reports) {
  if (!reports.length) {
    const empty = document.createElement('div');
    empty.className = 'report-card';
    empty.textContent = '暂无历史报告。';
    els.reportList.replaceChildren(empty);
    return;
  }

  els.reportList.replaceChildren(...reports.map((report) => {
    const card = document.createElement('article');
    card.className = 'report-card';
    const summary = report.summary || {};
    const bySeverity = summary.bySeverity || {};
    card.innerHTML = `
      <header>
        <div>
          <h3>${escapeHtml(report.target)}</h3>
          <p>${escapeHtml(report.url || '未记录 URL')}</p>
          <div class="issue-meta">
            <span class="pill">总数 ${summary.total || 0}</span>
            <span class="pill Blocker">阻断 ${bySeverity.Blocker || 0}</span>
            <span class="pill Major">严重 ${bySeverity.Major || 0}</span>
            <span class="pill Minor">一般 ${bySeverity.Minor || 0}</span>
          </div>
        </div>
        <span class="pill">${escapeHtml(formatDate(report.generatedAt))}</span>
      </header>
      <div class="report-links">
        <a class="artifact-link" href="${report.links.report}" target="_blank" rel="noreferrer">报告</a>
        <a class="artifact-link" href="${report.links.audit}" target="_blank" rel="noreferrer">JSON</a>
        <a class="artifact-link" href="${report.links.screenshot}" target="_blank" rel="noreferrer">截图</a>
      </div>
    `;
    return card;
  }));
}

function formatDate(value) {
  if (!value) {
    return '';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
