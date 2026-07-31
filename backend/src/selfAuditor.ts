import { safeFire, fireAndForget } from './utils/safeFire';
import logger from './logger';
import axios from 'axios';
import { repoFullName } from './repoResolver';
import { sendTelegramMessage } from './telegramClient';
import { runAudit } from './claudeCodeAudit';
import { writeTasksToNotion } from './auditTaskWriter';
import { createAuditCycle, updateAuditCycle } from './auditDb';
import { createSelfAuditCycle, updateSelfAuditCycle } from './selfAuditDb';
import { getDefaultBranch } from './repoDiscovery';

const SENTINEL_NAME = 'project-sentinel';
const SENTINEL_REPO = repoFullName(SENTINEL_NAME);

async function runSelfAudit(): Promise<void> {
  logger.info('Starting Sentinel self-audit');

  const selfCycle = await createSelfAuditCycle();

  try {
    // Resolve the branch first so the SHA we fetch is for the same branch
    // we tell runAudit to check out — previously this always fetched
    // /commits/main while branchName came from getDefaultBranch(), so a repo
    // whose default branch isn't 'main' (e.g. 'develop') paired the wrong
    // branch name with a main-branch SHA. Confirmed as a real bug by
    // CodeRabbit (2026-07-29).
    const branchName = await getDefaultBranch(SENTINEL_REPO).catch(() => 'main');
    const commitRes = await axios.get(
      `https://api.github.com/repos/${SENTINEL_REPO}/commits/${branchName}`,
      {
        headers: {
          Authorization: `Bearer ${process.env['GITHUB_TOKEN']}`,
          Accept:        'application/vnd.github+json',
        },
        timeout: 15000,
      }
    );
    const commitSha = commitRes.data.sha;

    await safeFire(sendTelegramMessage([
      `🛡️ Sentinel Self-Audit Starting`,
      ``,
      `Nemotron is auditing Sentinel's own codebase.`,
      `This is Phase 7 — Sentinel improves itself.`,
    ].join('\n'), null, null), { label: 'selfAuditor' })

    const auditResult = await runAudit({
      repoFullName: SENTINEL_REPO,
      repoName:     SENTINEL_NAME,
      projectName:  'Project Sentinel',
      commitSha,
      branchName,
    });

    const cycleSha = `${commitSha}-self-${Date.now()}`;
    const auditCycle = await createAuditCycle({
      repoFullName: SENTINEL_REPO,
      commitSha:    cycleSha,
      projectName:  'Project Sentinel',
    });
    if (!auditCycle) {
      // audit_tasks.audit_cycle_id is NOT NULL — without a cycle row there is
      // nowhere to attach tasks (Postgres is the source of truth since D-025,
      // not Notion), so every task write below would fail individually with
      // the same DB error. Fail loud once instead of 10 silent per-task ones.
      logger.error({ cycleSha }, 'Could not create self-audit cycle — aborting self-audit, no tasks written');
      await safeFire(updateSelfAuditCycle(selfCycle.id, { status: 'failed' }), { label: 'selfAuditor' })
      await safeFire(sendTelegramMessage(
        '🛡️ Sentinel Self-Audit — could not create an audit cycle. No tasks were written. Check logs.',
        null, null
      ), { label: 'selfAuditor' })
      return;
    }

    const writeResult = await writeTasksToNotion(auditResult, auditCycle.id, {
      repoFullName:       SENTINEL_REPO,
      repoName:           SENTINEL_NAME,
      projectName:        'Project Sentinel',
      commitSha,
      notionParentPageId: null,
      builderAgent:       'qwen_coder',
      source:             'Sentinel Self-Audit',
    });

    if (auditCycle) {
      const safeCount = auditResult.tasks.filter((t) => t.safeToAutoExecute).length;
      await updateAuditCycle(auditCycle.id, {
        status:           'awaiting_approval',
        health_score:     auditResult.overallHealthScore,
        audit_summary:    auditResult.auditSummary,
        tasks_total:      auditResult.tasks.length,
        tasks_safe:       safeCount,
        approval_sent_at: new Date().toISOString(),
      });
    }

    await updateSelfAuditCycle(selfCycle.id, {
      status:          'complete',
      health_score:    auditResult.overallHealthScore,
      audit_summary:   auditResult.auditSummary,
      tasks_generated: auditResult.tasks.length,
      completed_at:    new Date().toISOString(),
    });

    const safeCount = auditResult.tasks.filter((t) => t.safeToAutoExecute).length;
    const taskLines = auditResult.tasks.map((t, i) =>
      `${i + 1}. [${t.priority}] ${t.title}`
    ).join('\n');

    await safeFire(sendTelegramMessage([
      `🛡️ Sentinel Self-Audit Complete`,
      ``,
      `Health Score: ${auditResult.overallHealthScore}/10`,
      ``,
      auditResult.auditSummary,
      ``,
      `${auditResult.tasks.length} self-improvement tasks:`,
      taskLines,
      ``,
      `Safe to auto-execute: ${safeCount}/${auditResult.tasks.length}`,
      ``,
      `⚠️ These tasks modify Sentinel itself.`,
      `Review carefully before approving.`,
      ``,
      `/sentinel self-approve — execute safe tasks`,
      `/sentinel skip project-sentinel — skip this cycle`,
    ].join('\n'), null, null), { label: 'selfAuditor' })

    logger.info(
      { cycleId: selfCycle.id, tasks: auditResult.tasks.length, score: auditResult.overallHealthScore },
      'Self-audit complete'
    );

  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'Self-audit failed');
    await safeFire(updateSelfAuditCycle(selfCycle.id, { status: 'failed' }), { label: 'selfAuditor' })
    await safeFire(sendTelegramMessage(
      `🛡️ Sentinel Self-Audit Failed\n\nError: ${err.message.substring(0, 200)}`,
      null, null
    ), { label: 'selfAuditor' })
  }
}

export = { runSelfAudit };

