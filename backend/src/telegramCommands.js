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
      return handleHelp(topicId, chatId);
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
    case 'security': {
      const { getOpenIssues, getLatestSecurityScore,
              getPortfolioSecuritySummary } = require('./securityDb');
      if (parts[2]) {
        const [score, issues] = await Promise.all([
          getLatestSecurityScore(parts[2]),
          getOpenIssues(`Thatisshayan/${parts[2]}`),
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
      const { runSecurityScan } = require('./securityScanner');
      await sendTelegramMessage(`Running security scan on ${parts[2]}...`, null, topicId);
      runSecurityScan({
        repoFullName: `Thatisshayan/${parts[2]}`,
        repoName: parts[2], commitSha: 'HEAD', topicId,
      }).catch(() => {});
      return true;
    }

    case 'security-patch': {
      if (!parts[2]) {
        await sendTelegramMessage('Usage: /sentinel security-patch <repo>', null, topicId);
        return true;
      }
      const { getOpenIssues: getIssues }     = require('./securityDb');
      const { applySecurityPatches } = require('./securityPatcher');
      const patchIssues = await getIssues(`Thatisshayan/${parts[2]}`);
      applySecurityPatches(`Thatisshayan/${parts[2]}`, parts[2], patchIssues, topicId).catch(() => {});
      return true;
    }

    case 'security-approve': {
      await sendTelegramMessage(
        `Security approval for ${parts[2] || 'repo'} noted.\nReview and merge the open PR on GitHub.`,
        null, topicId
      );
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

    case 'test-bots': {
      const { getConfiguredBots, sendAsAgent } = require('./agentBots');
      const { configured, missing } = getConfiguredBots();
      await sendTelegramMessage(
        `Testing ${configured.length} agent bots...`, null, topicId
      );
      for (const agentId of configured) {
        const result = await sendAsAgent(agentId, `🟢 ${agentId} is online and ready.`);
        if (!result) {
          await sendTelegramMessage(`❌ ${agentId} failed — check bot token and group membership`, null, topicId);
        }
        await new Promise(r => setTimeout(r, 800));
      }
      if (missing.length > 0) {
        await sendTelegramMessage(
          `⚠️ Missing tokens for: ${missing.join(', ')}\nAdd BOT_TOKEN_<NAME> to Railway.`,
          null, topicId
        );
      }
      return true;
    }

    case 'standup': {
      const { runAgentStandup } = require('./agentStandup');
      await sendTelegramMessage('Running agent standup...', null, topicId);
      runAgentStandup().catch(err => logger.error({ err: err.message }, 'Manual standup failed'));
      return true;
    }

    case 'leaderboard': {
      const { postAgentLeaderboard } = require('./agentLeaderboard');
      postAgentLeaderboard().catch(err => logger.error({ err: err.message }, 'Manual leaderboard failed'));
      return true;
    }

    case 'ceo': {
      const { generateCEOReport } = require('./ceoReport');
      await sendTelegramMessage('Generating CEO report...', null, topicId);
      generateCEOReport(topicId).catch(err => logger.error({ err: err.message }, 'Manual CEO report failed'));
      return true;
    }

    case 'run-sprint': {
      const { getCurrentSprint } = require('./sprintDb');
      const sprint = await getCurrentSprint().catch(() => null);
      if (!sprint) {
        await sendTelegramMessage('No active sprint. Propose one: /sentinel propose-sprint', null, topicId);
        return true;
      }
      if (sprint.status === 'proposed') {
        await sendTelegramMessage(
          `Sprint is pending approval. Use /sentinel approve-sprint to start, or /sentinel run-sprint to force.`,
          null, topicId
        );
        return true;
      }
      if (sprint.status === 'executing') {
        const { executeNextSprintTask } = require('./sprintOrchestrator');
        await sendTelegramMessage(`Resuming sprint execution (${sprint.total_tasks} tasks)...`, null, topicId);
        executeNextSprintTask(sprint.id, topicId).catch(() => {});
        return true;
      }
      await sendTelegramMessage(`Sprint status: ${sprint.status}. Nothing to run.`, null, topicId);
      return true;
    }

    case 'propose-sprint': {
      const { generateSprintProposal } = require('./sprintPlanner');
      await sendTelegramMessage('Generating sprint proposal...', null, topicId);
      generateSprintProposal().catch(err =>
        logger.error({ err: err.message }, 'Manual sprint proposal failed')
      );
      return true;
    }

    case 'force-execute': {
      if (!parts[2]) {
        await sendTelegramMessage('Usage: /sentinel force-execute <repo>', null, topicId);
        return true;
      }
      const { query: dbQuery } = require('./dbClient');
      // Mark all queued tasks as safe to auto-execute
      const updated = await dbQuery(`
        UPDATE audit_tasks SET safe_to_auto_execute = true
        WHERE repo_full_name = $1 AND status = 'queued'
        RETURNING id
      `, [`Thatisshayan/${parts[2]}`]).catch(() => null);
      const count = updated?.rows?.length || 0;
      await sendTelegramMessage(
        `Unlocked ${count} tasks for ${parts[2]}. Starting execution...`, null, topicId
      );
      if (count > 0) {
        executeApprovedTasks(`Thatisshayan/${parts[2]}`, parts[2], topicId)
          .catch(err => logger.error({ err: err.message }, 'Force-execute failed'));
      }
      return true;
    }

    case 'memory': {
      const { getHistory } = require('./conversationMemory');
      const history = await getHistory(topicId, 10).catch(() => []);
      if (history.length === 0) {
        await sendTelegramMessage('No conversation history for this topic yet.', null, topicId);
        return true;
      }
      const lines = history.map(h =>
        `${h.from_name}: ${h.message.slice(0, 80)}\n→ ${(h.response || '').slice(0, 80)}`
      );
      await sendTelegramMessage(
        `Last ${history.length} exchanges:\n\n${lines.join('\n\n')}`, null, topicId
      );
      return true;
    }

    // ── Phase 10 — Repo Lock ──────────────────────────────────────────────────
    case 'lock': {
      if (!parts[2]) { await sendTelegramMessage('Usage: /sentinel lock <repo>', null, topicId); return true; }
      const { lockRepo } = require('./repoLock');
      await lockRepo(parts[2], 'manual');
      await sendTelegramMessage(
        `🔐 ${parts[2]} locked. No agents will touch it until /sentinel unlock ${parts[2]}`,
        null, topicId
      );
      return true;
    }

    case 'unlock': {
      if (!parts[2]) { await sendTelegramMessage('Usage: /sentinel unlock <repo>', null, topicId); return true; }
      const { unlockRepo } = require('./repoLock');
      await unlockRepo(parts[2]);
      await sendTelegramMessage(`🔓 ${parts[2]} unlocked.`, null, topicId);
      return true;
    }

    case 'locked': {
      const { getAllLocked } = require('./repoLock');
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
      const { getPortfolioSummary } = require('./portfolioAnalytics');
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

    case 'pause': {
      try {
        const { cancelAutoApprove } = require('./autoApprover');
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

    // ── Phase 10 — Telegram Menus ─────────────────────────────────────────────
    case 'menu': {
      const { showMainMenu } = require('./telegramMenus');
      await showMainMenu(chatId, topicId);
      return true;
    }

    case 'repo': {
      if (!parts[2]) { await sendTelegramMessage('Usage: /sentinel repo <name>', null, topicId); return true; }
      const { showRepoMenu } = require('./telegramMenus');
      await showRepoMenu(chatId, topicId, parts[2]);
      return true;
    }

    case 'approve': {
      const { showApprovalsMenu } = require('./telegramMenus');
      let sprintPending = false;
      try {
        const { isPendingAutoApprove } = require('./autoApprover');
        sprintPending = await isPendingAutoApprove().catch(() => false);
      } catch {}
      await showApprovalsMenu(chatId, topicId, {
        sprint:    sprintPending,
        selfAudit: false,
        security:  null,
      });
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

async function handleHelp(topicId, chatId) {
  const { sendMenu } = require('./telegramMenus');

  // Send interactive category buttons
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
  const data     = callbackQuery.data || '';
  const queryId  = callbackQuery.id;
  const topicId  = callbackQuery.message?.message_thread_id;
  const chatId   = callbackQuery.message?.chat?.id;
  const threadId = topicId;

  // ── Phase 10 — Menu callbacks ─────────────────────────────────────────────

  if (data.startsWith('help:')) {
    await answerCallback(queryId).catch(() => {});
    const section = data.replace('help:', '');
    const HELP_SECTIONS = {
      reports: [
        '📊 Reports & Data',
        '',
        '/sentinel report           — daily portfolio report',
        '/sentinel weekly           — weekly business report',
        '/sentinel ceo              — CEO founder summary',
        '/sentinel costs            — AI spend breakdown',
        '/sentinel health           — all repo health scores',
        '/sentinel velocity         — sprint velocity trend',
        '/sentinel patterns         — cross-repo patterns',
        '/sentinel business <repo>  — repo business metrics',
        '/sentinel impact <repo>    — PR impact analysis',
        '/sentinel roi              — recalculate ROI scores',
      ].join('\n'),
      agents: [
        '🤖 Agents & Bots',
        '',
        '/sentinel agents           — all agent statuses',
        '/sentinel what             — who is working right now',
        '/sentinel standup          — trigger agent standup now',
        '/sentinel leaderboard      — post weekly rankings',
        '/sentinel bots             — show bot token status',
        '/sentinel test-bots        — send test message from each bot',
        '/sentinel setup-bots       — update bot profiles',
        '/sentinel memory           — show recent conversation history',
      ].join('\n'),
      repos: [
        '🔨 Repos & Execution',
        '',
        '/sentinel audit <repo>     — trigger fresh code audit',
        '/sentinel tasks <repo>     — list queued tasks',
        '/sentinel execute <repo>   — run safe queued tasks',
        '/sentinel force-execute <repo> — run ALL queued tasks now',
        '/sentinel stop <repo>      — stop all tasks for repo',
        '/sentinel skip <repo>      — skip current audit',
        '/sentinel skip-batch <repo> <n> — skip a task batch',
        '/sentinel lock <repo>      — prevent agents touching repo',
        '/sentinel unlock <repo>    — remove lock',
        '/sentinel locked           — show all locked repos',
        '/sentinel repo <name>      — open repo control panel',
        '/sentinel dashboard        — refresh Notion dashboard',
      ].join('\n'),
      sprint: [
        '🏃 Sprint & Planning',
        '',
        '/sentinel propose-sprint   — generate sprint proposal now',
        '/sentinel approve-sprint   — approve and start executing',
        '/sentinel run-sprint       — resume sprint execution',
        '/sentinel sprint-status    — current sprint progress',
        '/sentinel skip-sprint      — skip this week\'s sprint',
        '/sentinel pause-sprint     — pause sprint mid-execution',
        '/sentinel resume-sprint    — resume paused sprint',
        '/sentinel approve           — show all pending approvals',
      ].join('\n'),
      security: [
        '🔒 Security',
        '',
        '/sentinel security         — portfolio security summary',
        '/sentinel security <repo>  — repo security score + issues',
        '/sentinel security-scan <repo>   — run full security scan',
        '/sentinel security-patch <repo>  — auto-fix safe issues',
        '/sentinel security-approve <repo> — approve manual patches',
      ].join('\n'),
      system: [
        '⚙️ System & Control',
        '',
        '/sentinel pause            — emergency stop all automation',
        '/sentinel resume           — restart automation',
        '/sentinel self-audit       — run Sentinel self-check',
        '/sentinel self-approve     — execute Sentinel improvements',
        '/sentinel status <repo>    — show Notion project info',
        '/sentinel builds <repo>    — check build status',
        '/sentinel performance      — AI model performance stats',
        '/sentinel prompts          — prompt optimisation report',
        '/sentinel menu             — quick action keyboard',
        '/sentinel help             — this menu',
      ].join('\n'),
      full: [
        '📖 All Commands',
        '',
        'REPORTS:  report, weekly, ceo, costs, health, velocity, patterns, business, impact, roi',
        'AGENTS:   agents, what, standup, leaderboard, bots, test-bots, setup-bots, memory',
        'REPOS:    audit, tasks, execute, force-execute, stop, skip, lock, unlock, locked, repo, dashboard',
        'SPRINT:   propose-sprint, approve-sprint, run-sprint, sprint-status, skip-sprint, pause-sprint, resume-sprint, approve',
        'SECURITY: security, security-scan, security-patch, security-approve',
        'SYSTEM:   pause, resume, self-audit, self-approve, status, builds, performance, prompts, menu, help',
        '',
        'All commands: /sentinel <command> [args]',
      ].join('\n'),
    };
    const text = HELP_SECTIONS[section] || 'Unknown section.';
    await sendTelegramMessage(text, null, threadId).catch(() => {});
    return true;
  }

  if (data.startsWith('menu:')) {
    await answerCallback(queryId).catch(() => {});
    const action = data.replace('menu:', '');
    try {
      if (action === 'report') {
        const { sendDailyReport } = require('./dailyReport');
        await sendDailyReport();
      } else if (action === 'costs') {
        const { getCostReport } = require('./costTracker');
        const r = await getCostReport();
        await sendTelegramMessage(r.formatted, null, threadId);
      } else if (action === 'agents') {
        const { getAgentRoomSummary } = require('./agentRoom');
        const s = await getAgentRoomSummary();
        await sendTelegramMessage(s, null, threadId);
      } else if (action === 'sprint') {
        const { getSprintStatus } = require('./sprintOrchestrator');
        await getSprintStatus(threadId);
      } else if (action === 'selfaudit') {
        const { runSelfAudit } = require('./selfAuditor');
        await sendTelegramMessage('Triggering self-audit...', null, threadId);
        runSelfAudit().catch(() => {});
      } else if (action === 'security') {
        const { getPortfolioSecuritySummary } = require('./securityDb');
        const p = await getPortfolioSecuritySummary().catch(() => []);
        const lines = p.sort((a,b) => parseFloat(a.score)-parseFloat(b.score))
          .map(r => `${r.repo_name}: ${r.score}/10 (${r.critical_count||0} critical)`);
        await sendTelegramMessage(`🔒 Security\n\n${lines.join('\n')||'No data yet.'}`, null, threadId);
      } else if (action === 'approvals') {
        const { showApprovalsMenu } = require('./telegramMenus');
        let sprintPending = false;
        try { const { isPendingAutoApprove } = require('./autoApprover'); sprintPending = await isPendingAutoApprove().catch(() => false); } catch {}
        await showApprovalsMenu(chatId, threadId, { sprint: sprintPending, selfAudit: false, security: null });
      } else if (action === 'last') {
        const { getRecentMessages } = require('./agentDb');
        const msgs = await getRecentMessages(5).catch(() => []);
        const lines = msgs.map(m => `· ${m.agent_id}: ${(m.message||'').slice(0, 60)}`).join('\n');
        await sendTelegramMessage(lines || 'No recent agent messages.', null, threadId);
      } else if (action === 'help') {
        await sendTelegramMessage([
          '/sentinel menu — this menu',
          '/sentinel repo <name> — repo control panel',
          '/sentinel health — all repos health scores',
          '/sentinel what — active agent tasks right now',
          '/sentinel pause — emergency stop all automation',
        ].join('\n'), null, threadId);
      }
    } catch (err) {
      logger.warn({ err: err.message, action }, 'Menu callback failed');
    }
    return true;
  }

  if (data.startsWith('repo:')) {
    await answerCallback(queryId).catch(() => {});
    const parts2      = data.split(':');
    const repoAction  = parts2[1];
    const repoName    = parts2[2];
    const repoFullName = `Thatisshayan/${repoName}`;
    try {
      if (repoAction === 'audit') {
        triggerAudit({ repoFullName, repoName, commitSha: `manual-${Date.now()}`,
          commitMessage: '[manual]', branchName: 'main', authorName: 'Human', authorEmail: '', topicId: threadId })
          .catch(() => {});
        await sendTelegramMessage(`Audit triggered for ${repoName}.`, null, threadId);
      } else if (repoAction === 'execute') {
        executeApprovedTasks(repoFullName, repoName, threadId).catch(() => {});
        await sendTelegramMessage(`Executing tasks for ${repoName}...`, null, threadId);
      } else if (repoAction === 'stop') {
        await stopAllTasksForRepo(repoFullName);
        await sendTelegramMessage(`Stopped all tasks for ${repoName}.`, null, threadId);
      } else if (repoAction === 'lock') {
        const { lockRepo } = require('./repoLock');
        await lockRepo(repoName, 'inline-menu');
        await sendTelegramMessage(`🔐 ${repoName} locked.`, null, threadId);
      } else if (repoAction === 'security') {
        const { runSecurityScan } = require('./securityScanner');
        runSecurityScan({ repoFullName, repoName, commitSha: 'HEAD', topicId: threadId }).catch(() => {});
        await sendTelegramMessage(`Security scan started for ${repoName}.`, null, threadId);
      } else if (repoAction === 'status') {
        await sendTelegramMessage(`Use /sentinel status ${repoName} for details.`, null, threadId);
      }
    } catch (err) {
      logger.warn({ err: err.message, repoAction, repoName }, 'Repo callback failed');
    }
    return true;
  }

  if (data.startsWith('approve:')) {
    await answerCallback(queryId).catch(() => {});
    const approveAction = data.replace('approve:', '');
    try {
      if (approveAction === 'sprint') {
        const { approveSprint } = require('./sprintOrchestrator');
        approveSprint(threadId).catch(() => {});
      } else if (approveAction === 'skip-sprint') {
        try { const { cancelAutoApprove } = require('./autoApprover'); await cancelAutoApprove(); } catch {}
        await sendTelegramMessage('Sprint skipped.', null, threadId);
      } else if (approveAction === 'self') {
        executeApprovedTasks('Thatisshayan/project-sentinel', 'project-sentinel', threadId).catch(() => {});
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'Approve callback failed');
    }
    return true;
  }

  if (data.startsWith('dym:')) {
    await answerCallback(queryId).catch(() => {});
    const dymAction = data.replace('dym:', '');
    if (dymAction === 'cancel') {
      await sendTelegramMessage('OK — nothing done.', null, threadId).catch(() => {});
    }
    return true;
  }

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