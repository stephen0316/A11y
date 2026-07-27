const HEADERS = [
  '所属模块',
  '问题类型',
  '重要级',
  '问题描述',
  '问题图片',
  '预期效果',
  '修改建议',
  'UE/UI问题',
  '提出人',
  '处理状态',
  '预计完成时间',
  '开发处理人',
  '问题备注',
];

const COLUMN_WIDTHS = [16, 26, 17, 45, 26, 27, 27, 16, 15, 15, 22, 18, 20];

const SEVERITY_LABELS = {
  Blocker: '阻断',
  Major: '严重',
  Minor: '一般',
  Suggestion: '建议',
};

export async function downloadInspectionChecklist({ audit, links }) {
  const workbook = await createInspectionChecklistWorkbook({ audit, links });
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${safeFilename(audit?.meta?.target?.name || '走查测试清单')}-走查测试清单.xlsx`;
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function createInspectionChecklistWorkbook({ audit, links }) {
  const { default: ExcelJS } = await import('exceljs/dist/exceljs.min.js');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '无障碍走查';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('走查测试清单', {
    views: [{ showGridLines: false }],
  });
  sheet.properties.defaultRowHeight = 24;
  sheet.mergeCells('A1:M1');
  sheet.getCell('A1').value = `项目名称：【${audit?.meta?.target?.name || audit?.meta?.target?.url || '未命名页面'}】`;
  sheet.getCell('A1').font = { name: 'Microsoft YaHei', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF050505' } };
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 48;

  sheet.getRow(2).values = HEADERS;
  sheet.getRow(2).height = 42;
  sheet.getRow(2).eachCell((cell) => {
    cell.font = { name: 'Microsoft YaHei', size: 12, bold: true, color: { argb: 'FF171717' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC4CAD4' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = templateBorder();
  });

  COLUMN_WIDTHS.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  const issues = audit?.issues || [];
  const imageCache = new Map();
  for (const issue of issues) {
    const row = sheet.addRow(checklistRow(issue, audit));
    row.height = 100;
    row.eachCell((cell) => {
      cell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FF222222' } };
      cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
      cell.border = templateBorder();
    });

    const imageDataUrl = screenshotForIssue(issue, links);
    if (imageDataUrl) {
      let imageId = imageCache.get(imageDataUrl);
      if (imageId === undefined) {
        imageId = workbook.addImage({
          base64: imageDataUrl,
          extension: imageExtension(imageDataUrl),
        });
        imageCache.set(imageDataUrl, imageId);
      }
      sheet.addImage(imageId, {
        tl: { col: 4, row: row.number - 1, colOff: 6, rowOff: 6 },
        ext: { width: 150, height: 82 },
      });
    }
  }

  if (!issues.length) {
    const row = sheet.addRow([null, null, null, '本次走查未发现问题。', null, null, null, null, null, null, null, null, null]);
    row.height = 32;
    row.eachCell((cell) => {
      cell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FF222222' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      cell.border = templateBorder();
    });
  }

  sheet.views = [{ state: 'frozen', ySplit: 2, showGridLines: false }];
  return workbook;
}

export function checklistRow(issue, audit) {
  return [
    audit?.meta?.target?.name || audit?.meta?.target?.url || '未命名页面',
    issue?.title || issue?.ruleSource || '无障碍问题',
    SEVERITY_LABELS[issue?.severity] || '建议',
    issueDescription(issue),
    null,
    null,
    issue?.recommendation || '',
    null,
    null,
    null,
    null,
    null,
    null,
  ];
}

function issueDescription(issue) {
  const evidence = issue?.evidence || {};
  const description = [`问题元素：${issueSubject(evidence)}`, `检测结果：${detectionResult(issue)}`];
  if (issue?.impactUsers) {
    description.push(`用户影响：${issue.impactUsers}`);
  }
  if (issue?.ruleSource) {
    description.push(`判断依据：${issue.ruleSource}`);
  }
  return description.join('\n');
}

function issueSubject(evidence) {
  if (evidence.previous && evidence.current) {
    return `从「${evidenceText(evidence.previous)}」到「${evidenceText(evidence.current)}」的标题结构`;
  }
  if (Array.isArray(evidence.path)) {
    return '键盘导航过程';
  }
  if (evidenceIsPageScope(evidence)) {
    return '整个页面';
  }

  const type = elementType(evidence);
  const text = evidenceContent(evidence);
  if (type && text) {
    return `${type}「${text}」`;
  }
  return type || (text ? `文本「${text}」` : '待复核元素');
}

function detectionResult(issue) {
  const evidence = issue?.evidence || {};
  const failureSummary = String(evidence.failureSummary || '');
  const contrast = failureSummary.match(/contrast of\s+(\d+(?:\.\d+)?).*?Expected contrast ratio of\s+(\d+(?:\.\d+)?):1/is);
  if (contrast) {
    return `文字与背景的对比度为 ${contrast[1]}:1，低于普通文本所需的 ${contrast[2]}:1。`;
  }
  if (/does not have a main landmark/i.test(failureSummary)) {
    return '页面缺少 main 主内容地标。';
  }
  if (/heading order invalid/i.test(failureSummary)) {
    return '标题层级存在跳级，页面结构顺序不符合要求。';
  }
  if (/missing lang attribute/i.test(String(evidence.current || ''))) {
    return '页面根元素未设置语言声明。';
  }
  if (issue?.title === '可点击目标尺寸小于 24px' && evidence.rect) {
    return `可点击区域为 ${evidence.rect.width}×${evidence.rect.height}px，小于建议的 24×24px。`;
  }
  return `检测到“${issue?.title || '无障碍'}”问题。`;
}

function screenshotForIssue(issue, links) {
  const stepIndex = issue?.flowStep?.index;
  return (stepIndex ? links?.flowScreenshots?.[String(stepIndex)] : '') || links?.screenshot || '';
}

function templateBorder() {
  return {
    top: { style: 'thin', color: { argb: 'FF222222' } },
    left: { style: 'thin', color: { argb: 'FF222222' } },
    bottom: { style: 'thin', color: { argb: 'FF222222' } },
    right: { style: 'thin', color: { argb: 'FF222222' } },
  };
}

function evidenceText(evidence) {
  return String(evidence?.name || evidence?.text || evidence?.alt || evidence?.label || '').trim();
}

function evidenceTag(evidence) {
  const explicit = String(evidence?.tag || '').toLowerCase();
  return explicit || String(evidence?.html || '').match(/^\s*<([a-z0-9-]+)/i)?.[1]?.toLowerCase() || '';
}

function evidenceContent(evidence) {
  const text = evidenceText(evidence);
  if (text) {
    return text;
  }
  const html = String(evidence?.html || '');
  const alt = html.match(/\balt=["']([^"']+)["']/i)?.[1];
  if (alt) {
    return alt.trim();
  }
  const content = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
  return content.length <= 80 ? content : '';
}

function evidenceIsPageScope(evidence) {
  return evidenceTag(evidence) === 'html' || String(evidence?.selector || evidence?.target || '').trim() === 'html';
}

function elementType(evidence) {
  const tag = evidenceTag(evidence);
  const role = String(evidence?.role || '').toLowerCase();
  const type = String(evidence?.type || '').toLowerCase();
  if (tag === 'a' || role === 'link') return '链接';
  if (tag === 'button' || role === 'button') return '按钮';
  if (tag === 'img') return '图片';
  if (tag === 'input') return type ? `${type} 输入框` : '输入框';
  if (tag === 'textarea') return '多行输入框';
  if (tag === 'select') return '下拉选择框';
  if (tag === 'dialog' || role === 'dialog' || role === 'alertdialog') return '弹窗';
  return tag ? `<${tag}> 元素` : '';
}

function imageExtension(dataUrl) {
  return /^data:image\/jpe?g/i.test(dataUrl) ? 'jpeg' : 'png';
}

function safeFilename(value) {
  return String(value || '走查测试清单').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
}
