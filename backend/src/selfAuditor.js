const logger = require('./logger');
const axios  = require('axios');
const { repoFullName } = require('./repoResolver');
const { sendTelegramMessage }      = require('./telegramClient');
const { runAudit }                 = require('./claudeCodeAudit');
const { writeTasksToNotion }       = require('./auditTaskWriter');
const { createAuditCycle,
        updateAuditCycle }         = require('./auditDb');
const { createSelfAuditCycle,
        updateSelfAuditCycle }     = require('./selfAuditDb');

const SENTINEL_NAME = 'project-sentinel';
const SENTINEL_REPO = repoFullName(SENTINEL_NAME);

async function runSelfAudit() {
  logger.info('Starting Sentinel self-audit');

  const selfCycle = await createSelfAuditCycle();

  try {
    const commitRes = await axios.get(
      `https://api.github.com/repos/${SENTINEL_REPO}/commits/main`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept:        'application/vnd.github+json',
        },
        timeout: 15000,
      }
    );
    const commitSha = commitRes.data.sha;

    await sendTelegramMessage([
      `🛡️ Sentinel Self-Audit Starting`,
      ``,
      `Nemotron is auditing Sentinel's own codebase.`,
      `This is Phase 7 — Sentinel improves itself.`,
    ].join('\n'), null, null).catch(() => {});

    const auditResult = await runAudit({
      repoFullName:  SENTINEL_REPO,
      repoName:      SENTINEL_NAME,
      projectName:   'Project Sentinel',
      commitSha,
      commitMessage: 'Self-audit',
      branchName:    'main',
    });

    // Create an audit_cycles row so /sentinel self-approve can find it
    const auditCycle = await createAuditCycle({
      repoFullName: SENTINEL_REPO,
      commitSha,
      projectName:  'Project Sentinel',
    });

    const writeResult = await writeTasksToNotion(auditResult, auditCycle?.id || null, {
      repoFullName:       SENTINEL_REPO,
      repoName:           SENTINEL_NAME,
      projectName:        'Project Sentinel',
      commitSha,
      notionParentPageId: null,
      builderAgent:       'nvidia',
      source:             'Sentinel Self-Audit',
    });

    if (auditCycle) {
      const safeCount = auditResult.tasks.filter(t => t.safeToAutoExecute).length;
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

    const safeCount = auditResult.tasks.filter(t => t.safeToAutoExecute).length;
    const taskLines = auditResult.tasks.map((t, i) =>
      `${i + 1}. [${t.priority}] ${t.title}`
    ).join('\n');

    await sendTelegramMessage([
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
    ].join('\n'), null, null).catch(() => {});

    logger.info(
      { cycleId: selfCycle.id, tasks: auditResult.tasks.length, score: auditResult.overallHealthScore },
      'Self-audit complete'
    );

  } catch (err) {
    logger.error({ err: err.message }, 'Self-audit failed');
    await updateSelfAuditCycle(selfCycle.id, { status: 'failed' }).catch(() => {});
    await sendTelegramMessage(
      `🛡️ Sentinel Self-Audit Failed\n\nError: ${err.message.substring(0, 200)}`,
      null, null
    ).catch(() => {});
  }
}

module.exports = { runSelfAudit };
