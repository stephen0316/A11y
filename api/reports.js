import { listStoredVercelReports } from '../src/vercel/reports.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('allow', 'GET');
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    response.status(200).json({ reports: await listStoredVercelReports() });
  } catch (error) {
    response.status(500).json({ error: error.message || '历史报告读取失败' });
  }
}
