const logger             = require('./logger');
const { cloneAndFix }    = require('./aiderRunner');
const { createPullRequest } = require('./prCreator');
const {
  getDebugAttempt,
  createDebugAttempt,
  incrementAttempt,
  updateDebugAttempt,
} = require('./dbClient');
const { assessLogRisk, sanitizeLogs } = require('./riskAssessor');
const { sendTelegramMessage }          = require('./telegramClient');
const { updateNotionProject, findNotionProject } = require('./notionClient');

const MAX_ATTEMPTS = () => parseInt(process.env.MAX_DEBUG_ATTEMPTS || '5');
const DRY_RUN      = () => process.env.DEBUGGER_DRY_RUN === 'true';

// ── Agent selection ───────────────────────────────────────────────────────────
// Attempt 1-3: Aider with configured model
// Attempt 4-5: Claude Code (fallback)

function selectAgent(attemptNumber) {
  if (attemptNumber <= 3) return 'aider';
  return 'claude_code';
}

function getAgentLabel(agent) {
  return agent === 'aider' ? 'Aider' : 'Claude Code';
}

// ── Main orchestration entry point ────────────────────────────────────────────

async function orchestrateDebug(payload) {
  const {
    projectName, repoName, repoFullName, branchName,
    commitSha, commitUrl, commitMessage, authorName,
    changedFiles, buildProvider, buildUrl, logsUrl,
    failureReason, failureLogs, topicId,
  } = payload;

  logger.info({ repoFullName, commitSha: commitSha?.slice(0, 7) }, 'Debug orchestration started');

  // ── 1. Check if already stopped ───────────────────────────────────────────
  const existing = await getDebugAttempt(repoFullName, commitSha);
  if (existing && existing.status === 'stopped') {
    logger.info({ repoFullName }, 'Debug attempts stopped by human — skipping');
    return;
  }

  // ── 2. High-risk assessment ───────────────────────────────────────────────
  const logRisk  = assessLogRisk(sanitizeLogs(failureLogs), buildProvider);
  const fileRisk = (changedFiles || []).some(f => {
    const lower = f.toLowerCase();
    return ['.env', 'secret', 'auth', 'payment', 'billing', 'migration',
            'dockerfile', 'railway.toml', 'vercel.json', '.github/workflows']
      .some(p => lower.includes(p));
  });

  if (logRisk.isHighRisk || fileRisk) {
    const reason = logRisk.reason || 'Changed files include high-risk patterns';

    await sendTelegramMessage(
      buildHighRiskMessage({ projectName, repoName, branchName, commitSha,
                             buildProvider, buildUrl, failureReason, reason }),
      topicId
    );

    await updateNotionForHighRisk(repoFullName, commitSha, {
      failureReason, buildProvider, buildUrl, reason,
    });

    logger.warn({ repoFullName, reason }, 'High-risk failure — debug blocked');
    return;
  }

  // ── 3. Check retry count ──────────────────────────────────────────────────
  let attempt = existing;
  const max   = MAX_ATTEMPTS();

  if (!attempt) {
    attempt = await createDebugAttempt({
      repoFullName, commitSha, buildProvider, buildUrl,
      failureReason: sanitizeLogs(failureReason || '').substring(0, 500),
    });
  }

  if (!attempt) {
    logger.error({ repoFullName }, 'Could not create debug attempt record');
    return;
  }

  if (attempt.attempt_number >= max) {
    await sendTelegramMessage(
      buildExhaustedMessage({ projectName, repoName, branchName, commitUrl,
                              attempt, buildUrl }),
      topicId
    );
    await updateDebugAttempt(repoFullName, commitSha, { status: 'exhausted' });
    await updateNotionState(repoFullName, 'Broken — Human Required');
    return;
  }

  // ── 4. Select agent and increment counter ─────────────────────────────────
  const nextAttemptNum = attempt.attempt_number + 1;
  const agent          = selectAgent(nextAttemptNum);
  const agentLabel     = getAgentLabel(agent);

  await incrementAttempt(repoFullName, commitSha, agent);
  await updateNotionState(repoFullName, 'Debugging');

  // ── 5. Send "starting" Telegram ───────────────────────────────────────────
  await sendTelegramMessage(
    buildStartingMessage({ projectName, repoName, attemptNumber: nextAttemptNum,
                           max, agentLabel }),
    topicId
  );

  // ── 6. Dry-run mode ───────────────────────────────────────────────────────
  if (DRY_RUN()) {
    logger.info({ repoFullName, attemptNumber: nextAttemptNum }, 'DRY RUN — no changes made');
    await sendTelegramMessage(
      buildDryRunMessage({ projectName, repoName, attemptNumber: nextAttemptNum,
                           agentLabel, failureReason: sanitizeLogs(failureReason || '') }),
      topicId
    );
    await updateDebugAttempt(repoFullName, commitSha, { status: 'dry_run' });
    return;
  }

  // ── 7. Run the debugger ───────────────────────────────────────────────────
  const fixContext = {
    projectName, repoName, repoFullName, branchName,
    commitSha, changedFiles, buildProvider, buildUrl,
    failureReason:  sanitizeLogs(failureReason || ''),
    failureLogs:    sanitizeLogs(failureLogs   || ''),
    attemptNumber:  nextAttemptNum,
    agentLabel,
  };

  let fixResult;
  try {
    fixResult = await cloneAndFix(fixContext);
  } catch (err) {
    logger.error({ err: err.message }, 'cloneAndFix threw unexpectedly');
    fixResult = { status: 'error', reason: err.message };
  }

  // ── 8. Handle result ──────────────────────────────────────────────────────
  if (fixResult.status === 'fixed') {
    // Create PR
    const { prUrl, prNumber } = await createPullRequest({
      repoFullName,
      fixBranch:  fixResult.fixBranch,
      baseBranch: branchName,
      context: {
        projectName, repoName, commitSha,
        attemptNumber: nextAttemptNum,
        buildProvider, failureReason,
      },
    });

    await updateDebugAttempt(repoFullName, commitSha, {
      fix_commit_sha: fixResult.commitSha,
      fix_branch:     fixResult.fixBranch,
      fix_pr_url:     prUrl,
      status:         'fix_pending',
    });

    await updateNotionState(repoFullName, 'Fix Pending', {
      fix_commit_url: `https://github.com/${repoFullName}/commit/${fixResult.commitSha}`,
      fix_pr_url:     prUrl,
      fix_branch:     fixResult.fixBranch,
      debugger_used:  agentLabel,
      attempt_number: nextAttemptNum,
    });

    await sendTelegramMessage(
      buildFixReadyMessage({
        projectName, repoName, attemptNumber: nextAttemptNum,
        agentLabel, fixResult, prUrl, prNumber,
      }),
      topicId
    );

  } else {
    // cannot_fix or error
    await updateDebugAttempt(repoFullName, commitSha, {
      status:         'failed',
      failure_reason: fixResult.reason?.substring(0, 500),
    });

    const attemptsLeft = max - nextAttemptNum;

    await sendTelegramMessage(
      buildCannotFixMessage({
        projectName, repoName, attemptNumber: nextAttemptNum,
        agentLabel, reason: fixResult.reason, attemptsLeft,
      }),
      topicId
    );

    // If attempts remain, the next build failure event will re-trigger
    if (nextAttemptNum >= max) {
      await updateNotionState(repoFullName, 'Broken — Human Required');
    }
  }
}

