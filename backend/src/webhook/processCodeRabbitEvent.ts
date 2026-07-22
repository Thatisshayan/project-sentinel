// Phase 2 of docs/2026-07-22-slack-agent-roster-plan.md — CodeRabbit is the
// primary audit engine. CodeRabbit already auto-reviews PRs via its own
// GitHub App (confirmed by the repo owner) — Sentinel does not trigger
// reviews, it only receives the completion webhook here and folds findings
// into the existing audit_tasks pipeline so approval/execution/notification
// all work exactly as they do for Sentinel's own claudeCodeAudit.ts output.
//
// IMPORTANT — payload shape is NOT yet verified against a real CodeRabbit
// webhook delivery (flagged as an open research item in the plan doc). The
// shape assumed below is a reasonable best guess based on common PR-review
// webhook conventions (a repo/PR identifier plus an array of findings with
// file/line/severity/message). Re-check this against an actual delivery —
// via CodeRabbit's dashboard or a captured payload — before relying on this
// in production, and adjust normalizePayload() accordingly. Nothing else in
// this file should need to change if only the payload shape turns out wrong.

import logger from '../logger';
import { safeFire } from '../utils/safeFire';
import { sendTelegramMessage } from '../telegramClient';
import { createAuditCycle, updateAuditCycle, createAuditTask } from '../auditDb';

interface RawFinding {
  file?: string;
  line?: number;
  severity?: string;   // expected: 'critical' | 'high' | 'medium' | 'low' — unverified
  category?: string;
  message?: string;
  title?: string;
}

interface NormalizedFinding {
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  affectedFiles: string[];
}

const VALID_PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);

function normalizeSeverity(raw: string | undefined): NormalizedFinding['priority'] {
  const lower = (raw || '').toLowerCase();
  return VALID_PRIORITIES.has(lower) ? (lower as NormalizedFinding['priority']) : 'medium';
}

function normalizeFinding(raw: RawFinding, index: number): NormalizedFinding {
  return {
    title: raw.title || raw.message?.slice(0, 80) || `CodeRabbit finding #${index + 1}`,
    description: raw.message || raw.title || '',
    priority: normalizeSeverity(raw.severity),
    category: raw.category || 'code-quality',
    affectedFiles: raw.file ? [raw.file] : [],
  };
}

interface NormalizedPayload {
  repoFullName: string;
  repoName: string;
  commitSha: string;
  prUrl?: string;
  prNumber?: number;
  findings: NormalizedFinding[];
}

/**
 * Best-effort normalization of a CodeRabbit review-complete webhook payload.
 * See file header — verify this against a real payload before trusting it.
 */
function normalizePayload(payload: any): NormalizedPayload | null {
  const repoFullName = payload?.repository?.full_name || payload?.repo?.full_name;
  if (!repoFullName) return null;

  const repoName = repoFullName.split('/')[1] || repoFullName;
  const commitSha = payload?.pull_request?.head?.sha || payload?.commit_sha || payload?.sha || 'unknown';
  const prUrl = payload?.pull_request?.html_url || payload?.pr_url;
  const prNumber = payload?.pull_request?.number || payload?.pr_number;

  const rawFindings: RawFinding[] =
    payload?.review?.comments || payload?.findings || payload?.comments || [];

  return {
    repoFullName,
    repoName,
    commitSha,
    prUrl,
    prNumber,
    findings: rawFindings.map((f, i) => normalizeFinding(f, i)),
  };
}

function buildSummaryText(repoName: string, findings: NormalizedFinding[], prUrl?: string): string {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.priority]++;

  const topFindings = [...findings]
    .sort((a, b) =>
      ['critical', 'high', 'medium', 'low'].indexOf(a.priority) -
      ['critical', 'high', 'medium', 'low'].indexOf(b.priority)
    )
    .slice(0, 5)
    .map(f => `  · [${f.priority}] ${f.title}`);

  return [
    `🐰 CodeRabbit audit — ${repoName}`,
    ``,
    `🔴 Critical: ${counts.critical}  🟠 High: ${counts.high}  🟡 Medium: ${counts.medium}  🟢 Low: ${counts.low}`,
    ``,
    findings.length === 0 ? 'No findings.' : topFindings.join('\n'),
    findings.length > 5 ? `  … and ${findings.length - 5} more` : '',
    prUrl ? `\nPR: ${prUrl}` : '',
  ].filter(Boolean).join('\n');
}

async function processCodeRabbitEvent(payload: any): Promise<void> {
  const normalized = normalizePayload(payload);
  if (!normalized) {
    logger.warn({ payload }, 'processCodeRabbitEvent: could not normalize payload, dropping');
    return;
  }

  const { repoFullName, repoName, commitSha, prUrl, findings } = normalized;

  const cycle = await createAuditCycle({ repoFullName, commitSha });
  if (!cycle) {
    logger.warn({ repoFullName, commitSha }, 'processCodeRabbitEvent: audit cycle already exists or failed to create');
    return;
  }

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    if (!f) continue;
    await createAuditTask({
      auditCycleId: cycle.id,
      repoFullName,
      taskNumber: i + 1,
      title: f.title,
      description: f.description,
      priority: f.priority,
      category: f.category,
      affectedFiles: f.affectedFiles,
      source: 'coderabbit',
      // Not auto-executable by default — CodeRabbit findings need human
      // review before Sentinel's builders act on them, same conservative
      // default as a fresh Sentinel-originated audit.
      safeToAutoExecute: false,
    });
  }

  await updateAuditCycle(cycle.id, {
    status: 'auditing',
    audit_agent: 'coderabbit',
    audit_summary: `CodeRabbit review — ${findings.length} finding(s)`,
    tasks_total: findings.length,
  });

  const summary = buildSummaryText(repoName, findings, prUrl);
  await safeFire(sendTelegramMessage(summary, repoName, null), { label: 'processCodeRabbitEvent' });

  logger.info({ repoFullName, cycleId: cycle.id, findings: findings.length }, 'CodeRabbit audit ingested');
}

export { processCodeRabbitEvent, normalizePayload, buildSummaryText };
