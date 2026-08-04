import { safeFire, fireAndForget } from './utils/safeFire';
import axios from 'axios';
import logger from './logger';
import { runAudit } from './claudeCodeAudit';
import { writeTasksToNotion, updateNotionTaskStatus } from './auditTaskWriter';
import { executeBatch } from './taskBuilder';
import { createPullRequest } from './prCreator';
import { sendTelegramMessage } from './telegramClient';
import { sendSlackButtons } from './slackClient';
import { findNotionProject } from './notionClient';
import projectDb from './projectDb';
import {
  createAuditCycle, updateAuditCycle,
  getActiveCycleForRepo, getLastCompletedAudit, getPreviousHealthScore,
  getPreviousAspectHealthScore,
  getQueuedTaskCount, getNextBatch,
  updateAuditTask, countTasksExecutedToday,
  stopAllTasksForRepo, markTasksDoneForBranch,
} from './auditDb';
import auditAspects from './auditAspects';
import { getBuilderConfig, getFallbackBuilder } from './builderRouter';
import { reportFailure, reportSuccess } from './selfHealer';
import { trackModelCall } from './performanceTracker';
import { isRepoLocked } from './repoLock';
import { loadSettings } from './settingsLoader';
import dbClient from './dbClient';
import { ensureProject, recordEvent, upsertTask, upsertRisk, upsertKpi } from './boardroomDb';
import { enqueueScheduledJob } from './queueClient';
import { AUDIT_APPROVAL_TIMEOUT_JOB, SELF_REVIEW_FALLBACK_JOB } from './workers/scheduledJobsWorker';
import { getErrorInfo } from './utils/error';
import type { AuditResult, AuditTask } from './types/auditResult';

const AUDIT_ENABLED      = (): boolean => process.env['AUDIT_AGENT_ENABLED']   !== 'false';
const BUILDER_ENABLED    = (): boolean => process.env['BUILDER_AGENT_ENABLED'] !== 'false';

let getEffectiveBatchSize: () => number, getEffectiveDailyLimit: () => number;
try {
  ({ getEffectiveBatchSize, getEffectiveDailyLimit } = require('./selfScaler'));
} catch {
  getEffectiveBatchSize  = (): number => parseInt(process.env['TASK_BATCH_SIZE']           || '5');
  getEffectiveDailyLimit = (): number => parseInt(process.env['MAX_BUILDER_TASKS_PER_DAY'] || '10');
}

const BATCH_SIZE  = (): number => getEffectiveBatchSize();
const DAILY_LIMIT = (): number => getEffectiveDailyLimit();

const COOLDOWN_HOURS     = async (): Promise<number> => {
  const settings = await loadSettings();
  return settings.audit_cooldown_h;
};
const QUEUED_THRESHOLD   = (): number => parseInt(process.env['MIN_QUEUED_BEFORE_SKIP_AUDIT'] || '3');
const APPROVAL_TIMEOUT_H = (): number => parseInt(process.env['AUDIT_APPROVAL_TIMEOUT_H']    || '24');

/**
 * Posts an audit's outcome (success summary or failure reason) as a GitHub
 * commit comment, so it's visible somewhere other than Telegram/Slack —
 * requested directly by the owner after a manual audit failed silently
 * with no visible-to-them result. Manual/ad-hoc audits use a synthetic
 * commitSha ('manual-<timestamp>'), which isn't a real commit to comment
 * on, so this always resolves the actual latest commit on the given branch
 * (or the repo's default branch, if none given) via the GitHub API rather
 * than trusting the audit payload's commitSha. Fire-and-forget by design
 * (called via `await` at the call site only to log a failure, never to
 * block or fail the audit itself) — a GitHub API hiccup must never affect
 * the Telegram/Slack notification that already succeeded.
 */
async function postAuditSummaryToGithub(repoFullName: string, branchName: string | undefined, text: string): Promise<void> {
  const token = process.env['GITHUB_TOKEN'];
  if (!token) return;

  try {
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
    const { getDefaultBranch } = require('./repoDiscovery') as { getDefaultBranch: (r: string) => Promise<string> };
    const branch = branchName || await getDefaultBranch(repoFullName);

    const commitRes = await axios.get(
      `https://api.github.com/repos/${repoFullName}/commits/${encodeURIComponent(branch)}`,
      { headers, timeout: 10000 }
    );
    const sha = commitRes.data?.sha;
    if (!sha) {
      logger.warn({ repoFullName, branch }, 'postAuditSummaryToGithub: could not resolve a commit sha to comment on');
      return;
    }

    // GitHub commit comments don't have a documented hard length cap, but
    // truncate generously anyway to avoid an oversized-payload rejection.
    const body = text.length > 60000 ? text.slice(0, 60000) + '\n\n[truncated]' : text;
    await axios.post(
      `https://api.github.com/repos/${repoFullName}/commits/${sha}/comments`,
      { body },
      { headers, timeout: 10000 }
    );
    logger.info({ repoFullName, sha }, 'Posted audit result as a GitHub commit comment');
  } catch (err: unknown) {
    const error = getErrorInfo(err);
    logger.warn({ err: error.message, repoFullName }, 'Failed to post audit result to GitHub — Telegram/Slack notification is unaffected');
  }
}

