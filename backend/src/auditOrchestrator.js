const logger = require('./logger');
const { runAudit }           = require('./claudeCodeAudit');
const { writeTasksToNotion,
        updateNotionTaskStatus } = require('./auditTaskWriter');
const { executeBatch }       = require('./taskBuilder');
const { createPullRequest }  = require('./prCreator');
const { sendTelegramMessage } = require('./telegramClient');
const { findNotionProject }   = require('./notionClient');
const {
  createAuditCycle, updateAuditCycle,
  getActiveCycleForRepo, getLastCompletedAudit,
  getQueuedTaskCount, getNextBatch,
  updateAuditTask, countTasksExecutedToday,
  stopAllTasksForRepo, markTasksDoneForBranch,
} = require('./auditDb');
const { getBuilderConfig, getFallbackBuilder } = require('./builderRouter');
const { reportFailure, reportSuccess } = require('./selfHealer');
const { trackModelCall }               = require('./performanceTracker');
const { isRepoLocked }                 = require('./repoLock');

const AUDIT_ENABLED      = () => process.env.AUDIT_AGENT_ENABLED   !== 'false';
const BUILDER_ENABLED    = () => process.env.BUILDER_AGENT_ENABLED !== 'false';

let getEffectiveBatchSize, getEffectiveDailyLimit;
try {
  ({ getEffectiveBatchSize, getEffectiveDailyLimit } = require('./selfScaler'));
} catch {
  getEffectiveBatchSize  = () => parseInt(process.env.TASK_BATCH_SIZE           || '5');
  getEffectiveDailyLimit = () => parseInt(process.env.MAX_BUILDER_TASKS_PER_DAY || '10');
}

const BATCH_SIZE  = () => getEffectiveBatchSize();
const DAILY_LIMIT = () => getEffectiveDailyLimit();
const COOLDOWN_HOURS     = () => parseInt(process.env.AUDIT_COOLDOWN_HOURS        || '12');
const QUEUED_THRESHOLD   = () => parseInt(process.env.MIN_QUEUED_BEFORE_SKIP_AUDIT || '3');
const APPROVAL_TIMEOUT_H = () => parseInt(process.env.AUDIT_APPROVAL_TIMEOUT_H    || '24');

// ── THE 4 LOOP-PREVENTION RULES ───────────────────────────────────────────────

async function checkAuditRules(data) {
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
    await sendTelegramMessage(
      `Project Sentinel — Audit Skipped ⏭️\n\nRepo: ${repoName}\n${queuedCount} tasks still in queue.\nAudit will run when queue clears.`,
      null,
      topicId
    ).catch(() => {});
    return { pass: false, reason: 'tasks_queued' };
  }

  // RULE 3 — 12-hour cooldown (max 2 audits per day)
  const lastAudit = await getLastCompletedAudit(repoFullName);
  if (lastAudit) {
    const hoursSince = (Date.now() - new Date(lastAudit.created_at).getTime()) / 3600000;
    if (hoursSince < COOLDOWN_HOURS()) {
      logger.info({ repoName, hoursSince: Math.round(hoursSince) },
        'Rule 3: Cooldown active — audit skipped');
      return { pass: false, reason: 'cooldown' };
    }
  }

  return { pass: true };
}

// ── MAIN AUDIT TRIGGER ────────────────────────────────────────────────────────

