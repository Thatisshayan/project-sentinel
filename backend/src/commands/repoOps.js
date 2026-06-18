const logger              = require('../logger');
const { repoFullName }    = require('../repoResolver');
const { sendTelegramMessage } = require('../telegramClient');
const { findNotionProject }   = require('../notionClient');
const { stopDebugAttempts }   = require('../dbClient');
const {
  executeApprovedTasks,
  triggerAudit,
  processNextBatch,
} = require('../auditOrchestrator');
const {
  stopAllTasksForRepo,
  updateAuditTask,
} = require('../auditDb');
const { getAllAgents } = require('../agentDb');

// ── Handler helpers ───────────────────────────────────────────────────────────

async function handleStop(projectArg, topicId) {
  if (!projectArg) {
    await sendTelegramMessage('Usage: /sentinel stop <repo-name>', null, topicId);
    return true;
  }
  try {
    await stopDebugAttempts(projectArg);
    await sendTelegramMessage(
      `✅ Debug attempts stopped for: ${projectArg}\nNo further automatic fixes will run.`,
      null, topicId
    );
  } catch (err) {
    await sendTelegramMessage(`❌ Error stopping: ${err.message}`, null, topicId);
  }
  return true;
}

async function handleStatus(projectArg, topicId) {
  if (!projectArg) {
    await sendTelegramMessage('Usage: /sentinel status <repo-name>', null, topicId);
    return true;
  }
  try {
    const project = await findNotionProject(projectArg);
    if (!project) {
      await sendTelegramMessage(`No Notion project found for: ${projectArg}`, null, topicId);
      return true;
    }
    await sendTelegramMessage(
      `Project: ${project.projectName}\nNotion: ${project.url}`,
      null, topicId
    );
  } catch (err) {
    await sendTelegramMessage(`❌ Error: ${err.message}`, null, topicId);
  }
  return true;
}

async function handleBuilds(projectArg, topicId) {
  if (!projectArg) {
    await sendTelegramMessage('Usage: /sentinel builds <repo-name>', null, topicId);
    return true;
  }
  try {
    const project = await findNotionProject(projectArg);
    if (!project) {
      await sendTelegramMessage(`No project found for: ${projectArg}`, null, topicId);
      return true;
    }
    await sendTelegramMessage(
      `Checking builds for ${projectArg}...\n\nNote: Provide a commit SHA for detailed status.\nCheck GitHub Actions / Vercel / Railway directly for latest build.`,
      null, topicId
    );
  } catch (err) {
    await sendTelegramMessage(`❌ Error: ${err.message}`, null, topicId);
  }
  return true;
}

async function handleRetry(projectArg, topicId) {
  if (!projectArg) {
    await sendTelegramMessage('Usage: /sentinel retry <repo-name>', null, topicId);
    return true;
  }
  await sendTelegramMessage(
    `Manual retry for ${projectArg} is noted.\nPush a new commit to trigger the full loop, or check the latest build manually.`,
    null, topicId
  );
  return true;
}

async function handleHelp(topicId, chatId) {
  const { sendMenu } = require('../telegramMenus');
  await sendMenu(chatId, topicId, '🛡️ Project Sentinel — Command Reference', [
    [
      { text: '📊 Reports & Data',    callback_data: 'help:reports'   },
      { text: '🤖 Agents & Bots',     callback_data: 'help:agents'    },
    ],
    [
      { text: '🔨 Repos & Execution', callback_data: 'help:repos'     },
      { text: '🏃 Sprint & Planning', callback_data: 'help:sprint'    },
    ],
    [
      { text: '🔒 Security',          callback_data: 'help:security'  },
      { text: '⚙️ System & Control',  callback_data: 'help:system'    },
    ],
    [
      { text: '📖 Full Command List', callback_data: 'help:full'      },
    ],
  ]);
  return true;
}

async function handleExecute(repoArg, topicId) {
  if (!repoArg) {
    await sendTelegramMessage('Usage: /sentinel execute <repo-name>', null, topicId);
    return true;
  }
  await sendTelegramMessage(`Starting task execution for ${repoArg}...`, null, topicId);
  executeApprovedTasks(repoFullName(repoArg), repoArg, topicId)
    .catch(err => logger.error({ err: err.message }, 'Execute failed'));
  return true;
}