// ── THE 4 LOOP-PREVENTION RULES ───────────────────────────────────────────────

interface AuditRuleCheckData {
  repoFullName: string;
  repoName?: string;
  authorName?: string;
  authorEmail?: string;
  branchName?: string;
  commitMessage?: string;
  topicId?: number | null;
}

async function checkAuditRules(data: AuditRuleCheckData): Promise<{ pass: boolean; reason?: string }> {
  const { repoFullName, repoName, authorName, authorEmail,
          branchName, commitMessage, topicId } = data;

  // RULE 1 — Skip Sentinel-authored commits
  const isSentinel = [
    authorName  === 'Project Sentinel',
    authorEmail === 'sentinel@project-sentinel.app',
    (branchName    || '').startsWith('sentinel/'),
    (commitMessage || '').startsWith('feat(sentinel):'),
    (commitMessage || '').startsWith('fix(sentinel):'),
  ].some(Boolean);

  if (isSentinel) {
    logger.info({ repoName, authorName }, 'Rule 1: Sentinel commit — audit skipped');
    return { pass: false, reason: 'sentinel_commit' };
  }

  // RULE 2 — Skip if queued tasks already exist
  const queuedCount = await getQueuedTaskCount(repoFullName);
  if (queuedCount >= QUEUED_THRESHOLD()) {
    logger.info({ repoName, queuedCount }, 'Rule 2: Tasks queued — audit skipped');
    await safeFire(sendTelegramMessage(
      `Project Sentinel — Audit Skipped ⏭️\n\nRepo: ${repoName}\n${queuedCount} tasks still in queue.\nAudit will run when queue clears.`,
      repoName ?? null,
      topicId
    ), { label: 'auditOrchestrator' })
    return { pass: false, reason: 'tasks_queued' };
  }

  // RULE 3 — 12-hour cooldown (max 2 audits per day)
  const lastAudit = await getLastCompletedAudit(repoFullName);
  if (lastAudit) {
    const hoursSince = (Date.now() - new Date(lastAudit.created_at).getTime()) / 3600000;
    const cooldownHours = await COOLDOWN_HOURS();
    if (hoursSince < cooldownHours) {
      logger.info({ repoName, hoursSince: Math.round(hoursSince), cooldownHours },
        'Rule 3: Cooldown active — audit skipped');
      return { pass: false, reason: 'cooldown' };
    }
  }

  return { pass: true };
}

// ── MAIN AUDIT TRIGGER ────────────────────────────────────────────────────────

export interface TriggerAuditResult {
  started: boolean;
  reason?: string;
}

export interface TriggerAuditPayload {
  repoFullName: string;
  repoName: string;
  projectName?: string;
  commitSha: string;
  commitMessage?: string;
  branchName?: string;
  authorName?: string;
  authorEmail?: string;
  topicId: number | null;
}

