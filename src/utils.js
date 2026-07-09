export function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'target';
}

export function nowStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}