async function handleSkipAudit(repoArg, topicId) {
  await stopAllTasksForRepo(repoFullName(repoArg));
  await sendTelegramMessage(
    `Audit skipped for ${repoArg}. Tasks remain in Notion as Queued.`,
    null, topicId
  );
  return true;
}

async function handleManualAudit(repoArg, topicId) {
  if (!repoArg) {
    await sendTelegramMessage('Usage: /sentinel audit <repo-name>', null, topicId);
    return true;
  }
  const project = await findNotionProject(repoArg).catch(() => null);
  await sendTelegramMessage(`Manual audit triggered for ${repoArg}...`, null, topicId);
  triggerAudit({
    repoFullName:  repoFullName(repoArg),
    repoName:      repoArg,
    projectName:   project?.projectName || repoArg,
    commitSha:     `manual-${Date.now()}`,
    commitMessage: '[manual-audit]',
    branchName:    'main',
    authorName:    'Human',
    authorEmail:   '',
    topicId,
  }).catch(err => logger.error({ err: err.message }, 'Manual audit failed'));
  return true;
}

async function handleListTasks(repoArg, topicId, chatId) {
  if (!repoArg) {
    await sendTelegramMessage('Usage: /sentinel tasks <repo-name>', null, topicId);
    return true;
  }
  const { query } = require('../dbClient');
  const r = await query(`
    SELECT id, task_number, title, priority, status,
           safe_to_auto_execute, batch_number
    FROM audit_tasks
    WHERE repo_full_name=$1
      AND status IN ('queued','in_progress','failed','build_check')
    ORDER BY task_number ASC LIMIT 12
  `, [repoFullName(repoArg)]);

  if (r.rows.length === 0) {
    await sendTelegramMessage(`No active tasks for ${repoArg}.`, null, topicId);
    return true;
  }

  const EMOJI = { critical:'🔴', high:'🟠', medium:'🟡', low:'🟢' };
  const list  = r.rows.map(t =>
    `${t.task_number}. [B${t.batch_number}] ${EMOJI[t.priority]||'⚪'} ${t.title} — ${t.status}${t.safe_to_auto_execute?'':' 🔒'}`
  ).join('\n');

  await sendTelegramMessage(`Tasks for ${repoArg}:\n\n${list}\n\n🔒 = needs approval`, null, topicId);

  const unsafe = r.rows.filter(t => !t.safe_to_auto_execute && t.status === 'queued');
  if (unsafe.length > 0 && chatId) {
    const { sendMenu } = require('../telegramMenus');
    const buttons = unsafe.map(t => [
      { text: `✅ #${t.task_number}: ${t.title.substring(0, 28)}`, callback_data: `task-approve:${t.id}` },
      { text: '⏭️ Skip', callback_data: `task-skip:${t.id}` },
    ]);
    buttons.push([
      { text: '✅ Approve All & Run', callback_data: `task-approve-all:${repoFullName(repoArg)}` },
    ]);
    await sendMenu(chatId, topicId, `🔒 ${unsafe.length} task(s) need your approval:`, buttons);
  }

  return true;
}

