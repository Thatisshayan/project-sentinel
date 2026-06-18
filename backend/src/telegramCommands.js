const logger              = require('./logger');
const { repoFullName }    = require('./repoResolver');
const { sendTelegramMessage } = require('./telegramClient');
const { executeApprovedTasks } = require('./auditOrchestrator');
const { stopAllTasksForRepo, updateAuditTask } = require('./auditDb');
const { getAllAgents }    = require('./agentDb');
const { handleMessage }  = require('./telegramAI');
const { getAgentRoomSummary, answerCallback } = require('./agentRoom');
const { detectAgentReply, handleAgentReply }  = require('./agentReplies');
const { getPendingConflict, resolvePendingConflict, releaseAllLocks } = require('./conflictDetector');

const { handleReportsCmd } = require('./commands/reports');
const { handleSprintCmd }  = require('./commands/sprint');
const { handleAgentsCmd }  = require('./commands/agents');
const { handleRepoOpsCmd } = require('./commands/repoOps');

const KNOWN_AGENT_IDS = ['nvidia','qwen_coder','qwen_coder_dash','llama_fast','gemini','qwen_max','qwen_turbo','deepseek','qwen_plus','opencode'];

const REPORTS_CMDS = new Set(['report','costs','patterns','dashboard','velocity','performance','prompts','business','roi','impact','weekly','ceo']);
const SPRINT_CMDS  = new Set(['approve-sprint','skip-sprint','sprint-status','pause-sprint','resume-sprint','propose-sprint','run-sprint']);
const AGENTS_CMDS  = new Set(['agents','agent-room','self-audit','self-approve','bots','test-bots','setup-bots','standup','leaderboard','memory']);

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

      // Enrich roomContext with specific agent status when @mentioned
      const mentioned = KNOWN_AGENT_IDS.filter(id => text.toLowerCase().includes(`@${id}`));
      if (mentioned.length > 0) {
        const agents = await getAllAgents().catch(() => []);
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

  const parts      = text.trim().split(/\s+/);
  const command    = parts[0]?.toLowerCase();

  if (command !== '/sentinel' || !parts[1]) return false;

  const subcommand = parts[1].toLowerCase();

  if (REPORTS_CMDS.has(subcommand)) return handleReportsCmd(subcommand, parts, chatId, topicId);
  if (SPRINT_CMDS.has(subcommand))  return handleSprintCmd(subcommand, parts, chatId, topicId);
  if (AGENTS_CMDS.has(subcommand))  return handleAgentsCmd(subcommand, parts, chatId, topicId);
  return handleRepoOpsCmd(subcommand, parts, chatId, topicId);
}

