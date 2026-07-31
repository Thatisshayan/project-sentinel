import logger from './logger';
import { cloneAndFix } from './aiderRunner';
import { createPullRequest } from './prCreator';
import { getDebugAttempt, createDebugAttempt, incrementAttempt, updateDebugAttempt } from './dbClient';
import { assessLogRisk, sanitizeLogs } from './riskAssessor';
import { sendTelegramMessage } from './telegramClient';
import { updateNotionProject, findNotionProject } from './notionClient';
import type { CloneResult } from './types/debugFix';
import type { DebugAttemptRow } from './types/debugAttemptRow';

interface DebugPayload {
  projectName?: string;
  repoName: string;
  repoFullName: string;
  branchName: string;
  commitSha: string;
  commitUrl?: string;
  commitMessage?: string;
  authorName?: string;
  changedFiles?: string[];
  buildProvider?: string;
  buildUrl?: string | null;
  logsUrl?: string | null;
  failureReason?: string | null;
  failureLogs?: string;
  topicId?: number | null;
}

const MAX_ATTEMPTS = (): number => parseInt(process.env['MAX_DEBUG_ATTEMPTS'] || '5');
const DRY_RUN      = (): boolean => process.env['DEBUGGER_DRY_RUN'] === 'true';

function selectAgent(attemptNumber: number): string {
  if (attemptNumber <= 3) return 'aider';
  return 'claude_code';
}

function getAgentLabel(agent: string): string {
  return agent === 'aider' ? 'Aider' : 'Claude Code';
}

async function orchestrateDebug(payload: DebugPayload): Promise<void> {
  const {
    projectName, repoName, repoFullName, branchName,
    commitSha, commitUrl, commitMessage, authorName,
    changedFiles, buildProvider, buildUrl, logsUrl,
    failureReason, failureLogs, topicId,
  } = payload;

  logger.info({ repoFullName, commitSha: commitSha?.slice(0, 7) }, 'Debug orchestration started');

  const existing = await getDebugAttempt(repoFullName, commitSha);
  if (existing && existing.status === 'stopped') {
    logger.info({ repoFullName }, 'Debug attempts stopped by human — skipping');
    return;
  }

  const logRisk  = assessLogRisk(sanitizeLogs(failureLogs ?? null), buildProvider || '');
  const fileRisk = (changedFiles || []).some((f: string) => {
    const lower = f.toLowerCase();
    return ['.env', 'secret', 'auth', 'payment', 'billing', 'migration',
            'dockerfile', 'railway.toml', 'vercel.json', '.github/workflows']
      .some((p: string) => lower.includes(p));
  });

  if (logRisk.isHighRisk || fileRisk) {
    const reason = logRisk.reason || 'Changed files include high-risk patterns';

    await sendTelegramMessage(
      buildHighRiskMessage({ projectName, repoName, branchName, commitSha,
                           buildProvider, buildUrl, failureReason, reason }),
      repoName,
      topicId
    );

    await updateNotionForHighRisk(repoFullName, commitSha, {
      failureReason, buildProvider, buildUrl, reason,
    });

    logger.warn({ repoFullName, reason }, 'High-risk failure — debug blocked');
    return;
  }

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
      repoName,
      topicId
    );
    await updateDebugAttempt(repoFullName, commitSha, { status: 'exhausted' });
    await updateNotionState(repoFullName, 'Broken — Human Required');
    return;
  }

  const nextAttemptNum = attempt.attempt_number + 1;
  const agent          = selectAgent(nextAttemptNum);
  const agentLabel     = getAgentLabel(agent);

  await incrementAttempt(repoFullName, commitSha, agent);
  await updateNotionState(repoFullName, 'Debugging');

  await sendTelegramMessage(
    buildStartingMessage({ projectName, repoName, attemptNumber: nextAttemptNum,
                           max, agentLabel }),
    repoName,
    topicId
  );

  if (DRY_RUN()) {
    logger.info({ repoFullName, attemptNumber: nextAttemptNum }, 'DRY RUN — no changes made');
    await sendTelegramMessage(
      buildDryRunMessage({ projectName, repoName, attemptNumber: nextAttemptNum,
                           agentLabel, failureReason: sanitizeLogs(failureReason || '') }),
      repoName,
      topicId
    );
    await updateDebugAttempt(repoFullName, commitSha, { status: 'dry_run' });
    return;
  }

  const fixContext = {
    projectName, repoName, repoFullName, branchName,
    commitSha, changedFiles, buildProvider, buildUrl,
    failureReason:  sanitizeLogs(failureReason || ''),
    failureLogs:    sanitizeLogs(failureLogs   || ''),
    attemptNumber:  nextAttemptNum,
    agentLabel,
  };

  let fixResult: CloneResult;
  try {
    fixResult = await cloneAndFix(fixContext);
  } catch (err) {
    logger.error({ err: (err as Error).stack ?? (err as Error).message }, 'cloneAndFix threw unexpectedly');
    fixResult = { status: 'error', reason: (err as Error).message };
  }

  if (fixResult.status === 'fixed') {
    const { prUrl, prNumber } = await createPullRequest({
      repoFullName,
      fixBranch:  fixResult.fixBranch || '',
      baseBranch: branchName,
      context: {
        projectName, repoName, commitSha,
        attemptNumber: nextAttemptNum,
        buildProvider, failureReason,
      },
    });

    if (!prUrl) {
      // createPullRequest() swallows its own errors and returns prUrl: null
      // on failure instead of throwing. Marking 'fix_pending' here (same
      // class of gap as auditOrchestrator.ts/sprintOrchestrator.ts, fixed
      // alongside this) would leave the attempt stuck forever — nothing
      // resolves fix_pending except a merged PR, and there's no PR. The fix
      // commit is real and pushed to fixResult.fixBranch, so treat this as
      // a failed attempt (consumes a retry, matches the else-branch below)
      // rather than a silent stall with a misleading "Fix Ready" message.
      logger.error({ repoFullName, fixBranch: fixResult.fixBranch, commitSha },
        'PR creation failed after a successful debug fix — branch pushed, no PR opened');
      await updateDebugAttempt(repoFullName, commitSha, {
        // cloneAndFix() already pushed a real commit+branch before PR
        // creation was attempted — persist those structured pointers
        // (matching what the success path below stores) instead of
        // dropping them, so manual recovery has something to work from.
        fix_commit_sha: fixResult.commitSha,
        fix_branch:     fixResult.fixBranch,
        status:         'failed',
        failure_reason: `Fix committed but PR creation failed — branch pushed: ${fixResult.fixBranch}. Open a PR manually.`,
      });
      await sendTelegramMessage(
        buildCannotFixMessage({
          projectName, repoName, attemptNumber: nextAttemptNum, agentLabel,
          reason: `Fix committed successfully, but PR creation failed (check GitHub API status/rate limits). Branch: ${fixResult.fixBranch} — open a PR manually.`,
          attemptsLeft: max - nextAttemptNum,
        }),
        repoName, topicId
      );
      // Mirror the sibling else-branch's exhausted-attempt handling below —
      // without this, a PR-creation failure on the LAST allowed attempt
      // would leave the Notion project state stuck at 'Debugging' forever,
      // since no new debug event refires for the same commitSha once an
      // unmerged fix branch already exists for it.
      if (nextAttemptNum >= max) {
        await updateNotionState(repoFullName, 'Broken — Human Required');
      }
      return;
    }

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
      repoName,
      topicId
    );

  } else {
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
      repoName,
      topicId
    );

    if (nextAttemptNum >= max) {
      await updateNotionState(repoFullName, 'Broken — Human Required');
    }
  }
}