async function triggerAudit(payload: TriggerAuditPayload): Promise<TriggerAuditResult> {
  if (!AUDIT_ENABLED()) {
    logger.info('Audit disabled via AUDIT_AGENT_ENABLED=false');
    return { started: false, reason: 'audit_disabled' };
  }

  const {
    repoFullName, repoName, projectName, commitSha,
    commitMessage, branchName, authorName, authorEmail, topicId,
  } = payload;

  if (!commitSha || !repoFullName) return { started: false, reason: 'missing_commit_or_repo' };

  // Phase 10 — repo lock guard
  const lock = await isRepoLocked(repoName).catch(() => null);
  if (lock) {
    logger.info({ repoName, reason: lock.reason }, 'Repo locked — audit skipped');
    return { started: false, reason: 'repo_locked' };
  }

  // Skip explicit opt-out prefixes
  const SKIP = ['[skip-audit]', '[no-audit]', 'chore:', 'docs:'];
  if (SKIP.some(p => (commitMessage || '').startsWith(p))) {
    logger.info({ repoName }, 'Audit skipped via commit message flag');
    return { started: false, reason: 'commit_message_flag' };
  }

  // Run all 4 rules
  const check = await checkAuditRules({
    repoFullName, repoName, authorName, authorEmail,
    branchName, commitMessage, topicId,
  });
  if (!check.pass) return { started: false, reason: check.reason };

  // Prevent duplicate cycles
  const active = await getActiveCycleForRepo(repoFullName);
  if (active) {
    logger.info({ repoFullName, cycleId: active.id }, 'Audit already active');
    return { started: false, reason: 'audit_already_active' };
  }

  // D-027 item 5 (multi-aspect audit + scoring + rotation) — which single
  // aspect this cycle's 10 tasks will focus on, per the repo's rotation state.
  const aspectState = await auditAspects.getCurrentAspect(repoName).catch((err: unknown) => {
    const error = getErrorInfo(err);
    logger.warn({ err: error.message, repoName }, 'Could not resolve audit aspect — proceeding without aspect focus');
    return null;
  });

  const cycle = await createAuditCycle({ repoFullName, commitSha, projectName, aspect: aspectState?.aspect });
  if (!cycle) {
    logger.warn({ repoFullName }, 'Could not create audit cycle');
    return { started: false, reason: 'cycle_creation_failed' };
  }

  logger.info({ repoFullName, cycleId: cycle.id, aspect: aspectState?.aspect }, 'Audit cycle started');

  await ensureProject({ repoFullName, repoName, displayName: projectName || repoName, currentPhase: 'audit', currentAuditAspect: aspectState?.aspect || null, lastCommitSha: commitSha, lastActivityAt: new Date().toISOString() }).catch(() => null);
  await recordEvent({ projectId: repoFullName, eventType: 'audit_started', sourceSystem: 'auditOrchestrator', sourceRef: commitSha, payload: { repoName, projectName, aspect: aspectState?.aspect || null } }).catch(() => null);

  // Get builder assignment from the project registry (projectDb.ts)
  let builderAgent = 'nvidia';
  try {
    const project = await findNotionProject(repoName);
    builderAgent = project?.builderAgent || 'nvidia';
  } catch (e: unknown) {
    const error = getErrorInfo(e);
    logger.warn({ err: error.message }, 'Could not read builder assignment — using nvidia');
  }

  const builderConfig = getBuilderConfig(builderAgent);

  await safeFire(sendTelegramMessage(
    `Project Sentinel — Audit Starting 🔍\n\nRepo: ${repoName}\nAnalyst: Claude Code\nBuilder assigned: ${builderConfig.label}`,
    repoName,
    topicId
  ), { label: 'auditOrchestrator' })

  // Run Claude Code audit — wrapped for performance tracking and self-healing
  let auditResult: AuditResult;
  try {
    auditResult = await trackModelCall(
      process.env['AUDIT_MODEL'] || 'nvidia',
      'audit',
      'medium',
      () => runAudit({
        repoFullName, repoName, projectName,
        commitSha, branchName: branchName || 'main',
        aspect: aspectState?.aspect,
      })
    );
    await reportSuccess('auditOrchestrator');
  } catch (err: unknown) {
    const error = getErrorInfo(err);
    await reportFailure('auditOrchestrator', err);
    logger.error({ err: error.stack ?? error.message, repoFullName }, 'Audit failed');
    await updateAuditCycle(cycle.id, { status: 'failed' });
    await safeFire(sendTelegramMessage(
      `Project Sentinel — Audit Failed ❌\n\nRepo: ${repoName}\nError: ${error.message.substring(0, 300)}`,
      repoName,
      topicId
    ), { label: 'auditOrchestrator' })
    await postAuditSummaryToGithub(repoFullName, branchName, `**Sentinel audit failed**\n\nError: ${error.message.substring(0, 500)}`);
    // A cycle WAS created (the process genuinely started) — it just failed
    // partway through, unlike the earlier early-returns where nothing began.
    return { started: true, reason: 'audit_run_failed' };
  }

  // Write tasks to Notion and PostgreSQL
  const notionProject = await findNotionProject(repoName).catch(() => null);

  const writeResult = await writeTasksToNotion(auditResult, cycle.id, {
    repoFullName, repoName, projectName, commitSha,
    notionParentPageId: notionProject?.pageId || null,
    builderAgent,
  });

  const safeCount  = auditResult.tasks.filter((t) => t.safeToAutoExecute).length;
  const totalCount = auditResult.tasks.length;
  const batchCount = Math.ceil(safeCount / BATCH_SIZE());

  await updateAuditCycle(cycle.id, {
    status:                'awaiting_approval',
    // createAuditCycle() sets audit_agent='nvidia' as its honest default
    // (see auditDb.ts) since ai/client.ts tries NVIDIA first — but if that
    // call actually failed over to a different provider (or this is the
    // Claude Code CLI path), auditResult.provider carries the real one, so
    // agentStandup.ts's per-agent audit counts attribute the cycle to
    // whichever engine actually produced it, not just whoever's first in
    // the fallback chain. Flagged by CodeRabbit on PR #72.
    audit_agent:           auditResult.provider || 'nvidia',
    health_score:          auditResult.overallHealthScore,
    audit_summary:         auditResult.auditSummary,
    tasks_total:           totalCount,
    tasks_safe:            safeCount,
    approval_sent_at:      new Date().toISOString(),
    aspect_health_score:   auditResult.aspectHealthScore ?? null,
    aspect_effect_summary: auditResult.aspectEffectSummary || null,
  });

  // D-027 item 5 — this cycle's aspect-focused sprint is done; advance the
  // rotation counter (and rotate to the next aspect once 3 sprints are hit).
  const aspectRotation = aspectState
    ? await auditAspects.recordSprintCompleted(repoName, aspectState.aspect).catch((err: unknown) => {
        const error = getErrorInfo(err);
        logger.warn({ err: error.message, repoName }, 'Could not record aspect sprint completion');
        return null;
      })
    : null;

  const EMOJI: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };

  // Priority breakdown — at-a-glance severity mix, not just a raw total.
  const priorityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const t of auditResult.tasks) priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
  const priorityBreakdown = (['critical', 'high', 'medium', 'low'] as const)
    .filter(p => (priorityCounts[p] ?? 0) > 0)
    .map(p => `${EMOJI[p]} ${priorityCounts[p]} ${p}`)
    .join('  ·  ');

  // Health trend vs. the last audit for this repo — an absolute "6/10" tells
  // you nothing about direction; the delta does.
  const previousHealthScore = await getPreviousHealthScore(repoFullName, cycle.id).catch(() => null);
  const healthTrend = previousHealthScore == null
    ? ''
    : (() => {
        const delta = auditResult.overallHealthScore - previousHealthScore;
        const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
        return ` (${arrow} ${delta > 0 ? '+' : ''}${delta} vs last audit)`;
      })();

  // D-027 item 5 — same trend treatment, but scoped to just this aspect
  // (e.g. "security" score history), plus the aspect's own trend vs. its
  // last audit (which may be several audit cycles back, since other
  // aspects rotate in between).
  let aspectReportLines: string[] = [];
  if (aspectState) {
    const previousAspectScore = await getPreviousAspectHealthScore(repoFullName, aspectState.aspect, cycle.id).catch(() => null);
    const aspectTrend = previousAspectScore == null
      ? ''
      : (() => {
          const delta = (auditResult.aspectHealthScore ?? auditResult.overallHealthScore) - previousAspectScore;
          const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
          return ` (${arrow} ${delta > 0 ? '+' : ''}${delta} vs last ${aspectState.aspect} audit)`;
        })();
    const sprintPosition = aspectRotation
      ? (aspectRotation.rotated
          ? `sprint 3/${auditAspects.SPRINTS_PER_ASPECT} — rotating to "${aspectRotation.aspect}" next`
          : `sprint ${aspectRotation.sprintCount}/${auditAspects.SPRINTS_PER_ASPECT}`)
      : '';
    aspectReportLines = [
      ``,
      `🎯 Aspect focus: ${aspectState.aspect}${sprintPosition ? ` (${sprintPosition})` : ''}`,
      `Aspect score: ${auditResult.aspectHealthScore ?? auditResult.overallHealthScore}/10${aspectTrend}`,
      auditResult.aspectEffectSummary ? `Effect: ${auditResult.aspectEffectSummary}` : '',
    ].filter(Boolean);
  }

  // Each task gets its category and, for locked (needs-review) tasks, the
  // safety reason the audit gave — that's the exact information a human
  // needs to actually decide whether to approve, not just "this one's
  // locked" with no context.
  const taskLines = auditResult.tasks.map((t) => {
    const lockNote = t.safeToAutoExecute
      ? ''
      : `\n   🔒 ${t.safetyReason || 'flagged for manual review'}`;
    return `${t.taskNumber}. ${EMOJI[t.priority] || '⚪'} [${t.category || 'general'}] ${t.title}${lockNote}`;
  }).join('\n');

  const failNote = writeResult.failed.length  > 0
    ? `\n⚠️ ${writeResult.failed.length} task(s) failed to save` : '';
  const skipNote = writeResult.skipped.length > 0
    ? `\n⚠️ ${writeResult.skipped.length} duplicate(s) skipped` : '';

  const auditText = [
    `Project Sentinel — Audit Complete 🔍`,
    ``,
    `Project: ${projectName || repoName}`,
    `Repo: ${repoName}`,
    `Commit: ${commitSha.substring(0, 7)}`,
    `Health Score: ${auditResult.overallHealthScore}/10${healthTrend}`,
    `Builder: ${builderConfig.label}`,
    ...aspectReportLines,
    ``,
    auditResult.auditSummary,
    ``,
    `${totalCount} tasks generated${priorityBreakdown ? ` (${priorityBreakdown})` : ''}:`,
    taskLines,
    ``,
    `🔓 Safe to auto-execute: ${safeCount} (${batchCount} batch${batchCount!==1?'es':''} of ${BATCH_SIZE()})`,
    `🔒 Needs manual review: ${totalCount - safeCount}`,
    failNote, skipNote,
    notionProject ? `\nNotion: ${notionProject.url}` : '',
  ].filter(l => l !== null).join('\n');

  // Telegram's real message length limit is 4096 chars. sendMenu() (used
  // below for the inline-button path) swallows its own axios errors
  // internally and never throws — so an oversized message wouldn't just
  // fail loudly, it would silently no-op with only a warn-level log, and
  // the try/catch fallback to sendTelegramMessage here would never fire
  // (nothing was thrown to catch). Truncating up front, the same way
  // sendTelegramMessage's own fallback already does, means this can't
  // silently swallow the whole report on a repo with many tasks/long
  // safety reasons.
  const TELEGRAM_MAX_LENGTH = 4096;
  const safeAuditText = auditText.length > TELEGRAM_MAX_LENGTH
    ? auditText.substring(0, TELEGRAM_MAX_LENGTH - 30) + '\n\n[message truncated]'
    : auditText;

  // Send with inline approval buttons
  try {
    const { sendMenu } = require('./telegramMenus');
    const chatId = process.env['TELEGRAM_CHAT_ID'];
    await sendMenu(chatId, topicId, safeAuditText, [
      [
        { text: `✅ Execute ${safeCount} safe tasks`, callback_data: `execute:${repoName}` },
        { text: `⏭ Skip`,                            callback_data: `skip:${repoName}`    },
      ],
    ]);
  } catch {
    await safeFire(sendTelegramMessage(safeAuditText, repoName, topicId), { label: 'auditOrchestrator' })
  }

  // Same buttons in Slack (Phase 1, docs/2026-07-22-slack-agent-roster-plan.md)
  // — no-op until Slack is configured, same safety property as every other
  // Slack call in this codebase. Deliberately not awaited or in the above
  // try/catch — a Slack failure must never affect the Telegram send.
  sendSlackButtons(safeAuditText, repoName, [
    [
      { text: `✅ Execute ${safeCount} safe tasks`, actionId: 'execute', value: repoName },
      { text: `⏭ Skip`,                            actionId: 'skip',    value: repoName },
    ],
  ]).catch((err: unknown) => {
    const error = getErrorInfo(err);
    logger.warn({ err: error.message, repoName }, 'Slack buttons fan-out failed (Telegram send unaffected)');
  });

  scheduleApprovalTimeout(cycle.id, repoFullName, repoName, topicId);
  logger.info({ repoFullName, cycleId: cycle.id, tasks: totalCount, safe: safeCount,
    batches: batchCount }, 'Audit complete — awaiting approval');
  await postAuditSummaryToGithub(repoFullName, branchName, safeAuditText);
  return { started: true };
}

