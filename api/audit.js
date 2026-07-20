import { normalizeVercelAuditPayload } from '../src/vercel/input.js';
import { runVercelAudit } from '../src/vercel/reports.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const target = await normalizeVercelAuditPayload(request.body);
    const report = await runVercelAudit(target, request.body);
    response.status(200).json({ ok: true, report });
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: error.message || 'Internal server error' });
  }
}