// ── Notion helpers ────────────────────────────────────────────────────────────

async function updateNotionForHighRisk(repoFullName, commitSha, data) {
  try {
    const repoName = repoFullName.split('/')[1];
    const project  = await findNotionProject(repoName);
    if (!project) return;

    await updateNotionProject(project.pageId, {
      commitSha,
      commitMessage:       '',
      commitUrl:           '',
      branchName:          '',
      authorName:          '',
      commitTimestamp:     new Date().toISOString(),
      changedFilesText:    '',
      filesChangedCount:   0,
      riskLevel:           'High',
      deploymentStatus:    'failed',
      lastBuildError:      data.failureReason?.substring(0, 500) || '',
      buildProvider:       data.buildProvider,
      buildUrl:            data.buildUrl,
      highRiskFlag:        'Yes',
      highRiskReason:      data.reason,
      currentProjectState: 'Broken — Human Required',
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not update Notion for high-risk failure');
  }
}

async function updateNotionState(repoFullName, state, extra = {}) {
  try {
    const repoName = repoFullName.split('/')[1];
    const project  = await findNotionProject(repoName);
    if (!project) return;

    await updateNotionProject(project.pageId, {
      commitSha:           '',
      commitMessage:       '',
      commitUrl:           '',
      branchName:          '',
      authorName:          '',
      commitTimestamp:     new Date().toISOString(),
      changedFilesText:    '',
      filesChangedCount:   0,
      riskLevel:           'Medium',
      currentProjectState: state,
      ...extra,
    });
  } catch (err) {
    logger.warn({ err: err.message, state }, 'Could not update Notion state');
  }
}

// ── Telegram message builders ─────────────────────────────────────────────────

function buildHighRiskMessage(d) {
  return [
    `Project Sentinel — High-Risk Failure ⛔`,
    ``,
    `Project: ${d.projectName}`,
    `Repo: ${d.repoName}`,
    `Branch: ${d.branchName}`,
    `Commit: ${(d.commitSha || '').substring(0, 7)}`,
    `Build provider: ${d.buildProvider}`,
    d.buildUrl ? `Build URL: ${d.buildUrl}` : '',
    ``,
    `Failure reason: ${d.failureReason || 'Unknown'}`,
    ``,
    `⚠️ Automatic repair is blocked.`,
    `Reason: ${d.reason}`,
    ``,
    `Human review required before any changes are made.`,
  ].filter(l => l !== '').join('\n');
}

function buildStartingMessage(d) {
  return [
    `Project Sentinel — Debugger Starting 🛠️`,
    ``,
    `Project: ${d.projectName}`,
    `Repo: ${d.repoName}`,
    `Attempt: ${d.attemptNumber}/${d.max}`,
    `Agent: ${d.agentLabel}`,
    ``,
    `Reading failure logs and diagnosing root cause...`,
  ].join('\n');
}

function buildDryRunMessage(d) {
  return [
    `Project Sentinel — Dry Run 🧪`,
    ``,
    `Project: ${d.projectName}`,
    `Repo: ${d.repoName}`,
    `Attempt: ${d.attemptNumber}/5 (DRY RUN — no changes made)`,
    `Agent: ${d.agentLabel}`,
    ``,
    `Failure: ${d.failureReason}`,
    ``,
    `No commits were made.`,
    `Set DEBUGGER_DRY_RUN=false in Railway to enable live execution.`,
  ].join('\n');
}

function buildFixReadyMessage(d) {
  const files = (d.fixResult.filesChanged || []).slice(0, 5).join(', ');
  return [
    `Project Sentinel — Fix Ready for Review 🔧`,
    ``,
    `Project: ${d.projectName}`,
    `Repo: ${d.repoName}`,
    `Attempt: ${d.attemptNumber}/5`,
    `Agent: ${d.agentLabel}`,
    ``,
    `Files changed: ${files || 'Unknown'}`,
    ``,
    d.prUrl    ? `Pull Request: ${d.prUrl}` : '',
    ``,
    `Merge the PR to re-trigger the build check.`,
    `Sentinel will mark resolved when the build passes.`,
  ].filter(l => l !== '').join('\n');
}

function buildCannotFixMessage(d) {
  return [
    `Project Sentinel — Cannot Fix ⚠️`,
    ``,
    `Project: ${d.projectName}`,
    `Repo: ${d.repoName}`,
    `Attempt: ${d.attemptNumber}/5`,
    `Agent: ${d.agentLabel}`,
    ``,
    `Reason: ${d.reason || 'Unknown'}`,
    ``,
    d.attemptsLeft > 0
      ? `${d.attemptsLeft} attempt(s) remaining — will retry on next build event.`
      : `All attempts exhausted. Human review required.`,
  ].join('\n');
}

function buildExhaustedMessage(d) {
  return [
    `Project Sentinel — Needs Human Help 🚨`,
    ``,
    `Project: ${d.projectName}`,
    `Repo: ${d.repoName}`,
    `Branch: ${d.branchName}`,
    d.commitUrl ? `Original commit: ${d.commitUrl}` : '',
    ``,
    `Attempts used: ${d.attempt?.attempt_number || 5}/5`,
    `Last agent: ${d.attempt?.debugger_used || 'Unknown'}`,
    ``,
    `Automatic repair stopped.`,
    `Human review required.`,
    d.buildUrl ? `Build: ${d.buildUrl}` : '',
  ].filter(l => l !== '').join('\n');
}

module.exports = { orchestrateDebug };