// ── EXECUTE APPROVED TASKS ────────────────────────────────────────────────────

async function executeApprovedTasks(repoFullName: string, repoName: string, topicId: number | null): Promise<void> {
  if (!BUILDER_ENABLED()) {
    await safeFire(sendTelegramMessage(
      `Builder disabled (BUILDER_AGENT_ENABLED=false). Enable in Railway.`,
      repoName, topicId
    ), { label: 'auditOrchestrator' })
    return;
  }

  let active = await getActiveCycleForRepo(repoFullName);

  if (!active) {
    // No active cycle — check if there are any queued tasks we can still run
    const { query } = require('./dbClient');
    const queued = await query(`
      SELECT COUNT(*) as count FROM audit_tasks
      WHERE repo_full_name = $1 AND status = 'queued'
    `, [repoFullName]).catch(() => null);

    const queuedCount = parseInt(queued?.rows?.[0]?.count || '0');

    if (queuedCount === 0) {
      await safeFire(sendTelegramMessage([
        `No queued tasks for ${repoName}.`,
        `Run /sentinel audit ${repoName} to generate tasks first.`,
      ].join('\n'), repoName, topicId), { label: 'auditOrchestrator' })
      return;
    }

    // Tasks exist but no active cycle — create a synthetic one so execution can proceed
    const { createAuditCycle } = require('./auditDb');
    active = await createAuditCycle({
      repoFullName,
      commitSha:   `manual-execute-${Date.now()}`,
      projectName: repoName,
    }).catch(() => null);

    if (!active) {
      await safeFire(sendTelegramMessage(
        `Could not start execution cycle for ${repoName}. Try /sentinel audit ${repoName} first.`,
        repoName, topicId
      ), { label: 'auditOrchestrator' })
      return;
    }
  }

  await updateAuditCycle(active.id, {
    status: 'executing', approved_at: new Date().toISOString(),
  });

  logger.info({ repoFullName, cycleId: active.id }, 'Task execution approved');
  await processNextBatch(repoFullName, repoName, topicId);
}