async function handleCallbackQuery(callbackQuery) {
  const data     = callbackQuery.data || '';
  const queryId  = callbackQuery.id;
  const topicId  = callbackQuery.message?.message_thread_id;
  const chatId   = callbackQuery.message?.chat?.id;
  const threadId = topicId;

  if (data.startsWith('execute:')) {
    await answerCallback(queryId).catch(() => {});
    const repoName = data.replace('execute:', '');
    await sendTelegramMessage(`Starting execution for ${repoName}...`, null, threadId).catch(() => {});
    executeApprovedTasks(repoFullName(repoName), repoName, threadId).catch(() => {});
    return true;
  }

  if (data.startsWith('skip:')) {
    await answerCallback(queryId).catch(() => {});
    const repoName = data.replace('skip:', '');
    const { stopAllTasksForRepo: stopRepo } = require('./auditDb');
    await stopRepo(repoFullName(repoName));
    await sendTelegramMessage(`Audit skipped for ${repoName}.`, null, threadId).catch(() => {});
    return true;
  }

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
        '/sentinel brain            — run strategic daily brain',
        '/sentinel check-builder    — verify aider + API keys',
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
        'SYSTEM:   pause, resume, self-audit, self-approve, status, builds, performance, prompts, brain, menu, help',
        '',
        'All commands: /sentinel <command> [args]',
      ].join('\n'),
    };
    const helpText = HELP_SECTIONS[section] || 'Unknown section.';
    await sendTelegramMessage(helpText, null, threadId).catch(() => {});
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
        const { getAgentRoomSummary: getARS } = require('./agentRoom');
        const s = await getARS();
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
    const parts2     = data.split(':');
    const repoAction = parts2[1];
    const repoName   = parts2[2];
    const repoFull   = repoFullName(repoName);  // fixed: was shadowing the import
    try {
      if (repoAction === 'audit') {
        const { triggerAudit } = require('./auditOrchestrator');
        triggerAudit({ repoFullName: repoFull, repoName, commitSha: `manual-${Date.now()}`,
          commitMessage: '[manual]', branchName: 'main', authorName: 'Human', authorEmail: '', topicId: threadId })
          .catch(() => {});
        await sendTelegramMessage(`Audit triggered for ${repoName}.`, null, threadId);
      } else if (repoAction === 'execute') {
        executeApprovedTasks(repoFull, repoName, threadId).catch(() => {});
        await sendTelegramMessage(`Executing tasks for ${repoName}...`, null, threadId);
      } else if (repoAction === 'stop') {
        await stopAllTasksForRepo(repoFull);
        await sendTelegramMessage(`Stopped all tasks for ${repoName}.`, null, threadId);
      } else if (repoAction === 'lock') {
        const { lockRepo } = require('./repoLock');
        await lockRepo(repoName, 'inline-menu');
        await sendTelegramMessage(`🔐 ${repoName} locked.`, null, threadId);
      } else if (repoAction === 'security') {
        const { runSecurityScan } = require('./securityScanner');
        runSecurityScan({ repoFullName: repoFull, repoName, commitSha: 'HEAD', topicId: threadId }).catch(() => {});
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
        const { getCurrentSprint, updateSprint } = require('./sprintDb');
        const sprint = await getCurrentSprint().catch(() => null);
        if (sprint) await updateSprint(sprint.id, { status: 'skipped' });
        await sendTelegramMessage('Sprint skipped. Next proposal Sunday 8pm.', null, threadId);
      } else if (approveAction === 'self') {
        executeApprovedTasks(repoFullName('project-sentinel'), 'project-sentinel', threadId).catch(() => {});
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

  if (data.startsWith('task-approve:')) {
    await answerCallback(queryId).catch(() => {});
    const taskId = data.replace('task-approve:', '');
    const { query: dbq } = require('./dbClient');
    const result = await dbq(
      `UPDATE audit_tasks SET safe_to_auto_execute = true
       WHERE id = $1 RETURNING repo_full_name, task_number, title`,
      [taskId]
    ).catch(() => null);
    if (result?.rows?.[0]) {
      const { repo_full_name, task_number, title } = result.rows[0];
      const repoName = repo_full_name.split('/')[1];
      await sendTelegramMessage(
        `✅ Task #${task_number} approved: ${title}\nExecuting now...`, null, threadId
      ).catch(() => {});
      executeApprovedTasks(repo_full_name, repoName, threadId).catch(() => {});
    }
    return true;
  }

  if (data.startsWith('task-skip:')) {
    await answerCallback(queryId).catch(() => {});
    const taskId = data.replace('task-skip:', '');
    const { query: dbq } = require('./dbClient');
    const sel = await dbq(
      'SELECT task_number, title FROM audit_tasks WHERE id = $1', [taskId]
    ).catch(() => null);
    if (sel?.rows?.[0]) {
      await updateAuditTask(taskId, { status: 'skipped' });
      await sendTelegramMessage(
        `⏭️ Task #${sel.rows[0].task_number} skipped: ${sel.rows[0].title}`, null, threadId
      ).catch(() => {});
    }
    return true;
  }

  if (data.startsWith('task-approve-all:')) {
    await answerCallback(queryId).catch(() => {});
    const repoFull  = data.replace('task-approve-all:', '');
    const repoName  = repoFull.split('/')[1];
    const { query: dbq } = require('./dbClient');
    await dbq(
      `UPDATE audit_tasks SET safe_to_auto_execute = true
       WHERE repo_full_name = $1 AND status = 'queued'`,
      [repoFull]
    ).catch(() => {});
    await sendTelegramMessage(
      `✅ All tasks approved for ${repoName}. Executing...`, null, threadId
    ).catch(() => {});
    executeApprovedTasks(repoFull, repoName, threadId).catch(() => {});
    return true;
  }

  if (!data.startsWith('conflict:')) return false;

  const conflictParts = data.split(':');
  const action        = conflictParts[1];
  const conflictId    = conflictParts.slice(2).join(':');

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
