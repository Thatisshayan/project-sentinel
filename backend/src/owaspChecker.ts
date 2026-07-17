import axios from 'axios';
import logger from './logger';
import { upsertOwaspItem } from './securityDb';

interface OwaspItemDef {
  id: string;
  name: string;
  weight: number;
}

interface OwaspEvaluation {
  id: string;
  status: string;
  notes: string;
}

const OWASP_ITEMS: OwaspItemDef[] = [
  { id: 'A01:injection',     name: 'Injection (SQL, NoSQL, Command)',    weight: 2.0 },
  { id: 'A02:cryptographic', name: 'Cryptographic Failures',             weight: 1.8 },
  { id: 'A03:xss',           name: 'Cross-Site Scripting (XSS)',         weight: 1.5 },
  { id: 'A04:design',        name: 'Insecure Design',                    weight: 1.2 },
  { id: 'A05:config',        name: 'Security Misconfiguration',          weight: 1.5 },
  { id: 'A06:components',    name: 'Vulnerable & Outdated Components',   weight: 1.8 },
  { id: 'A07:auth',          name: 'Identification & Authentication',    weight: 2.0 },
  { id: 'A08:integrity',     name: 'Software & Data Integrity Failures', weight: 1.5 },
  { id: 'A09:logging',       name: 'Security Logging & Monitoring',      weight: 1.0 },
  { id: 'A10:ssrf',          name: 'Server-Side Request Forgery (SSRF)', weight: 1.2 },
];

// Calls NVIDIA NIM directly — no exported callNvidia in claudeCodeAudit.js
async function callNvidiaForSecurity(prompt: string): Promise<string> {
  if (!process.env['NVIDIA_API_KEY']) throw new Error('NVIDIA_API_KEY not set');
  const response = await axios.post(
    'https://integrate.api.nvidia.com/v1/chat/completions',
    {
      model:       process.env['OWASP_MODEL'] || 'meta/llama-3.1-70b-instruct',
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  1000,
      temperature: 0.1,
    },
    {
      headers: {
        Authorization:  `Bearer ${process.env['NVIDIA_API_KEY']}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );
  return response.data.choices[0]?.message?.content || '';
}

async function evaluateOwasp(repoName: string, repoPath: string, fileList: string[]) {
  const fileSummary = fileList.slice(0, 100).join('\n');

  const prompt = `You are a security expert evaluating a repository against OWASP Top 10 2021.

Repository: ${repoName}
File structure (first 100 files):
${fileSummary}

Respond ONLY with a JSON array — no preamble, no markdown fences:
[
  { "id": "A01:injection", "status": "pass|fail|partial|unknown", "notes": "brief reason" },
  { "id": "A02:cryptographic", "status": "...", "notes": "..." },
  { "id": "A03:xss", "status": "...", "notes": "..." },
  { "id": "A04:design", "status": "...", "notes": "..." },
  { "id": "A05:config", "status": "...", "notes": "..." },
  { "id": "A06:components", "status": "...", "notes": "..." },
  { "id": "A07:auth", "status": "...", "notes": "..." },
  { "id": "A08:integrity", "status": "...", "notes": "..." },
  { "id": "A09:logging", "status": "...", "notes": "..." },
  { "id": "A10:ssrf", "status": "...", "notes": "..." }
]

Base your evaluation on file names and patterns only.
Use "unknown" when you cannot determine from file structure alone.
Be conservative. Do not invent issues.`;

  let evaluation: OwaspEvaluation[] = [];

  try {
    const response = await callNvidiaForSecurity(prompt);
    const clean    = response
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/```json|```/g, '')
      .trim();
    const arrMatch = clean.match(/\[[\s\S]*\]/);
    evaluation     = JSON.parse(arrMatch ? arrMatch[0] : clean);
  } catch (err: any) {
    logger.warn({ err: err.message, repoName }, 'OWASP parse failed — using unknowns');
    evaluation = OWASP_ITEMS.map(item => ({
      id: item.id, status: 'unknown', notes: 'Evaluation failed',
    }));
  }

  for (const item of evaluation) {
    await upsertOwaspItem(repoName, item.id, item.status, item.notes).catch(() => {});
  }

  // pass=full weight, partial=half, fail/unknown=0
  const totalWeight = OWASP_ITEMS.reduce((s, i) => s + i.weight, 0);
  let earned = 0;
  for (const result of evaluation) {
    const def = OWASP_ITEMS.find(i => i.id === result.id);
    if (!def) continue;
    if (result.status === 'pass')    earned += def.weight;
    if (result.status === 'partial') earned += def.weight * 0.5;
  }

  const owaspScore = parseFloat(((earned / totalWeight) * 10).toFixed(1));
  logger.info({ repoName, owaspScore }, 'OWASP evaluation complete');
  return { results: evaluation, owaspScore };
}

export = { evaluateOwasp, OWASP_ITEMS };