async function triggerAudit(payload) {
  if (!AUDIT_ENABLED()) {
    logger.info('Audit disabled via AUDIT_AGENT_ENABLED=false');
    return;
  }

  const {
    repoFullName, repoName, projectName, commitSha,
    commitMessage, branchName, authorName, authorEmail, topicId,
  } = payload;

  if (!commitSha || !repoFullName) return;

  // Phase 10 — repo lock guard
  const lock = await isRepoLocked(repoName).catch(() => null);
  if (lock) {
    logger.info({ repoName, reason: lock.reason }, 'Repo locked — audit skipped');
    return;
  }

  // Skip explicit opt-out prefixes
  const SKIP = ['[skip-audit]', '[no-audit]', 'chore:', 'docs:'];
  if (SKIP.some(p => (commitMessage || '').startsWith(p))) {
    logger.info({ repoName }, 'Audit skipped via commit message flag');
    return;
  }

  // Run all 4 rules
  const check = await checkAuditRules({
    repoFullName, repoName, authorName, authorEmail,
    branchName, commitMessage, topicId,
  });
  if (!check.pass) return;

  // Prevent duplicate cycles
  const active = await getActiveCycleForRepo(repoFullName);
  if (active) {
    logger.info({ repoFullName, cycleId: active.id }, 'Audit already active');
    return;
  }

  const cycle = await createAuditCycle({ repoFullName, commitSha, projectName });
  if (!cycle) { logger.warn({ repoFullName }, 'Could not create audit cycle'); return; }

  logger.info({ repoFullName, cycleId: cycle.id }, 'Audit cycle started');

  // Get builder assignment from Notion
  let builderAgent = 'nvidia';
  try {
    const project = await findNotionProject(repoName);
    builderAgent = project?.builderAgent || 'nvidia';
  } catch (e) {
    logger.warn({ err: e.message }, 'Could not read builder from Notion — using nvidia');
  }

  const builderConfig = getBuilderConfig(builderAgent);

  await sendTelegramMessage(
    `Project Sentinel — Audit Starting 🔍\n\nRepo: ${repoName}\nAnalyst: Claude Code\nBuilder assigned: ${builderConfig.label}`,
    null,
    topicId
  ).catch(() => {});

  // Run Claude Code audit — wrapped for performance tracking and self-healing
  let auditResult;
  try {
    auditResult = await trackModelCall(
      process.env.AUDIT_MODEL || 'nvidia',
      'audit',
      'medium',
      () => runAudit({
        repoFullName, repoName, projectName,
        commitSha, commitMessage, branchName: branchName || 'main',
      })
    );
    await reportSuccess('auditOrchestrator');
  } catch (err) {
    await reportFailure('auditOrchestrator', err);
    logger.error({ err: err.message, repoFullName }, 'Audit failed');
    await updateAuditCycle(cycle.id, { status: 'failed' });
    await sendTelegramMessage(
      `Project Sentinel — Audit Failed ❌\n\nRepo: ${repoName}\nError: ${err.message.substring(0, 300)}`,
      null,
      topicId
    ).catch(() => {});
    return;
  }

  // Write tasks to Notion and PostgreSQL
  const notionProject = await findNotionProject(repoName).catch(() => null);

  const writeResult = await writeTasksToNotion(auditResult, cycle.id, {
    repoFullName, repoName, projectName, commitSha,
    notionParentPageId: notionProject?.pageId || null,
    builderAgent,
  });

  const safeCount  = auditResult.tasks.filter(t => t.safeToAutoExecute).length;
  const totalCount = auditResult.tasks.length;
  const batchCount = Math.ceil(safeCount / BATCH_SIZE());

  await updateAuditCycle(cycle.id, {
    status:           'awaiting_approval',
    health_score:     auditResult.overallHealthScore,
    audit_summary:    auditResult.auditSummary,
    tasks_total:      totalCount,
    tasks_safe:       safeCount,
    approval_sent_at: new Date().toISOString(),
  });

  const EMOJI = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
  const taskLines = auditResult.tasks.map(t =>
    `${t.taskNumber}. ${EMOJI[t.priority]||'⚪'} ${t.title}${t.safeToAutoExecute?'':' 🔒'}`
  ).join('\n');

  const failNote = writeResult.failed.length  > 0
    ? `\n⚠️ ${writeResult.failed.length} task(s) failed to write to Notion` : '';
  const skipNote = writeResult.skipped.length > 0
    ? `\n⚠️ ${writeResult.skipped.length} duplicate(s) skipped` : '';

  const auditText = [
    `Project Sentinel — Audit Complete 🔍`,
    ``,
    `Project: ${projectName || repoName}`,
    `Repo: ${repoName}`,
    `Commit: ${commitSha.substring(0, 7)}`,
    `Health Score: ${auditResult.overallHealthScore}/10`,
    `Builder: ${builderConfig.label}`,
    ``,
    auditResult.auditSummary,
    ``,
    `${totalCount} tasks generated:`,
    taskLines,
    ``,
    `🔓 Safe to auto-execute: ${safeCount} (${batchCount} batch${batchCount!==1?'es':''} of ${BATCH_SIZE()})`,
    `🔒 Needs manual review: ${totalCount - safeCount}`,
    failNote, skipNote,
    notionProject ? `\nNotion: ${notionProject.url}` : '',
  ].filter(l => l !== null).join('\n');

  // Send with inline approval buttons
  try {
    const { sendMenu } = require('./telegramMenus');
    const chatId = process.env.TELEGRAM_CHAT_ID;
    await sendMenu(chatId, topicId, auditText, [
      [
        { text: `✅ Execute ${safeCount} safe tasks`, callback_data: `execute:${repoName}` },
        { text: `⏭ Skip`,                            callback_data: `skip:${repoName}`    },
      ],
    ]);
  } catch {
    await sendTelegramMessage(auditText, null, topicId).catch(() => {});
  }

  scheduleApprovalTimeout(cycle.id, repoFullName, repoName, topicId);
  logger.info({ repoFullName, cycleId: cycle.id, tasks: totalCount, safe: safeCount,
    batches: batchCount }, 'Audit complete — awaiting approval');
}

