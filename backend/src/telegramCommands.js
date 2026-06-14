const logger = require('./logger');
const { sendTelegramMessage }         = require('./telegramClient');
const { findNotionProject }           = require('./notionClient');
const { stopDebugAttempts,
        getDebugAttempt }             = require('./dbClient');
const { checkAllProviders }           = require('./buildPoller');
const { orchestrateDebug }            = require('./debugOrchestrator');
const {
  executeApprovedTasks,
  triggerAudit,
  processNextBatch,
} = require('./auditOrchestrator');
const {
  stopAllTasksForRepo,
  getNextBatch,
  updateAuditTask,
} = require('./auditDb');
const { updateNotionTaskStatus } = require('./auditTaskWriter');
const { handleMessage }          = require('./telegramAI');
const {
  approveSprint, getSprintStatus,
  pauseSprint, resumeSprint,
} = require('./sprintOrchestrator');
const { getVelocityReport }      = require('./velocityTracker');
const { getAgentRoomSummary,
        answerCallback }         = require('./agentRoom');
const { executePortfolioTasks }  = require('./parallelExecutor');
const { getAllAgents }            = require('./agentDb');
const { getPerformanceReport }   = require('./performanceTracker');
const { getPromptReport }        = require('./promptOptimizer');
const { runSelfAudit }           = require('./selfAuditor');
const { generateWeeklyReport }   = require('./weeklyBusinessReport');
const { getRepoBusinessSummary } = require('./businessMetrics');
const { getCorrelationSummary }  = require('./correlationEngine');
const { scoreAllQueuedTasks }    = require('./roiScorer');
const { detectAgentReply,
        handleAgentReply }       = require('./agentReplies');
const {
  getPendingConflict,
  resolvePendingConflict,
  releaseAllLocks,
} = require('./conflictDetector');

const KNOWN_AGENT_IDS = ['nvidia','qwen_coder','qwen_coder_dash','llama_fast','gemini','qwen_max','qwen_turbo','deepseek','qwen_plus','opencode'];