async function processNextBatch(repoFullName: string, repoName: string, topicId: number | null): Promise<void> {
  const todayCount = await countTasksExecutedToday(repoFullName);
  if (todayCount >= DAILY_LIMIT()) {
    await safeFire(sendTelegramMessage(
      `Project Sentinel — Daily Limit ⏸️\n\nRepo: ${repoName}\nTasks today: ${todayCount}/${DAILY_LIMIT()}\nContinuing tomorrow.`,
      repoName,
      topicId
    ), { label: 'auditOrchestrator' })
    return;
  }

  const tasks = await getNextBatch(repoFullName, BATCH_SIZE());

  if (tasks.length === 0) {
    const cycle = await getActiveCycleForRepo(repoFullName);
    if (cycle) await updateAuditCycle(cycle.id, { status: 'complete' });
    await safeFire(sendTelegramMessage([
      `Project Sentinel — All Safe Tasks Complete ✅`,
      ``,
      `Repo: ${repoName}`,
      `Unsafe tasks remain in Notion for manual review.`,
      `Next audit available in ${await COOLDOWN_HOURS()}h after next human commit.`,
    ].join('\n'), repoName, topicId), { label: 'auditOrchestrator' })
    return;
  }

  for (const task of tasks) {
    await updateAuditTask(task.id, { status: 'in_progress' });
    await updateNotionTaskStatus(task.id, 'in_progress');
  }

  // tasks.length === 0 already returned above — tasks[0] is guaranteed to exist.
  const builderConfig = getBuilderConfig(tasks[0]!.builder_agent || 'nvidia');
  const batchNum      = tasks[0]!.batch_number;
  const taskTitles    = tasks.map((t) => `${t.task_number}. ${t.title}`).join('\n');

  await safeFire(sendTelegramMessage([
    `Project Sentinel — Executing Batch ${batchNum} 🔨`,
    ``,
    `Repo: ${repoName}`,
    `Tasks: ${tasks.length}`,
    `Builder: ${builderConfig.label}`,
    ``,
    taskTitles,
  ].join('\n'), repoName, topicId), { label: 'auditOrchestrator' })

  const notionProject = await findNotionProject(repoName).catch(() => null);

  // D-027 item 3 (same-PR patch loop) — reuse the repo's accumulating
  // Sentinel branch if one is already active (set below once a batch lands),
  // instead of opening a fresh branch/PR every single batch. Cleared in
  // processPREvent.ts once a human merges or closes the PR.
  const activeBranch = await projectDb.getActiveTaskBranch(repoName).catch((err: unknown) => {
    const error = getErrorInfo(err);
    logger.warn({ err: error.message, repoName }, 'Could not look up active task branch — starting a new one');
    return null;
  });

  const batchContext = {
    repoFullName, repoName,
    projectName: notionProject?.projectName || repoName,
    branchName:  'main',
    existingBranch: activeBranch?.branch,
    topicId,
  };

  const primaryBuilder  = tasks[0]!.builder_agent || 'nvidia';
  let   batchResult     = await executeBatch(tasks, batchContext, primaryBuilder);

  // T10 — retry with fallback builder on failure (once)
  if (batchResult.status !== 'completed') {
    const fallback = getFallbackBuilder(primaryBuilder);
    if (fallback) {
      logger.info({ primaryBuilder, fallback, repoFullName }, 'Primary builder failed — retrying with fallback');
      await safeFire(sendTelegramMessage(
        `Builder ${primaryBuilder} failed for ${repoName}. Retrying with ${fallback}...`,
        repoName, topicId
      ), { label: 'auditOrchestrator' })
      batchResult = await executeBatch(tasks, batchContext, fallback);
    }
  }

  if (batchResult.status === 'completed') {
    const completedNums = batchResult.completedTasks.map((t) => t.task_number).join(', ');

    const { prUrl, prNumber } = await createPullRequest({
      repoFullName,
      fixBranch:  batchResult.taskBranch,
      baseBranch: 'main',
      context: {
        projectName:   notionProject?.projectName || repoName,
        repoName, commitSha: batchResult.commitSha,
        attemptNumber: batchNum,
        buildProvider: 'sentinel-tasks',
        failureReason: activeBranch
          ? `Sentinel improvement batch ${batchNum} — tasks ${completedNums}`
          : `Sentinel improvement batch ${batchNum} — tasks ${completedNums} (new working branch)`,
        kind: 'task',
      },
    });

    await projectDb.setActiveTaskBranch(repoName, batchResult.taskBranch, prUrl, prNumber).catch((err: unknown) => {
      const error = getErrorInfo(err);
      logger.warn({ err: error.message, repoName, taskBranch: batchResult.taskBranch },
        'Could not record active task branch — next batch may open a new branch/PR instead of continuing this one');
    });

    // createPullRequest() swallows its own errors and returns null/null on
    // failure (rate limit, auth hiccup, transient GitHub 5xx) rather than
    // throwing — previously that fell straight into the "Batch Ready" success
    // path below with a blank PR line, silently marking real completed work
    // as build_check with no PR for any webhook to ever advance. The commits
    // are real and already pushed to batchResult.taskBranch, so this can't
    // just be re-queued (that would risk redoing already-committed tasks) —
    // surface it loudly so a human can open the PR manually from that branch.
    if (!prUrl) {
      logger.error({ repoFullName, taskBranch: batchResult.taskBranch },
        'PR creation failed after a successful batch — branch pushed, no PR opened');
      // fireAndForget, not safeFire+await: safeFire rethrows on rejection
      // when awaited, and this runs before the build_check task-status
      // updates a few lines below — a Telegram/network hiccup on THIS
      // alert must not also abort those DB writes and leave real completed
      // work (which is already pushed) without even a build_check record.
      // Confirmed as a real reachable failure mode by CodeRabbit + Qodo
      // (2026-07-31): every other alert in this file that has critical
      // state writes after it already uses fireAndForget for this reason;
      // this one didn't when first added.
      fireAndForget(sendTelegramMessage([
        `Project Sentinel — PR Creation Failed ⚠️`,
        ``,
        `Repo: ${repoName}`,
        `Batch ${batchNum} committed successfully (tasks ${completedNums}), but opening a PR failed — check GitHub API status/rate limits.`,
        `Branch: ${batchResult.taskBranch}`,
        `Open a PR manually from that branch on GitHub — merging it will still mark these tasks done (processPREvent.ts now also matches by branch name when pr_url/pr_number are null).`,
      ].join('\n'), repoName, topicId), { label: 'auditOrchestrator' })
    }

    // D-027 item 4 (self-review fallback) — if CodeRabbit hasn't found this
    // PR (not configured, or just hasn't gotten to it yet) within the same
    // delay window used for the human-commit audit fallback, Sentinel
    // reviews its own diff so the fix-loop has real findings to react to
    // instead of silently waiting on a reviewer that may never speak up.
    if (prNumber) {
      const fallbackDelayMin = parseInt(process.env['CODERABBIT_FALLBACK_DELAY_MIN'] || '45');
      await enqueueScheduledJob(
        SELF_REVIEW_FALLBACK_JOB,
        { repoFullName, repoName, prNumber, prUrl, topicId, pushedAt: new Date().toISOString() },
        fallbackDelayMin * 60 * 1000,
        `self-review-fallback:${repoFullName}:${prNumber}`
      ).catch((err: unknown) => {
        const error = getErrorInfo(err);
        logger.warn({ err: error.message, repoFullName, prNumber },
          'Failed to schedule self-review fallback — this PR will rely solely on CodeRabbit (if configured)');
      });
    }

    for (const task of batchResult.completedTasks) {
      await updateAuditTask(task.id, {
        status: 'build_check', branch_name: batchResult.taskBranch,
        commit_sha: batchResult.commitSha, commit_url: batchResult.commitUrl,
        pr_url: prUrl, pr_number: prNumber,
      });
      await updateNotionTaskStatus(task.id, 'build_check', {
        prUrl, commitUrl: batchResult.commitUrl,
      });
    }

    const skipped = tasks.filter(
      (t) => !batchResult.completedTasks.find((ct) => ct.id === t.id)
    );
    for (const task of skipped) {
      await updateAuditTask(task.id, { status: 'queued' });
      await updateNotionTaskStatus(task.id, 'queued');
    }

    await safeFire(sendTelegramMessage([
      `Project Sentinel — Batch ${batchNum} Ready ✅`,
      ``,
      `Repo: ${repoName}`,
      `Tasks completed: ${batchResult.completedTasks.length}/${tasks.length}`,
      `Builder: ${batchResult.builderUsed}`,
      ``,
      prUrl ? `PR: ${prUrl}` : '',
      ``,
      batchResult.remainingTasks > 0
        ? `Merge to continue. ${batchResult.remainingTasks} tasks remain.`
        : `Merge to finish. This is the final batch.`,
    ].filter(Boolean).join('\n'), repoName, topicId), { label: 'auditOrchestrator' })

  } else {
    // Re-queue all tasks so they can be retried — the builder failed (infra/API/aider),
    // not the tasks themselves. Marking them failed would silently destroy the queue.
    for (const task of tasks) {
      await updateAuditTask(task.id, { status: 'queued', failure_reason: null });
      await safeFire(updateNotionTaskStatus(task.id, 'queued'), { label: 'auditOrchestrator' })
    }

    // Show stdout (aider conversation) and stderr (errors/warnings) separately
    // so we can see both what the model did and what errors occurred.
    const stdoutTail = (batchResult.lastStdout || '').slice(-600);
    const stderrTail = (batchResult.lastStderr || '').slice(-400);
    const errDetail  = [
      stderrTail ? `stderr:\n${stderrTail}` : '',
      stdoutTail ? `stdout:\n${stdoutTail}` : '',
    ].filter(Boolean).join('\n\n').slice(-1000);
    await safeFire(sendTelegramMessage([
      `Project Sentinel — Batch ${batchNum} Failed ❌`,
      ``,
      `Repo: ${repoName}`,
      `Reason: ${batchResult.reason || 'Unknown'}`,
      errDetail ? `\nBuilder output:\n${errDetail}` : '',
      ``,
      `Tasks re-queued. /sentinel execute ${repoName} to retry.`,
    ].filter(Boolean).join('\n'), repoName, topicId), { label: 'auditOrchestrator' })

    // Also log to agent_messages so it's visible in the UI without Telegram
    const { logAgentMessage } = require('./agentDb');
    await safeFire(logAgentMessage(
      'sentinel', 'Sentinel',
      `Batch ${batchNum} failed for ${repoName}. Reason: ${batchResult.reason || 'Unknown'}${errDetail ? '\n\nBuilder output:\n' + errDetail : ''}`,
      'error', repoName
    ), { label: 'auditOrchestrator' })
  }
}

