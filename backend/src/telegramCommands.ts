import { safeFire, fireAndForget } from './utils/safeFire';
import logger from './logger';
import { repoFullName } from './repoResolver';
import { sendTelegramMessage } from './telegramClient';
import { findNotionProject } from './notionClient';
import { stopDebugAttempts, getDebugAttempt, query } from './dbClient';
import { checkAllProviders } from './buildPoller';
import { orchestrateDebug } from './debugOrchestrator';
import {
  executeApprovedTasks,
  triggerAudit,
  processNextBatch,
} from './auditOrchestrator';
import {
  stopAllTasksForRepo,
  getNextBatch,
  updateAuditTask,
} from './auditDb';
import { updateNotionTaskStatus } from './auditTaskWriter';
import { handleMessage } from './telegramAI';
import {
  approveSprint, getSprintStatus,
  pauseSprint, resumeSprint,
} from './sprintOrchestrator';
import { getVelocityReport } from './velocityTracker';
import { getAgentRoomSummary, answerCallback } from './agentRoom';
import { executePortfolioTasks } from './parallelExecutor';
import { getAllAgents } from './agentDb';
import { getPerformanceReport } from './performanceTracker';
import { getPromptReport } from './promptOptimizer';
import { runSelfAudit } from './selfAuditor';
import { generateWeeklyReport } from './weeklyBusinessReport';
import { getRepoBusinessSummary } from './businessMetrics';
import { getCorrelationSummary } from './correlationEngine';
import { scoreAllQueuedTasks } from './roiScorer';
import { showMainMenu } from './telegramMenus';
import { sendDailyReport } from './dailyReport';
import { getCostReport } from './costTracker';
import { detectAgentReply, handleAgentReply } from './agentReplies';
import { getDefaultBranch } from './repoDiscovery';
import {
  getPendingConflict,
  resolvePendingConflict,
  releaseAllLocks,
} from './conflictDetector';
import type { AgentRow, AgentMessageRow } from './types/agentRow';
import type { SecurityScoreSummaryRow } from './types/securityRow';

interface TelegramMessage {
  reply_to_message?: { from?: { username?: string } };
  text?: string;
  from?: { first_name?: string; username?: string };
  message_id?: number;
}

interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: { message_thread_id?: number; chat?: { id: number } };
}

import { handleAgentsCmd }  from './commands/agents';
import { handleRepoOpsCmd, handleHelp } from './commands/repoOps';
import { handleReportsCmd } from './commands/reports';
import { handleSprintCmd }  from './commands/sprint';
import { dispatchCommand as dispatchVerbCommand } from './commandRegistry';

const KNOWN_AGENT_IDS = ['nvidia','qwen_coder','qwen_coder_dash','llama_fast','gemini','qwen_max','qwen_turbo','deepseek','qwen_plus','opencode'];