async function handleCommand(text, chatId, topicId, fromName, message = null) {
  // Phase 8.5 — if this is a reply to a specific agent bot, route directly to that agent
  if (message) {
    const targetAgent = detectAgentReply(message);
    if (targetAgent) {
      await handleAgentReply(message, targetAgent, topicId);
      return true;
    }
  }

  // Route non-slash messages to AI agent
  if (!text.trim().startsWith('/')) {
    const isAgentRoom = topicId != null && String(topicId) === String(process.env.AGENT_ROOM_TOPIC_ID);
    if (isAgentRoom) {
      let roomContext = await getAgentRoomSummary().catch(() => '');

      // Improvement 3 — @mention detection: enrich roomContext with specific agent status
      const mentioned = KNOWN_AGENT_IDS.filter(id => text.toLowerCase().includes(`@${id}`));
      if (mentioned.length > 0) {
        const agents     = await getAllAgents().catch(() => []);
        const mentionLines = mentioned.map(id => {
          const a = agents.find(x => x.agent_id === id);
          if (!a) return `@${id}: not registered`;
          return a.status === 'working'
            ? `@${id}: working on ${a.repo_full_name?.split('/')[1]} — ${a.task_title}`
            : `@${id}: idle (${a.completed_tasks} done, ${a.failed_tasks} failed)`;
        }).join('\n');
        roomContext += `\n\nMENTIONED AGENTS:\n${mentionLines}`;
      }

      handleMessage(text, fromName || 'Shayan', topicId, roomContext);
    } else {
      handleMessage(text, fromName || 'Shayan', topicId);
    }
    return false;
  }

  const parts   = text.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();
  const project = parts[1];

  if (command !== '/sentinel' || !parts[1]) return false;

  const subcommand = parts[1].toLowerCase();

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
      return handleHelp(topicId);
    case 'execute':
      return handleExecute(parts[2], topicId);
    case 'skip':
      if (parts[2]) return handleSkipAudit(parts[2], topicId);
      break;
    case 'audit':
      return handleManualAudit(parts[2], topicId);
    case 'tasks':
      return handleListTasks(parts[2], topicId);
    case 'skip-batch':
      return handleSkipBatch(parts[2], parts[3], topicId);
    case 'report': {
      const { sendDailyReport } = require('./dailyReport');
      await sendDailyReport();
      return true;
    }
    case 'costs': {
      const { getCostReport } = require('./costTracker');
      const report = await getCostReport();
      await sendTelegramMessage(report.formatted, null, topicId);
      return true;
    }
    case 'patterns': {
      const { getOpenPatterns } = require('./portfolioDb');
      const patterns = await getOpenPatterns();
      if (patterns.length === 0) {
        await sendTelegramMessage('No cross-repo patterns detected.', null, topicId);
      } else {
        const lines = patterns.map(p =>
          `· ${p.description}\n  Repos: ${(p.affected_repos || []).join(', ')}`
        ).join('\n\n');
        await sendTelegramMessage(`Cross-Repo Patterns:\n\n${lines}`, null, topicId);
      }
      return true;
    }
    case 'dashboard': {
      const { updateDashboard } = require('./notionDashboard');
      await updateDashboard();
      await sendTelegramMessage('Notion dashboard updated.', null, topicId);
      return true;
    }
    case 'approve-sprint': {
      approveSprint(topicId)
        .catch(err => logger.error({ err: err.message }, 'approve-sprint failed'));
      return true;
    }
    case 'skip-sprint': {
      const { getCurrentSprint, updateSprint } = require('./sprintDb');
      const skipSprint = await getCurrentSprint();
      if (skipSprint) {
        await updateSprint(skipSprint.id, { status: 'skipped' });
        await sendTelegramMessage('Sprint skipped. Next proposal Sunday 8pm.', null, topicId);
      } else {
        await sendTelegramMessage('No active sprint proposal to skip.', null, topicId);
      }
      return true;
    }
    case 'sprint-status': {
      getSprintStatus(topicId).catch(() => {});
      return true;
    }
    case 'pause-sprint': {
      pauseSprint(topicId).catch(() => {});
      return true;
    }
    case 'resume-sprint': {
      resumeSprint(topicId).catch(() => {});
      return true;
    }
    case 'velocity': {
      const report = await getVelocityReport();
      await sendTelegramMessage(report, null, topicId);
      return true;
    }
    case 'agents': {
      const summary = await getAgentRoomSummary();
      await sendTelegramMessage(summary, null, topicId);
      return true;
    }
    case 'agent-room': {
      await sendTelegramMessage(
        `Agent room topic ID: ${process.env.AGENT_ROOM_TOPIC_ID || 'not configured'}\n` +
        `Set AGENT_ROOM_TOPIC_ID in Railway to activate.`,
        null, topicId
      );
      return true;
    }
    case 'self-audit': {
      await sendTelegramMessage('Triggering Sentinel self-audit...', null, topicId);
      runSelfAudit().catch(err => logger.error({ err: err.message }, 'Self-audit failed'));
      return true;
    }
    case 'self-approve': {
      const { executeApprovedTasks } = require('./auditOrchestrator');
      await sendTelegramMessage('Approving Sentinel self-improvement tasks...', null, topicId);
      executeApprovedTasks(
        'Thatisshayan/project-sentinel',
        'project-sentinel',
        topicId
      ).catch(() => {});
      return true;
    }
    case 'performance': {
      const report = await getPerformanceReport();
      await sendTelegramMessage(report, null, topicId);
      return true;
    }
    case 'prompts': {
      const report = await getPromptReport();
      await sendTelegramMessage(report, null, topicId);
      return true;
    }
    case 'business': {
      if (parts[2]) {
        const summary = await getRepoBusinessSummary(parts[2]);
        await sendTelegramMessage(
          summary || `No business metrics for ${parts[2]} yet.`,
          null, topicId
        );
      } else {
        await generateWeeklyReport();
      }
      return true;
    }
    case 'roi': {
      await scoreAllQueuedTasks();
      await sendTelegramMessage('ROI scores updated for all queued tasks.', null, topicId);
      return true;
    }
    case 'impact': {
      if (!parts[2]) {
        await sendTelegramMessage('Usage: /sentinel impact <repo-name>', null, topicId);
        return true;
      }
      const corr = await getCorrelationSummary(parts[2]);
      if (!corr || !corr.pr_count) {
        await sendTelegramMessage(`No PR impact data for ${parts[2]} yet.`, null, topicId);
        return true;
      }
      await sendTelegramMessage([
        `📊 PR Impact — ${parts[2]} (last 30 days)`,
        `PRs analysed: ${corr.pr_count}`,
        `Avg impact score: ${parseFloat(corr.avg_impact).toFixed(1)}`,
        `Positive PRs: ${corr.positive_prs}/${corr.pr_count}`,
        `Best PR score: ${parseFloat(corr.best_impact).toFixed(1)}`,
        `Worst PR score: ${parseFloat(corr.worst_impact).toFixed(1)}`,
      ].join('\n'), null, topicId);
      return true;
    }
    case 'weekly': {
      await generateWeeklyReport();
      return true;
    }
    case 'bots': {
      const { getConfiguredBots } = require('./agentBots');
      const { configured, missing } = getConfiguredBots();
      await sendTelegramMessage([
        `Agent Bot Status:`,
        ``,
        `✅ Configured (${configured.length}): ${configured.join(', ') || 'none'}`,
        `❌ Missing tokens (${missing.length}): ${missing.join(', ') || 'none'}`,
        ``,
        `Add missing tokens to Railway as BOT_TOKEN_<AGENTNAME>`,
      ].join('\n'), null, topicId);
      return true;
    }
    case 'setup-bots': {
      const { getConfiguredBots, configureBotProfile } = require('./agentBots');
      const { configured } = getConfiguredBots();
      for (const agentId of configured) {
        await configureBotProfile(agentId, `Project Sentinel Agent — ${agentId}`);
      }
      await sendTelegramMessage(
        `Bot profiles updated for: ${configured.join(', ') || 'none configured'}`,
        null, topicId
      );
      return true;
    }
    default:
      return false;
  }
}