async function handleSkipBatch(repoArg, batchNumArg, topicId) {
  if (!repoArg || !batchNumArg) {
    await sendTelegramMessage(
      'Usage: /sentinel skip-batch <repo-name> <batch-number>', null, topicId
    );
    return true;
  }
  const { query } = require('../dbClient');
  const r = await query(`
    SELECT id FROM audit_tasks
    WHERE repo_full_name=$1
      AND batch_number=$2
      AND status IN ('queued','in_progress')
  `, [repoFullName(repoArg), parseInt(batchNumArg)]);

  for (const row of r.rows) {
    await updateAuditTask(row.id, { status: 'skipped' });
  }

  await sendTelegramMessage(
    `Batch ${batchNumArg} skipped for ${repoArg}. Moving to next batch...`,
    null, topicId
  );
  processNextBatch(repoFullName(repoArg), repoArg, topicId).catch(() => {});
  return true;
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

async function handleRepoOpsCmd(subcommand, parts, chatId, topicId) {
  // Canonicalize the repo arg so "/sentinel audit Tapcash" and "/sentinel audit
  // tapcash" resolve to the same repoFullName instead of fragmenting locks,
  // audit cycles, and tasks across two differently-cased tracking identities.
  if (parts[2]) {
    const { canonicalizeRepoName } = require('../repoResolver');
    const canon = canonicalizeRepoName(parts[2]);
    if (canon) parts[2] = canon.repoName;
  }

  switch (subcommand) {
    case 'stop':
      return handleStop(parts[2], topicId);
    case 'status':
      return handleStatus(parts[2], topicId);
    case 'builds':
      return handleBuilds(parts[2], topicId);
    case 'retry':
      return handleRetry(parts[2], topicId);
    case 'help':
      return handleHelp(topicId, chatId);
    case 'execute':
      return handleExecute(parts[2], topicId);
    case 'skip':
      if (parts[2]) return handleSkipAudit(parts[2], topicId);
      await sendTelegramMessage('Usage: /sentinel skip <repo-name>', null, topicId);
      return true;
    case 'audit':
      return handleManualAudit(parts[2], topicId);
    case 'tasks':
      return handleListTasks(parts[2], topicId, chatId);
    case 'skip-batch':
      return handleSkipBatch(parts[2], parts[3], topicId);

    case 'lock': {
      if (!parts[2]) { await sendTelegramMessage('Usage: /sentinel lock <repo>', null, topicId); return true; }
      const { lockRepo } = require('../repoLock');
      await lockRepo(parts[2], 'manual');
      await sendTelegramMessage(
        `🔐 ${parts[2]} locked. No agents will touch it until /sentinel unlock ${parts[2]}`,
        null, topicId
      );
      return true;
    }
    case 'unlock': {
      if (!parts[2]) { await sendTelegramMessage('Usage: /sentinel unlock <repo>', null, topicId); return true; }
      const { unlockRepo } = require('../repoLock');
      await unlockRepo(parts[2]);
      await sendTelegramMessage(`🔓 ${parts[2]} unlocked.`, null, topicId);
      return true;
    }
    case 'locked': {
      const { getAllLocked } = require('../repoLock');
      const locked = await getAllLocked();
      if (locked.length === 0) {
        await sendTelegramMessage('No repos currently locked.', null, topicId);
        return true;
      }
      const lines = locked.map(l =>
        `🔐 ${l.repoName} — ${l.reason} (since ${new Date(l.lockedAt).toLocaleTimeString('en-CA')})`
      );
      await sendTelegramMessage(lines.join('\n'), null, topicId);
      return true;
    }
    case 'health': {
      const { getPortfolioSummary } = require('../portfolioAnalytics');
      const s = await getPortfolioSummary().catch(() => null);
      if (!s) { await sendTelegramMessage('Portfolio data unavailable.', null, topicId); return true; }
      const lines = [...s.metrics]
        .sort((a, b) => parseFloat(a.health_score) - parseFloat(b.health_score))
        .map(m => {
          const score = parseFloat(m.health_score);
          const dot   = score >= 7 ? '🟢' : score >= 5 ? '🟡' : '🔴';
          return `${dot} ${m.repo_name}: ${m.health_score}/10`;
        });
      await sendTelegramMessage(`Portfolio Health\n\n${lines.join('\n')}`, null, topicId);
      return true;
    }
    case 'what': {
      const working = (await getAllAgents().catch(() => [])).filter(a => a.status === 'working');
      if (working.length === 0) {
        await sendTelegramMessage('Sentinel is idle. No active agent tasks.', null, topicId);
        return true;
      }
      const lines = working.map(a =>
        `· ${a.agent_label} → ${a.repo_full_name?.split('/')[1]} — ${a.task_title}`
      );
      await sendTelegramMessage(`🤖 Active right now:\n\n${lines.join('\n')}`, null, topicId);
      return true;
    }
    case 'force-execute': {
      if (!parts[2]) {
        await sendTelegramMessage('Usage: /sentinel force-execute <repo>', null, topicId);
        return true;
      }
      const { query: dbQuery } = require('../dbClient');
      const updated = await dbQuery(`
        UPDATE audit_tasks SET safe_to_auto_execute = true
        WHERE repo_full_name = $1 AND status = 'queued'
        RETURNING id
      `, [repoFullName(parts[2])]).catch(() => null);
      const count = updated?.rows?.length || 0;
      await sendTelegramMessage(
        `Unlocked ${count} tasks for ${parts[2]}. Starting execution...`, null, topicId
      );
      if (count > 0) {
        executeApprovedTasks(repoFullName(parts[2]), parts[2], topicId)
          .catch(err => logger.error({ err: err.message }, 'Force-execute failed'));
      }
      return true;
    }
    case 'security': {
      const { getOpenIssues, getLatestSecurityScore, getPortfolioSecuritySummary } = require('../securityDb');
      if (parts[2]) {
        const [score, issues] = await Promise.all([
          getLatestSecurityScore(parts[2]),
          getOpenIssues(repoFullName(parts[2])),
        ]);
        const counts = {
          critical: issues.filter(i => i.severity === 'critical').length,
          high:     issues.filter(i => i.severity === 'high').length,
          medium:   issues.filter(i => i.severity === 'medium').length,
          low:      issues.filter(i => i.severity === 'low').length,
        };
        await sendTelegramMessage([
          `🔒 Security — ${parts[2]}`,
          `Score: ${score?.score || 'N/A'}/10`,
          ``,
          `🔴 Critical: ${counts.critical}`,
          `🟠 High: ${counts.high}`,
          `🟡 Medium: ${counts.medium}`,
          `🟢 Low: ${counts.low}`,
          ``,
          issues.slice(0, 5).map(i => `  · [${i.severity}] ${i.title}`).join('\n'),
          ``,
          `/sentinel security-scan ${parts[2]} — fresh scan`,
          `/sentinel security-patch ${parts[2]} — auto-fix safe issues`,
        ].join('\n'), null, topicId);
      } else {
        const portfolio = await getPortfolioSecuritySummary();
        const lines = portfolio
          .sort((a, b) => parseFloat(a.score) - parseFloat(b.score))
          .map(r => `${r.repo_name}: ${r.score}/10 (${r.critical_count || 0} critical)`);
        await sendTelegramMessage(
          `🔒 Portfolio Security\n\n${lines.join('\n') || 'No security data yet.'}`,
          null, topicId
        );
      }
      return true;
    }
    case 'security-scan': {
      if (!parts[2]) {
        await sendTelegramMessage('Usage: /sentinel security-scan <repo>', null, topicId);
        return true;
      }
      const { runSecurityScan } = require('../securityScanner');
      await sendTelegramMessage(`Running security scan on ${parts[2]}...`, null, topicId);
      runSecurityScan({
        repoFullName: repoFullName(parts[2]),
        repoName: parts[2], commitSha: 'HEAD', topicId,
      }).catch(() => {});
      return true;
    }
    case 'security-patch': {
      if (!parts[2]) {
        await sendTelegramMessage('Usage: /sentinel security-patch <repo>', null, topicId);
        return true;
      }
      const { getOpenIssues: getIssues } = require('../securityDb');
      const { applySecurityPatches }     = require('../securityPatcher');
      const patchIssues = await getIssues(repoFullName(parts[2]));
      applySecurityPatches(repoFullName(parts[2]), parts[2], patchIssues, topicId).catch(() => {});
      return true;
    }
    case 'security-approve': {
      await sendTelegramMessage(
        `Security approval for ${parts[2] || 'repo'} noted.\nReview and merge the open PR on GitHub.`,
        null, topicId
      );
      return true;
    }
    case 'webhook-status': {
      const { query: dbq } = require('../dbClient');
      const [seen, allMetrics] = await Promise.all([
        dbq(`
          SELECT repo_name, MAX(processed_at) as last_seen, COUNT(*) as events
          FROM processed_commits
          WHERE processed_at > NOW() - INTERVAL '7 days'
          GROUP BY repo_name
          ORDER BY last_seen DESC
          LIMIT 20
        `).catch(() => ({ rows: [] })),
        dbq(`SELECT DISTINCT repo_name FROM portfolio_metrics`).catch(() => ({ rows: [] })),
      ]);

      const seenNames = new Set(seen.rows.map(r => r.repo_name.toLowerCase()));
      const allNames  = allMetrics.rows.map(r => r.repo_name.toLowerCase());
      const missing   = allNames.filter(n => !seenNames.has(n));

      const receivingLines = seen.rows.map(r =>
        `✅ ${r.repo_name} — last event ${new Date(r.last_seen).toLocaleDateString('en-CA')} (${r.events} events)`
      );
      const missingLines = missing.map(n => `❌ ${n} — no webhook events in 7 days`);

      await sendTelegramMessage([
        `Webhook Status (last 7 days)`,
        ``,
        ...receivingLines,
        ...(missingLines.length ? ['', 'Missing webhooks:', ...missingLines] : []),
        ``,
        `For missing repos: GitHub repo → Settings → Webhooks → Add`,
        `URL: ${process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/webhook/github` : '<RAILWAY_URL>/webhook/github'}`,
        `Events: push, pull_request`,
      ].join('\n'), null, topicId);
      return true;
    }
    case 'brain': {
      const { runStrategicBrain } = require('../sentinelBrain');
      await sendTelegramMessage('🧠 Running strategic brain...', null, topicId);
      runStrategicBrain(topicId).catch(err =>
        logger.error({ err: err.message }, 'Manual brain run failed')
      );
      return true;
    }
    case 'menu': {
      const { showMainMenu } = require('../telegramMenus');
      await showMainMenu(chatId, topicId);
      return true;
    }
    case 'repo': {
      if (!parts[2]) { await sendTelegramMessage('Usage: /sentinel repo <name>', null, topicId); return true; }
      const { showRepoMenu } = require('../telegramMenus');
      await showRepoMenu(chatId, topicId, parts[2]);
      return true;
    }
    case 'approve': {
      const { showApprovalsMenu } = require('../telegramMenus');
      let sprintPending = false;
      try {
        const { isPendingAutoApprove } = require('../autoApprover');
        sprintPending = await isPendingAutoApprove().catch(() => false);
      } catch {}
      await showApprovalsMenu(chatId, topicId, {
        sprint:    sprintPending,
        selfAudit: false,
        security:  null,
      });
      return true;
    }
    case 'pause': {
      try {
        const { cancelAutoApprove } = require('../autoApprover');
        await cancelAutoApprove().catch(() => {});
      } catch {}
      await sendTelegramMessage(
        '⏸ All automation paused.\nSprints, audits, and builds will not auto-execute.\nSend /sentinel resume to restart.',
        null, topicId
      );
      return true;
    }
    case 'resume': {
      await sendTelegramMessage('▶️ Automation resumed.', null, topicId);
      return true;
    }
    case 'reset-failed': {
      // Re-queue all failed tasks for a repo so they can be retried after a builder fix.
      if (!parts[2]) {
        await sendTelegramMessage('Usage: /sentinel reset-failed <repo>', null, topicId);
        return true;
      }
      const { query: dbq } = require('../dbClient');
      const r = await dbq(`
        UPDATE audit_tasks
        SET status = 'queued', failure_reason = NULL
        WHERE repo_full_name = $1 AND status = 'failed'
        RETURNING id
      `, [repoFullName(parts[2])]).catch(() => null);
      const count = r?.rows?.length || 0;
      await sendTelegramMessage(
        `♻️ Reset ${count} failed tasks to queued for ${parts[2]}.\n/sentinel execute ${parts[2]} to run them.`,
        null, topicId
      );
      return true;
    }
    case 'check-builder': {
      const { execSync: exec } = require('child_process');
      const { listBuilders }   = require('../builderRouter');
      const lines = [];

      // Check aider binary
      try {
        const v = exec('aider --version 2>&1', { timeout: 8000 }).toString().trim();
        lines.push(`✅ aider: ${v}`);
      } catch (e) {
        lines.push(`❌ aider: NOT FOUND — builder tasks will fail`);
      }

      // Check git
      try {
        exec('git --version 2>&1', { timeout: 5000 });
        lines.push(`✅ git: available`);
      } catch {
        lines.push(`❌ git: NOT FOUND`);
      }

      lines.push('');

      // List builder API key status
      const builders = listBuilders();
      for (const b of builders) {
        const icon = b.configured ? '✅' : '○';
        lines.push(`${icon} ${b.label}${b.configured ? '' : ' — key not set'}`);
      }

      await sendTelegramMessage(
        `🔧 Builder Status\n\n${lines.join('\n')}`,
        null, topicId
      );
      return true;
    }
    default:
      return false;
  }
}

module.exports = {
  handleRepoOpsCmd,
  handleStop, handleStatus, handleBuilds, handleRetry,
  handleHelp, handleExecute, handleSkipAudit, handleManualAudit,
  handleListTasks, handleSkipBatch,
};