async function handleCommand(text: string, chatId: number | null, topicId: number | null, fromName: string, message: TelegramMessage | null = null): Promise<boolean> {
  // Phase 8.5 — if this is a reply to a specific agent bot, route directly to that agent
  if (message) {
    const targetAgent = detectAgentReply(message);
    if (targetAgent) {
      await handleAgentReply(message, targetAgent, topicId as number);
      return true;
    }
  }

  // Verb-first commands (Phase 0 of docs/2026-07-22-slack-agent-roster-plan.md)
  // — e.g. "audit myrepo", "sprint status" — no "/sentinel" prefix required.
  // Tried before AI free-text routing so a recognized command always wins
  // over AI interpretation; unrecognized text falls through unchanged.
  if (!text.trim().startsWith('/')) {
    const dispatched = await dispatchVerbCommand(text, String(chatId), topicId).catch((err: any) => {
      logger.warn({ err: err.message }, 'dispatchVerbCommand failed, falling back to AI routing');
      return false;
    });
    if (dispatched) return true;
  }

  // Route non-slash messages to AI agent
  if (!text.trim().startsWith('/')) {
    const isAgentRoom = topicId != null && String(topicId) === String(process.env['AGENT_ROOM_TOPIC_ID']);
    if (isAgentRoom) {
      let roomContext = await getAgentRoomSummary().catch(() => '');

      // Enrich roomContext with specific agent status when @mentioned
      const mentioned = KNOWN_AGENT_IDS.filter(id => text.toLowerCase().includes(`@${id}`));
      if (mentioned.length > 0) {
        const agents = await getAllAgents().catch(() => [] as AgentRow[]);
        const mentionLines = mentioned.map(id => {
          const a = agents.find((x) => x.agent_id === id);
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
  const command = parts[0]?.toLowerCase().split('@')[0]; // strip @BotName suffix Telegram adds in groups

  // Top-level commands Telegram's native "/" menu can send directly
  if (command === '/start' || command === '/menu') {
    // chatId is null when invoked from non-Telegram callers (e.g. dashboard
    // /api/command); coalesce to 0 so telegramMenus' number-typed param stays
    // satisfied and Telegram silently rejects the impossible chat_id=0
    // instead of receiving the string "null" via String(null).
    await showMainMenu(chatId ?? 0, topicId ?? null);
    return true;
  }
  if (command === '/help') {
    return handleHelp(topicId, String(chatId));
  }

  if (command !== '/sentinel' || !parts[1]) return false;

  const subcommand = parts[1].toLowerCase();

  // Delegate to the modular command handlers
  if (await handleSprintCmd(subcommand, parts, String(chatId), topicId))  return true;
  if (await handleReportsCmd(subcommand, parts, String(chatId), topicId)) return true;
  if (await handleAgentsCmd(subcommand, parts, String(chatId), topicId))  return true;
  if (await handleRepoOpsCmd(subcommand, parts, String(chatId), topicId)) return true;

  return false;
}

// Improvement 4 — conflict resolution via inline keyboard button presses.
async function handleCallbackQuery(callbackQuery: TelegramCallbackQuery): Promise<boolean> {
  const data     = callbackQuery.data || '';
  const queryId  = callbackQuery.id;
  const topicId  = callbackQuery.message?.message_thread_id ?? null;
  const chatId   = callbackQuery.message?.chat?.id ?? null;
  const threadId = topicId;

  // ── Phase 10 — Menu callbacks ─────────────────────────────────────────────

  // Inline approval buttons from audit completion message
  if (data.startsWith('execute:')) {
    await safeFire(answerCallback(queryId), { label: 'telegramCommands' })
    const repoName = data.replace('execute:', '');
    await safeFire(sendTelegramMessage(`Starting execution for ${repoName}...`, null, threadId), { label: 'telegramCommands' })
    fireAndForget(executeApprovedTasks(repoFullName(repoName), repoName, threadId), { label: 'telegramCommands' })
    return true;
  }

  if (data.startsWith('skip:')) {
    await safeFire(answerCallback(queryId), { label: 'telegramCommands' })
    const repoName = data.replace('skip:', '');
    await stopAllTasksForRepo(repoFullName(repoName));
    await safeFire(sendTelegramMessage(`Audit skipped for ${repoName}.`, null, threadId), { label: 'telegramCommands' })
    return true;
  }

  if (data.startsWith('help:')) {
    await safeFire(answerCallback(queryId), { label: 'telegramCommands' })
    const section = data.replace('help:', '');
    const HELP_SECTIONS: Record<string, string> = {
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
        '/sentinel repos            — list all tracked repos',
        '/sentinel repos scan       — scan GitHub for new repos now',
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
        '/sentinel sync-metrics     — pull fresh health scores from GitHub API',
        '/sentinel menu             — quick action keyboard',
        '/sentinel help             — this menu',
      ].join('\n'),
      full: [
        '📖 All Commands',
        '',
        'REPORTS:  report, weekly, ceo, costs, health, velocity, patterns, business, impact, roi',
        'AGENTS:   agents, what, standup, leaderboard, bots, test-bots, setup-bots, memory',
        'REPOS:    audit, tasks, execute, force-execute, stop, skip, lock, unlock, locked, repo, repos, dashboard',
        'SPRINT:   propose-sprint, approve-sprint, run-sprint, sprint-status, skip-sprint, pause-sprint, resume-sprint, approve',
        'SECURITY: security, security-scan, security-patch, security-approve',
        'SYSTEM:   pause, resume, self-audit, self-approve, status, builds, performance, prompts, brain, check-builder, sync-metrics, reset-failed, menu, help',
        '',
        'All commands: /sentinel <command> [args]',
      ].join('\n'),
    };
    const helpText = HELP_SECTIONS[section] || 'Unknown section.';
    await safeFire(sendTelegramMessage(helpText, null, threadId), { label: 'telegramCommands' })
    return true;
  }

  if (data.startsWith('menu:')) {
    await safeFire(answerCallback(queryId), { label: 'telegramCommands' })
    const action = data.replace('menu:', '');
    try {
      if (action === 'report') {
        await sendDailyReport();
      } else if (action === 'costs') {
        const r = await getCostReport();
        await sendTelegramMessage(r.formatted, null, threadId);
      } else if (action === 'agents') {
        const s = await getAgentRoomSummary();
        await sendTelegramMessage(s, null, threadId);
      } else if (action === 'sprint') {
        await getSprintStatus(threadId);
      } else if (action === 'selfaudit') {
        await sendTelegramMessage('Triggering self-audit...', null, threadId);
        fireAndForget(runSelfAudit(), { label: 'telegramCommands' })
      } else if (action === 'security') {
        const { getPortfolioSecuritySummary } = require('./securityDb') as {
          getPortfolioSecuritySummary: () => Promise<SecurityScoreSummaryRow[]>;
        };
        const p = await getPortfolioSecuritySummary().catch(() => []);
        const lines = p.sort((a, b) => parseFloat(a.score) - parseFloat(b.score))
          .map((r) => `${r.repo_name}: ${r.score}/10 (${r.critical_count||0} critical)`);
        await sendTelegramMessage(`🔒 Security\n\n${lines.join('\n')||'No data yet.'}`, null, threadId);
      } else if (action === 'approvals') {
        const { showApprovalsMenu } = require('./telegramMenus');
        let sprintPending = false;
        try { const { isPendingAutoApprove } = require('./autoApprover'); sprintPending = await isPendingAutoApprove().catch(() => false); } catch (err: any) { logger.warn({ err: err.message }, 'autoApprover module failed to load — sprintPending defaults to false'); }
        await showApprovalsMenu(chatId, threadId, { sprint: sprintPending, selfAudit: false, security: null });
      } else if (action === 'last') {
        const { getRecentMessages } = require('./agentDb') as { getRecentMessages: (limit: number) => Promise<AgentMessageRow[]> };
        const msgs = await getRecentMessages(5).catch(() => [] as AgentMessageRow[]);
        const lines = msgs.map((m) => `· ${m.agent_id}: ${(m.message||'').slice(0, 60)}`).join('\n');
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
    } catch (err: any) {
      logger.warn({ err: err.message, action }, 'Menu callback failed');
    }
    return true;
  }

  if (data.startsWith('repo:')) {
    await safeFire(answerCallback(queryId), { label: 'telegramCommands' })
    const parts2     = data.split(':');
    const repoAction = parts2[1] || '';
    const repoName   = parts2[2] || '';
    const repoFull   = repoFullName(repoName);
    try {
      if (repoAction === 'audit') {
        const branchName = await getDefaultBranch(repoFull);
        fireAndForget(triggerAudit({
          repoFullName: repoFull,
          repoName,
          commitSha: `manual-${Date.now()}`,
          commitMessage: '[manual]',
          branchName,
          authorName: 'Human',
          authorEmail: '',
          topicId: threadId,
        }), { label: 'telegramCommands' })
        await sendTelegramMessage(`Audit triggered for ${repoName}.`, null, threadId);
      } else if (repoAction === 'execute') {
        fireAndForget(executeApprovedTasks(repoFull, repoName, threadId), { label: 'telegramCommands' })
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
        fireAndForget(runSecurityScan({ repoFullName: repoFull, repoName, commitSha: 'HEAD', topicId: threadId }), { label: 'telegramCommands' })
        await sendTelegramMessage(`Security scan started for ${repoName}.`, null, threadId);
      } else if (repoAction === 'status') {
        await sendTelegramMessage(`Use /sentinel status ${repoName} for details.`, null, threadId);
      }
    } catch (err: any) {
      logger.warn({ err: err.message, repoAction, repoName }, 'Repo callback failed');
    }
    return true;
  }

  if (data.startsWith('approve:')) {
    await safeFire(answerCallback(queryId), { label: 'telegramCommands' })
    const approveAction = data.replace('approve:', '');
    try {
      if (approveAction === 'sprint') {
        const { approveSprint } = require('./sprintOrchestrator');
        fireAndForget(approveSprint(threadId), { label: 'telegramCommands' })
      } else if (approveAction === 'skip-sprint') {
        try { const { cancelAutoApprove } = require('./autoApprover'); await cancelAutoApprove(); } catch (err: any) { logger.warn({ err: err.message }, 'cancelAutoApprove failed'); }
        const { getCurrentSprint, updateSprint } = require('./sprintDb');
        const sprint = await getCurrentSprint().catch(() => null);
        if (sprint) await updateSprint(sprint.id, { status: 'skipped' });
        await sendTelegramMessage('Sprint skipped. Next proposal Sunday 8pm.', null, threadId);
      } else if (approveAction === 'self') {
        fireAndForget(executeApprovedTasks(repoFullName('project-sentinel'), 'project-sentinel', threadId), { label: 'telegramCommands' })
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Approve callback failed');
    }
    return true;
  }

  if (data.startsWith('dym:')) {
    await safeFire(answerCallback(queryId), { label: 'telegramCommands' })
    const dymAction = data.replace('dym:', '');
    if (dymAction === 'cancel') {
      await safeFire(sendTelegramMessage('OK — nothing done.', null, threadId), { label: 'telegramCommands' })
    }
    return true;
  }

  if (data.startsWith('task-approve:')) {
    await safeFire(answerCallback(queryId), { label: 'telegramCommands' })
    const taskId = data.replace('task-approve:', '');
    const result = await query(
      `UPDATE audit_tasks SET safe_to_auto_execute = true
       WHERE id = $1 RETURNING repo_full_name, task_number, title`,
      [taskId]
    ).catch(() => null);
    if (result?.rows?.[0]) {
      const { repo_full_name, task_number, title } = result.rows[0];
      const repoName = repo_full_name.split('/')[1];
      await safeFire(sendTelegramMessage(
        `✅ Task #${task_number} approved: ${title}\nExecuting now...`, null, threadId
      ), { label: 'telegramCommands' })
      fireAndForget(executeApprovedTasks(repo_full_name, repoName, threadId), { label: 'telegramCommands' })
    }
    return true;
  }

  if (data.startsWith('task-skip:')) {
    await safeFire(answerCallback(queryId), { label: 'telegramCommands' })
    const taskId = data.replace('task-skip:', '');
    const sel = await query(
      'SELECT task_number, title FROM audit_tasks WHERE id = $1', [taskId]
    ).catch(() => null);
    if (sel?.rows?.[0]) {
      await updateAuditTask(parseInt(taskId, 10), { status: 'skipped' });
      await safeFire(sendTelegramMessage(
        `⏭️ Task #${sel.rows[0].task_number} skipped: ${sel.rows[0].title}`, null, threadId
      ), { label: 'telegramCommands' })
    }
    return true;
  }

  if (data.startsWith('task-approve-all:')) {
    await safeFire(answerCallback(queryId), { label: 'telegramCommands' })
    const repoFull  = data.replace('task-approve-all:', '');
    const repoName  = repoFull.split('/')[1] || '';
    await safeFire(query(
      `UPDATE audit_tasks SET safe_to_auto_execute = true
       WHERE repo_full_name = $1 AND status = 'queued'`,
      [repoFull]
    ), { label: 'telegramCommands' })
    await safeFire(sendTelegramMessage(
      `✅ All tasks approved for ${repoName}. Executing...`, null, threadId
    ), { label: 'telegramCommands' })
    fireAndForget(executeApprovedTasks(repoFull, repoName, threadId), { label: 'telegramCommands' })
    return true;
  }

  if (!data.startsWith('conflict:')) return false;

  const conflictParts = data.split(':');
  const action        = conflictParts[1];
  const conflictId    = conflictParts.slice(2).join(':');

  await safeFire(answerCallback(queryId), { label: 'telegramCommands' })

  const conflict = getPendingConflict(conflictId);
  if (!conflict) {
    await safeFire(sendTelegramMessage('Conflict already resolved or expired.', null, topicId), { label: 'telegramCommands' })
    return true;
  }

  const repoName = conflict.repoFullName.split('/')[1];

  switch (action) {
    case 'wait':
      await safeFire(sendTelegramMessage(
        `⏳ ${conflict.agentId} will wait. Conflict locks held — agent will retry.`,
        null, topicId
      ), { label: 'telegramCommands' })
      break;

    case 'skip':
      await safeFire(sendTelegramMessage(
        `⏭️ ${conflict.agentId} skipping conflicted files on ${repoName} and proceeding with the rest.`,
        null, topicId
      ), { label: 'telegramCommands' })
      break;

    case 'reassign':
      // conflict.lockedBy never existed on PendingConflict (only per-file
      // conflicts[].lockedBy does) — this always fell through to agentId at
      // runtime even under the old `any` typing; simplified accordingly.
      await safeFire(releaseAllLocks(conflict.repoFullName, conflict.agentId), { label: 'telegramCommands' })
      await safeFire(sendTelegramMessage(
        `🔄 Locks released for ${repoName}. ${conflict.agentId} can now acquire the files or be reassigned.`,
        null, topicId
      ), { label: 'telegramCommands' })
      break;
  }

  resolvePendingConflict(conflictId);
  return true;
}

export = { handleCommand, handleCallbackQuery };