// ── EXECUTE APPROVED TASKS ────────────────────────────────────────────────────

async function executeApprovedTasks(repoFullName, repoName, topicId) {
  if (!BUILDER_ENABLED()) {
    await sendTelegramMessage(
      `Builder disabled (BUILDER_AGENT_ENABLED=false). Enable in Railway.`,
      null, topicId
    ).catch(() => {});
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
      await sendTelegramMessage([
        `No queued tasks for ${repoName}.`,
        `Run /sentinel audit ${repoName} to generate tasks first.`,
      ].join('\n'), null, topicId).catch(() => {});
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
      await sendTelegramMessage(
        `Could not start execution cycle for ${repoName}. Try /sentinel audit ${repoName} first.`,
        null, topicId
      ).catch(() => {});
      return;
    }
  }

  await updateAuditCycle(active.id, {
    status: 'executing', approved_at: new Date().toISOString(),
  });

  logger.info({ repoFullName, cycleId: active.id }, 'Task execution approved');
  await processNextBatch(repoFullName, repoName, topicId);
}

async function processNextBatch(repoFullName, repoName, topicId) {
  const todayCount = await countTasksExecutedToday(repoFullName);
  if (todayCount >= DAILY_LIMIT()) {
    await sendTelegramMessage(
      `Project Sentinel — Daily Limit ⏸️\n\nRepo: ${repoName}\nTasks today: ${todayCount}/${DAILY_LIMIT()}\nContinuing tomorrow.`,
      null,
      topicId
    ).catch(() => {});
    return;
  }

  const tasks = await getNextBatch(repoFullName, BATCH_SIZE());

  if (tasks.length === 0) {
    const cycle = await getActiveCycleForRepo(repoFullName);
    if (cycle) await updateAuditCycle(cycle.id, { status: 'complete' });
    await sendTelegramMessage([
      `Project Sentinel — All Safe Tasks Complete ✅`,
      ``,
      `Repo: ${repoName}`,
      `Unsafe tasks remain in Notion for manual review.`,
      `Next audit available in ${COOLDOWN_HOURS()}h after next human commit.`,
    ].join('\n'), null, topicId).catch(() => {});
    return;
  }

  for (const task of tasks) {
    await updateAuditTask(task.id, { status: 'in_progress' });
    await updateNotionTaskStatus(task.notion_page_id, 'in_progress');
  }

  const builderConfig = getBuilderConfig(tasks[0].builder_agent || 'nvidia');
  const batchNum      = tasks[0].batch_number;
  const taskTitles    = tasks.map(t => `${t.task_number}. ${t.title}`).join('\n');

  await sendTelegramMessage([
    `Project Sentinel — Executing Batch ${batchNum} 🔨`,
    ``,
    `Repo: ${repoName}`,
    `Tasks: ${tasks.length}`,
    `Builder: ${builderConfig.label}`,
    ``,
    taskTitles,
  ].join('\n'), null, topicId).catch(() => {});

  const notionProject = await findNotionProject(repoName).catch(() => null);

  const primaryBuilder  = tasks[0].builder_agent || 'nvidia';
  let   batchResult     = await executeBatch(tasks, {
    repoFullName, repoName,
    projectName: notionProject?.projectName || repoName,
    branchName:  'main',
    topicId,
  }, primaryBuilder);

  // T10 — retry with fallback builder on failure (once)
  if (batchResult.status !== 'completed') {
    const fallback = getFallbackBuilder(primaryBuilder);
    if (fallback) {
      logger.info({ primaryBuilder, fallback, repoFullName }, 'Primary builder failed — retrying with fallback');
      await sendTelegramMessage(
        `Builder ${primaryBuilder} failed for ${repoName}. Retrying with ${fallback}...`,
        null, topicId
      ).catch(() => {});
      batchResult = await executeBatch(tasks, {
        repoFullName, repoName,
        projectName: notionProject?.projectName || repoName,
        branchName:  'main',
        topicId,
      }, fallback);
    }
  }

  if (batchResult.status === 'completed') {
    const completedNums = batchResult.completedTasks.map(t => t.task_number).join(', ');

    const { prUrl, prNumber } = await createPullRequest({
      repoFullName,
      fixBranch:  batchResult.taskBranch,
      baseBranch: 'main',
      context: {
        projectName:   notionProject?.projectName || repoName,
        repoName, commitSha: batchResult.commitSha,
        attemptNumber: batchNum,
        buildProvider: 'sentinel-tasks',
        failureReason: `Sentinel improvement batch ${batchNum} — tasks ${completedNums}`,
      },
    });

    for (const task of batchResult.completedTasks) {
      await updateAuditTask(task.id, {
        status: 'build_check', branch_name: batchResult.taskBranch,
        commit_sha: batchResult.commitSha, commit_url: batchResult.commitUrl,
        pr_url: prUrl, pr_number: prNumber,
      });
      await updateNotionTaskStatus(task.notion_page_id, 'build_check', {
        prUrl, commitUrl: batchResult.commitUrl,
      });
    }

    const skipped = tasks.filter(
      t => !batchResult.completedTasks.find(ct => ct.id === t.id)
    );
    for (const task of skipped) {
      await updateAuditTask(task.id, { status: 'queued' });
      await updateNotionTaskStatus(task.notion_page_id, 'queued');
    }

    await sendTelegramMessage([
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
    ].filter(Boolean).join('\n'), null, topicId).catch(() => {});

  } else {
    for (const task of tasks) {
      await updateAuditTask(task.id, {
        status: 'failed',
        failure_reason: (batchResult.reason || 'Unknown').substring(0, 500),
      });
      await updateNotionTaskStatus(task.notion_page_id, 'failed', {
        failureReason: batchResult.reason,
      });
    }

    await sendTelegramMessage([
      `Project Sentinel — Batch ${batchNum} Failed ❌`,
      ``,
      `Repo: ${repoName}`,
      `Reason: ${batchResult.reason || 'Unknown'}`,
      ``,
      `/sentinel retry ${repoName} — retry batch`,
      `/sentinel skip-batch ${repoName} ${batchNum} — skip and continue`,
    ].join('\n'), null, topicId).catch(() => {});
  }
}

