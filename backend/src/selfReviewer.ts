import axios from 'axios';
import logger from './logger';
import { safeFire } from './utils/safeFire';
import { sendTelegramMessage } from './telegramClient';
import { createAuditCycle, getAuditCycle, createAuditTask, getNextTaskNumberForCycle } from './auditDb';

// D-027 item 4 (self-review fallback) — "if coderabbit didn't comment, Aider
// should, or... any of the agents in sentinel should" (Shayan, 2026-07-29).
// When Sentinel pushes to its accumulating branch and CodeRabbit hasn't
// produced a finding within CODERABBIT_FALLBACK_DELAY_MIN, Sentinel reviews
// its own diff and creates equivalent findings — same conservative posture
// as CodeRabbit-sourced tasks (safeToAutoExecute: false, human reviews
// before a builder acts on it), so the fix-loop has something to react to
// even on repos where CodeRabbit isn't installed or configured.

const REVIEW_MODEL = process.env['AUDIT_MODEL'] || 'mistralai/mistral-nemotron';
const DIFF_CHAR_BUDGET = 15000;
const REVIEW_TIMEOUT_MS = 5 * 60 * 1000;

interface SelfReviewFinding {
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  path?: string;
}

function severityToPriority(s: string): 'critical' | 'high' | 'medium' | 'low' {
  const v = (s || '').toLowerCase();
  if (v === 'critical' || v === 'high' || v === 'low') return v;
  return 'medium';
}

function buildReviewPrompt(diff: string, repoFullName: string, prNumber: number): string {
  return `You are an expert code reviewer conducting a self-review of Project Sentinel's own pull request (a role normally filled by CodeRabbit, which did not respond in time for this PR).

REPO: ${repoFullName}
PR: #${prNumber}

Review the unified diff below the way a careful senior reviewer would: correctness bugs, security issues, missed edge cases, resource leaks, and any change that looks unsafe or incomplete. Do NOT comment on style/formatting nits unless they indicate a real bug. If the diff is genuinely clean, return an empty findings array — do not invent problems.

DIFF:
${diff}

CRITICAL OUTPUT RULE:
Your ENTIRE response must be valid JSON only. No explanation, no markdown fences, no text before or after the JSON. Start with { and end with }.

Output this exact structure:
{
  "findings": [
    {
      "title": "<short title under 80 characters>",
      "description": "<what is wrong and why it matters>",
      "severity": "critical" | "high" | "medium" | "low",
      "path": "<file path from the diff this finding is about, or omit if repo-wide>"
    }
  ]
}`;
}

function parseFindings(stdout: string): SelfReviewFinding[] {
  if (!stdout || stdout.trim() === '') return [];
  const stripped = stdout.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const jsonMatch = stripped.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object found in self-review output');
  }
  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed.findings)) return [];
  return parsed.findings
    .filter((f: any) => f && typeof f.title === 'string')
    .slice(0, 15)
    .map((f: any) => ({
      title:       String(f.title).slice(0, 80),
      description: String(f.description || ''),
      severity:    severityToPriority(f.severity),
      path:        typeof f.path === 'string' ? f.path : undefined,
    }));
}