interface HighRiskNotionData {
  failureReason?: string | null;
  buildProvider?: string;
  buildUrl?: string | null;
  reason: string;
}

async function updateNotionForHighRisk(repoFullName: string, commitSha: string, data: HighRiskNotionData): Promise<void> {
  try {
    const repoName = repoFullName.split('/')[1] || '';
    const project  = await findNotionProject(repoName);
    if (!project) return;

    await updateNotionProject(project.pageId, {
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
    logger.warn({ err: (err as Error).message }, 'Could not update Notion for high-risk failure');
  }
}

interface NotionStateExtra {
  fix_commit_url?: string;
  fix_pr_url?: string | null;
  fix_branch?: string;
  debugger_used?: string;
  attempt_number?: number;
}

async function updateNotionState(repoFullName: string, state: string, extra: NotionStateExtra = {}): Promise<void> {
  try {
    const repoName = repoFullName.split('/')[1] || '';
    const project  = await findNotionProject(repoName);
    if (!project) return;

    await updateNotionProject(project.pageId, {
      currentProjectState: state,
      ...extra,
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message, state }, 'Could not update Notion state');
  }
}

interface HighRiskMessageData {
  projectName?: string;
  repoName: string;
  branchName: string;
  commitSha: string;
  buildProvider?: string;
  buildUrl?: string | null;
  failureReason?: string | null;
  reason: string;
}

function buildHighRiskMessage(d: HighRiskMessageData): string {
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
  ].filter((l: string) => l !== '').join('\n');
}

interface StartingMessageData {
  projectName?: string;
  repoName: string;
  attemptNumber: number;
  max: number;
  agentLabel: string;
}

function buildStartingMessage(d: StartingMessageData): string {
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

interface DryRunMessageData {
  projectName?: string;
  repoName: string;
  attemptNumber: number;
  agentLabel: string;
  failureReason?: string;
}

function buildDryRunMessage(d: DryRunMessageData): string {
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

interface FixReadyMessageData {
  projectName?: string;
  repoName: string;
  attemptNumber: number;
  agentLabel: string;
  fixResult: CloneResult;
  prUrl: string | null;
  prNumber: number | null;
}

function buildFixReadyMessage(d: FixReadyMessageData): string {
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
  ].filter((l: string) => l !== '').join('\n');
}

interface CannotFixMessageData {
  projectName?: string;
  repoName: string;
  attemptNumber: number;
  agentLabel: string;
  reason?: string;
  attemptsLeft: number;
}

function buildCannotFixMessage(d: CannotFixMessageData): string {
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

interface ExhaustedMessageData {
  projectName?: string;
  repoName: string;
  branchName: string;
  commitUrl?: string;
  attempt: DebugAttemptRow;
  buildUrl?: string | null;
}

function buildExhaustedMessage(d: ExhaustedMessageData): string {
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
  ].filter((l: string) => l !== '').join('\n');
}

export = { orchestrateDebug };