// ── CALLED WHEN BUILD PASSES AFTER SENTINEL PR IS MERGED ─────────────────────

async function handleBuildPassedAfterSentinelMerge(repoFullName, repoName,
                                                    branchName, topicId) {
  await markTasksDoneForBranch(repoFullName, branchName);

  const remainingTasks = await getNextBatch(repoFullName, 1);
  if (remainingTasks.length > 0) {
    await processNextBatch(repoFullName, repoName, topicId);
  }
}

// ── APPROVAL TIMEOUT ──────────────────────────────────────────────────────────

function scheduleApprovalTimeout(cycleId, repoFullName, repoName, topicId) {
  setTimeout(async () => {
    try {
      const { query } = require('./dbClient');
      const r = await query(
        'SELECT * FROM audit_cycles WHERE id=$1 AND status=$2',
        [cycleId, 'awaiting_approval']
      );
      if (r.rows.length === 0) return;
      await updateAuditCycle(cycleId, { status: 'skipped' });
      await sendTelegramMessage(
        `Project Sentinel — Audit Expired ⏱️\n\nRepo: ${repoName}\nNo response in ${APPROVAL_TIMEOUT_H()}h.\nTasks remain in Notion as Queued.\n/sentinel audit ${repoName} to re-audit.`,
        null,
        topicId
      ).catch(() => {});
    } catch (err) {
      logger.warn({ err: err.message }, 'Approval timeout handler error');
    }
  }, APPROVAL_TIMEOUT_H() * 60 * 60 * 1000);
}

module.exports = {
  triggerAudit,
  executeApprovedTasks,
  processNextBatch,
  handleBuildPassedAfterSentinelMerge,
};