// ── CALLED WHEN BUILD PASSES AFTER SENTINEL PR IS MERGED ─────────────────────

async function handleBuildPassedAfterSentinelMerge(repoFullName: string, repoName: string,
                                                    branchName: string, topicId: number | null): Promise<void> {
  await markTasksDoneForBranch(repoFullName, branchName);

  // Always delegate to processNextBatch — it correctly marks the cycle
  // complete and notifies the user even when zero tasks remain.
  await processNextBatch(repoFullName, repoName, topicId);
}

// ── APPROVAL TIMEOUT ──────────────────────────────────────────────────────────

async function checkApprovalTimeout(cycleId: number, repoFullName: string, repoName: string, topicId: number | null): Promise<void> {
  const { query } = dbClient;

  // Atomic conditional UPDATE instead of SELECT-then-UPDATE: a separate
  // SELECT + UPDATE has a TOCTOU window where a human approval between the
  // two could flip the cycle's status, and this timeout would then
  // overwrite that approval as 'skipped'. Guarding the UPDATE itself on
  // status='awaiting_approval' means it only ever affects a cycle that is
  // still genuinely pending when the write happens.
  const r = await query(
    `UPDATE audit_cycles SET status = 'skipped'
     WHERE id = $1 AND status = 'awaiting_approval'
     RETURNING id`,
    [cycleId]
  );
  if (r.rows.length === 0) return;

  // Notification failure is non-fatal — the state transition above already
  // succeeded and must not be retried. A DB error above, by contrast, is
  // deliberately NOT caught here: this runs inside a BullMQ job handler,
  // and letting it throw lets BullMQ's own retry/backoff actually retry the
  // state transition instead of silently leaving the cycle stuck forever.
  await safeFire(sendTelegramMessage(
    `Project Sentinel — Audit Expired ⏱️\n\nRepo: ${repoName}\nNo response in ${APPROVAL_TIMEOUT_H()}h.\nTasks remain in Notion as Queued.\n/sentinel audit ${repoName} to re-audit.`,
    repoName,
    topicId
  ), { label: 'auditOrchestrator' })
}