async function handleStop(projectArg, topicId) {
  if (!projectArg) {
    await sendTelegramMessage('Usage: /sentinel stop <repo-name>', null, topicId);
    return true;
  }

  try {
    await stopDebugAttempts(projectArg);
    await sendTelegramMessage(
      `✅ Debug attempts stopped for: ${projectArg}\nNo further automatic fixes will run.`,
      null,
      topicId
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
      null,
      topicId
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
    // Need to find the full repo name — look up from Notion
    const project = await findNotionProject(projectArg);
    if (!project) {
      await sendTelegramMessage(`No project found for: ${projectArg}`, null, topicId);
      return true;
    }

    // Use the repo name to find latest commit SHA from Notion
    await sendTelegramMessage(
      `Checking builds for ${projectArg}...\n\nNote: Provide a commit SHA for detailed status.\nCheck GitHub Actions / Vercel / Railway directly for latest build.`,
      null,
      topicId
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
    null,
    topicId
  );
  return true;
}

async function handleHelp(topicId) {
  await sendTelegramMessage(
    [
      `Project Sentinel — Commands`,
      ``,
      `/sentinel stop <repo>    — stop auto-debug for a repo`,
      `/sentinel status <repo>  — show project status from Notion`,
      `/sentinel builds <repo>  — check latest build status`,
      `/sentinel retry <repo>   — manual retry note`,
      `/sentinel help           — show this message`,
    ].join('\n'),
    null,
    topicId
  );
  return true;
}

async function handleExecute(repoArg, topicId) {
  if (!repoArg) {
    await sendTelegramMessage('Usage: /sentinel execute <repo-name>', null, topicId);
    return true;
  }
  await sendTelegramMessage(`Starting task execution for ${repoArg}...`, null, topicId);
  executeApprovedTasks(`Thatisshayan/${repoArg}`, repoArg, topicId)
    .catch(err => logger.error({ err: err.message }, 'Execute failed'));
  return true;
}

async function handleSkipAudit(repoArg, topicId) {
  await stopAllTasksForRepo(`Thatisshayan/${repoArg}`);
  await sendTelegramMessage(
    `Audit skipped for ${repoArg}. Tasks remain in Notion as Queued.`,
    null,
    topicId
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
    repoFullName:  `Thatisshayan/${repoArg}`,
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

async function handleListTasks(repoArg, topicId) {
  if (!repoArg) {
    await sendTelegramMessage('Usage: /sentinel tasks <repo-name>', null, topicId);
    return true;
  }
  const { query } = require('./dbClient');
  const r = await query(`
    SELECT task_number, title, priority, status,
           safe_to_auto_execute, batch_number
    FROM audit_tasks
    WHERE repo_full_name=$1
      AND status IN ('queued','in_progress','failed','build_check')
    ORDER BY task_number ASC LIMIT 12
  `, [`Thatisshayan/${repoArg}`]);

  if (r.rows.length === 0) {
    await sendTelegramMessage(`No active tasks for ${repoArg}.`, null, topicId);
    return true;
  }

  const EMOJI = { critical:'🔴', high:'🟠', medium:'🟡', low:'🟢' };
  const list  = r.rows.map(t =>
    `${t.task_number}. [B${t.batch_number}] ${EMOJI[t.priority]||'⚪'} ${t.title} — ${t.status}${t.safe_to_auto_execute?'':' 🔒'}`
  ).join('\n');

  await sendTelegramMessage(`Tasks for ${repoArg}:\n\n${list}`, null, topicId);
  return true;
}

async function handleSkipBatch(repoArg, batchNumArg, topicId) {
  if (!repoArg || !batchNumArg) {
    await sendTelegramMessage(
      'Usage: /sentinel skip-batch <repo-name> <batch-number>', null, topicId
    );
    return true;
  }
  const { query } = require('./dbClient');
  const r = await query(`
    SELECT id FROM audit_tasks
    WHERE repo_full_name=$1
      AND batch_number=$2
      AND status IN ('queued','in_progress')
  `, [`Thatisshayan/${repoArg}`, parseInt(batchNumArg)]);

  for (const row of r.rows) {
    await updateAuditTask(row.id, { status: 'skipped' });
  }

  await sendTelegramMessage(
    `Batch ${batchNumArg} skipped for ${repoArg}. Moving to next batch...`,
    null,
    topicId
  );
  processNextBatch(`Thatisshayan/${repoArg}`, repoArg, topicId).catch(() => {});
  return true;
}

// Improvement 4 — conflict resolution via inline keyboard button presses.
// Wire in index.js: const cb = req.body.callback_query; if (cb) { await handleCallbackQuery(cb); return res.status(200).json({ok:true}); }
async function handleCallbackQuery(callbackQuery) {
  const data    = callbackQuery.data || '';
  const queryId = callbackQuery.id;
  const topicId = callbackQuery.message?.message_thread_id;

  if (!data.startsWith('conflict:')) return false;

  const parts      = data.split(':');
  const action     = parts[1];
  const conflictId = parts.slice(2).join(':');

  await answerCallback(queryId).catch(() => {});

  const conflict = getPendingConflict(conflictId);
  if (!conflict) {
    await sendTelegramMessage('Conflict already resolved or expired.', null, topicId).catch(() => {});
    return true;
  }

  const repoName = conflict.repoFullName.split('/')[1];

  switch (action) {
    case 'wait':
      await sendTelegramMessage(
        `⏳ ${conflict.agentId} will wait. Conflict locks held — agent will retry.`,
        null, topicId
      ).catch(() => {});
      break;

    case 'skip':
      await sendTelegramMessage(
        `⏭️ ${conflict.agentId} skipping conflicted files on ${repoName} and proceeding with the rest.`,
        null, topicId
      ).catch(() => {});
      break;

    case 'reassign':
      await releaseAllLocks(conflict.repoFullName, conflict.lockedBy || conflict.agentId).catch(() => {});
      await sendTelegramMessage(
        `🔄 Locks released for ${repoName}. ${conflict.agentId} can now acquire the files or be reassigned.`,
        null, topicId
      ).catch(() => {});
      break;
  }

  resolvePendingConflict(conflictId);
  return true;
}

module.exports = { handleCommand, handleCallbackQuery };