async function fetchPrDiff(repoFullName: string, prNumber: number): Promise<string> {
  const token = process.env['GITHUB_TOKEN'];
  const res = await axios.get(
    `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:        'application/vnd.github.v3.diff',
      },
      timeout: 15000,
    }
  );
  const diff: string = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  return diff.length > DIFF_CHAR_BUDGET
    ? diff.slice(0, DIFF_CHAR_BUDGET) + '\n\n[diff truncated]'
    : diff;
}

async function callReviewModel(prompt: string): Promise<string> {
  const response = await axios.post(
    'https://integrate.api.nvidia.com/v1/chat/completions',
    {
      model:       REVIEW_MODEL,
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  2048,
      temperature: 0.1,
    },
    {
      headers: {
        Authorization:  `Bearer ${process.env['NVIDIA_API_KEY']}`,
        'Content-Type': 'application/json',
      },
      timeout: REVIEW_TIMEOUT_MS,
    }
  );
  return response.data.choices[0]?.message?.content || '';
}

interface SelfReviewResult {
  ran: boolean;
  findingsCreated: number;
  reason?: string;
}

/**
 * Reviews the diff of a Sentinel-opened PR and records any findings as
 * audit_tasks (source: 'self_review'), the same downstream pipeline
 * CodeRabbit-sourced findings already feed. Always conservative
 * (safeToAutoExecute: false) — a human reviews before any builder acts.
 */
async function reviewPrDiff(params: {
  repoFullName: string; repoName: string; prNumber: number; prUrl: string | null; topicId: number | null;
}): Promise<SelfReviewResult> {
  const { repoFullName, repoName, prNumber, prUrl, topicId } = params;

  if (!process.env['NVIDIA_API_KEY']) {
    logger.info({ repoFullName, prNumber }, 'Self-review skipped — NVIDIA_API_KEY not configured');
    return { ran: false, findingsCreated: 0, reason: 'no_review_model_configured' };
  }

  let diff: string;
  try {
    diff = await fetchPrDiff(repoFullName, prNumber);
  } catch (err: any) {
    logger.warn({ err: err.message, repoFullName, prNumber }, 'Self-review: failed to fetch PR diff');
    return { ran: false, findingsCreated: 0, reason: 'diff_fetch_failed' };
  }

  if (!diff.trim()) {
    return { ran: true, findingsCreated: 0, reason: 'empty_diff' };
  }

  let findings: SelfReviewFinding[];
  try {
    const raw = await callReviewModel(buildReviewPrompt(diff, repoFullName, prNumber));
    findings = parseFindings(raw);
  } catch (err: any) {
    logger.warn({ err: err.message, repoFullName, prNumber }, 'Self-review model call/parse failed');
    return { ran: false, findingsCreated: 0, reason: 'model_call_failed' };
  }

  if (findings.length === 0) {
    await safeFire(sendTelegramMessage(
      `🤖 Sentinel self-review — ${repoName} PR #${prNumber}\nNo issues found (CodeRabbit hasn't responded yet). Diff looks clean.`,
      repoName, topicId
    ), { label: 'selfReviewer' });
    return { ran: true, findingsCreated: 0 };
  }

  // Use a synthetic per-PR commit key for the audit cycle these findings
  // attach to — a self-review isn't tied to one specific commit the way
  // CodeRabbit's PR-comment ingestion is (a PR on the accumulating branch
  // spans many commits), so cycle-per-commit lookup doesn't apply here.
  const cycleKey = `self-review-pr-${prNumber}`;
  let cycle = await getAuditCycle(repoFullName, cycleKey).catch(() => null);
  if (!cycle) {
    cycle = await createAuditCycle({ repoFullName, commitSha: cycleKey, projectName: repoName }).catch(() => null);
  }
  if (!cycle) {
    logger.warn({ repoFullName, prNumber }, 'Self-review: could not resolve or create an audit cycle');
    return { ran: true, findingsCreated: 0, reason: 'cycle_creation_failed' };
  }

  let createdCount = 0;
  for (const finding of findings) {
    const MAX_ATTEMPTS = 5;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const nextTaskNumber = await getNextTaskNumberForCycle(cycle.id).catch(() => 1);
      try {
        await createAuditTask({
          auditCycleId:      cycle.id,
          repoFullName,
          taskNumber:        nextTaskNumber,
          title:             finding.title,
          description:       finding.description,
          priority:          finding.severity,
          category:          'code-quality',
          affectedFiles:     finding.path ? [finding.path] : [],
          source:            'self_review',
          safeToAutoExecute: false,
        });
        createdCount++;
        break;
      } catch (err: any) {
        const isTaskNumberCollision = err?.code === '23505';
        if (!isTaskNumberCollision || attempt === MAX_ATTEMPTS) {
          logger.error({ err: err.message, repoFullName, cycleId: cycle.id, attempt },
            'Failed to record self-review finding as an audit task');
          break;
        }
      }
    }
  }

  await safeFire(sendTelegramMessage(
    [
      `🤖 Sentinel self-review — ${repoName} PR #${prNumber}`,
      `CodeRabbit hasn't responded yet, so Sentinel reviewed its own diff:`,
      ``,
      ...findings.slice(0, createdCount).map(f => `• [${f.severity}] ${f.title}${f.path ? ` (${f.path})` : ''}`),
      ``,
      prUrl || '',
    ].filter(Boolean).join('\n'),
    repoName, topicId
  ), { label: 'selfReviewer' });

  logger.info({ repoFullName, prNumber, findingsCreated: createdCount }, 'Self-review complete');
  return { ran: true, findingsCreated: createdCount };
}

export = { reviewPrDiff };