// Persisted via BullMQ rather than a bare setTimeout — a bare 24h timer is
// lost on process restart (which this system triggers on its own merges),
// silently stranding the audit cycle in 'awaiting_approval' forever with no
// expiry ever firing.
function scheduleApprovalTimeout(cycleId: number, repoFullName: string, repoName: string, topicId: number | null): void {
  enqueueScheduledJob(
    AUDIT_APPROVAL_TIMEOUT_JOB,
    { cycleId, repoFullName, repoName, topicId },
    APPROVAL_TIMEOUT_H() * 60 * 60 * 1000,
    `audit-approval-timeout:${cycleId}`
  ).catch((err: unknown) => {
    const error = getErrorInfo(err);
    // Unlike a job handler failing (which BullMQ retries automatically),
    // this call happens inline in triggerAudit — if it fails, no expiry
    // timer for this cycle exists at all, silently, with nothing left to
    // retry it. A full "recover and re-arm" workflow is out of scope here;
    // at minimum, make the failure visible instead of a debug-only log line
    // so a human knows this cycle has no automatic expiry.
    logger.error({ err: error.message, cycleId }, 'Failed to schedule approval timeout — cycle has no automatic expiry');
    fireAndForget(sendTelegramMessage(
      `⚠️ Project Sentinel — could not schedule the approval timeout for ${repoName} (cycle ${cycleId}). This audit will not auto-expire; approve or skip it manually.`,
      repoName, topicId
    ), { label: 'auditOrchestrator' });
  });
}

export = {
  triggerAudit,
  executeApprovedTasks,
  processNextBatch,
  handleBuildPassedAfterSentinelMerge,
  checkApprovalTimeout,
  postAuditSummaryToGithub,
};

