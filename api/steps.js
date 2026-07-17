import { generateVercelSteps } from '../src/vercel/input.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const plan = await generateVercelSteps(request.body);
    response.status(200).json({ ok: true, plan });
  } catch (error) {
    response.status(400).json({ error: error.message || '步骤生成失败' });
  }
}
