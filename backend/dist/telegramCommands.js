"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("./utils/safeFire");
const logger_1 = __importDefault(require("./logger"));
const repoResolver_1 = require("./repoResolver");
const telegramClient_1 = require("./telegramClient");
const dbClient_1 = require("./dbClient");
const auditOrchestrator_1 = require("./auditOrchestrator");
const auditDb_1 = require("./auditDb");
const telegramAI_1 = require("./telegramAI");
const sprintOrchestrator_1 = require("./sprintOrchestrator");
const agentRoom_1 = require("./agentRoom");
const agentDb_1 = require("./agentDb");
const selfAuditor_1 = require("./selfAuditor");
const telegramMenus_1 = require("./telegramMenus");
const dailyReport_1 = require("./dailyReport");
const costTracker_1 = require("./costTracker");
const agentReplies_1 = require("./agentReplies");
const conflictDetector_1 = require("./conflictDetector");
const agents_1 = require("./commands/agents");
const repoOps_1 = require("./commands/repoOps");
const reports_1 = require("./commands/reports");
const sprint_1 = require("./commands/sprint");
const KNOWN_AGENT_IDS = ['nvidia', 'qwen_coder', 'qwen_coder_dash', 'llama_fast', 'gemini', 'qwen_max', 'qwen_turbo', 'deepseek', 'qwen_plus', 'opencode'];
async function handleCommand(text, chatId, topicId, fromName, message = null) {
    // Phase 8.5 — if this is a reply to a specific agent bot, route directly to that agent
    if (message) {
        const targetAgent = (0, agentReplies_1.detectAgentReply)(message);
        if (targetAgent) {
            await (0, agentReplies_1.handleAgentReply)(message, targetAgent, topicId);
            return true;
        }
    }
    // Route non-slash messages to AI agent
    if (!text.trim().startsWith('/')) {
        const isAgentRoom = topicId != null && String(topicId) === String(process.env['AGENT_ROOM_TOPIC_ID']);
        if (isAgentRoom) {
            let roomContext = await (0, agentRoom_1.getAgentRoomSummary)().catch(() => '');
            // Enrich roomContext with specific agent status when @mentioned
            const mentioned = KNOWN_AGENT_IDS.filter(id => text.toLowerCase().includes(`@${id}`));
            if (mentioned.length > 0) {
                const agents = await (0, agentDb_1.getAllAgents)().catch(() => []);
                const mentionLines = mentioned.map(id => {
                    const a = agents.find((x) => x.agent_id === id);
                    if (!a)
                        return `@${id}: not registered`;
                    return a.status === 'working'
                        ? `@${id}: working on ${a.repo_full_name?.split('/')[1]} — ${a.task_title}`
                        : `@${id}: idle (${a.completed_tasks} done, ${a.failed_tasks} failed)`;
                }).join('\n');
                roomContext += `\n\nMENTIONED AGENTS:\n${mentionLines}`;
            }
            (0, telegramAI_1.handleMessage)(text, fromName || 'Shayan', topicId, roomContext);
        }
        else {
            (0, telegramAI_1.handleMessage)(text, fromName || 'Shayan', topicId);
        }
        return false;
    }
    const parts = text.trim().split(/\s+/);
    const command = parts[0]?.toLowerCase().split('@')[0]; // strip @BotName suffix Telegram adds in groups
    // Top-level commands Telegram's native "/" menu can send directly
    if (command === '/start' || command === '/menu') {
        await (0, telegramMenus_1.showMainMenu)(chatId, topicId ?? null);
        return true;
    }
    if (command === '/help') {
        return (0, repoOps_1.handleHelp)(topicId, String(chatId));
    }
    if (command !== '/sentinel' || !parts[1])
        return false;
    const subcommand = parts[1].toLowerCase();
    // Delegate to the modular command handlers
    if (await (0, sprint_1.handleSprintCmd)(subcommand, parts, String(chatId), topicId))
        return true;
    if (await (0, reports_1.handleReportsCmd)(subcommand, parts, String(chatId), topicId))
        return true;
    if (await (0, agents_1.handleAgentsCmd)(subcommand, parts, String(chatId), topicId))
        return true;
    if (await (0, repoOps_1.handleRepoOpsCmd)(subcommand, parts, String(chatId), topicId))
        return true;
    return false;
}
// Improvement 4 — conflict resolution via inline keyboard button presses.
async function handleCallbackQuery(callbackQuery) {
    const data = callbackQuery.data || '';
    const queryId = callbackQuery.id;
    const topicId = callbackQuery.message?.message_thread_id;
    const chatId = callbackQuery.message?.chat?.id;
    const threadId = topicId;
    // ── Phase 10 — Menu callbacks ─────────────────────────────────────────────
    // Inline approval buttons from audit completion message
    if (data.startsWith('execute:')) {
        await (0, safeFire_1.safeFire)((0, agentRoom_1.answerCallback)(queryId), { label: 'telegramCommands' });
        const repoName = data.replace('execute:', '');
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`Starting execution for ${repoName}...`, null, threadId), { label: 'telegramCommands' });
        (0, safeFire_1.fireAndForget)((0, auditOrchestrator_1.executeApprovedTasks)((0, repoResolver_1.repoFullName)(repoName), repoName, threadId), { label: 'telegramCommands' });
        return true;
    }
    if (data.startsWith('skip:')) {
        await (0, safeFire_1.safeFire)((0, agentRoom_1.answerCallback)(queryId), { label: 'telegramCommands' });
        const repoName = data.replace('skip:', '');
        await (0, auditDb_1.stopAllTasksForRepo)((0, repoResolver_1.repoFullName)(repoName));
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`Audit skipped for ${repoName}.`, null, threadId), { label: 'telegramCommands' });
        return true;
    }
    if (data.startsWith('help:')) {
        await (0, safeFire_1.safeFire)((0, agentRoom_1.answerCallback)(queryId), { label: 'telegramCommands' });
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
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(helpText, null, threadId), { label: 'telegramCommands' });
        return true;
    }
    if (data.startsWith('menu:')) {
        await (0, safeFire_1.safeFire)((0, agentRoom_1.answerCallback)(queryId), { label: 'telegramCommands' });
        const action = data.replace('menu:', '');
        try {
            if (action === 'report') {
                await (0, dailyReport_1.sendDailyReport)();
            }
            else if (action === 'costs') {
                const r = await (0, costTracker_1.getCostReport)();
                await (0, telegramClient_1.sendTelegramMessage)(r.formatted, null, threadId);
            }
            else if (action === 'agents') {
                const s = await (0, agentRoom_1.getAgentRoomSummary)();
                await (0, telegramClient_1.sendTelegramMessage)(s, null, threadId);
            }
            else if (action === 'sprint') {
                await (0, sprintOrchestrator_1.getSprintStatus)(threadId);
            }
            else if (action === 'selfaudit') {
                await (0, telegramClient_1.sendTelegramMessage)('Triggering self-audit...', null, threadId);
                (0, safeFire_1.fireAndForget)((0, selfAuditor_1.runSelfAudit)(), { label: 'telegramCommands' });
            }
            else if (action === 'security') {
                const { getPortfolioSecuritySummary } = require('./securityDb');
                const p = await getPortfolioSecuritySummary().catch(() => []);
                const lines = p.sort((a, b) => parseFloat(a.score) - parseFloat(b.score))
                    .map((r) => `${r.repo_name}: ${r.score}/10 (${r.critical_count || 0} critical)`);
                await (0, telegramClient_1.sendTelegramMessage)(`🔒 Security\n\n${lines.join('\n') || 'No data yet.'}`, null, threadId);
            }
            else if (action === 'approvals') {
                const { showApprovalsMenu } = require('./telegramMenus');
                let sprintPending = false;
                try {
                    const { isPendingAutoApprove } = require('./autoApprover');
                    sprintPending = await isPendingAutoApprove().catch(() => false);
                }
                catch { }
                await showApprovalsMenu(chatId, threadId, { sprint: sprintPending, selfAudit: false, security: null });
            }
            else if (action === 'last') {
                const { getRecentMessages } = require('./agentDb');
                const msgs = await getRecentMessages(5).catch(() => []);
                const lines = msgs.map((m) => `· ${m.agent_id}: ${(m.message || '').slice(0, 60)}`).join('\n');
                await (0, telegramClient_1.sendTelegramMessage)(lines || 'No recent agent messages.', null, threadId);
            }
            else if (action === 'help') {
                await (0, telegramClient_1.sendTelegramMessage)([
                    '/sentinel menu — this menu',
                    '/sentinel repo <name> — repo control panel',
                    '/sentinel health — all repos health scores',
                    '/sentinel what — active agent tasks right now',
                    '/sentinel pause — emergency stop all automation',
                ].join('\n'), null, threadId);
            }
        }
        catch (err) {
            logger_1.default.warn({ err: err.message, action }, 'Menu callback failed');
        }
        return true;
    }
    if (data.startsWith('repo:')) {
        await (0, safeFire_1.safeFire)((0, agentRoom_1.answerCallback)(queryId), { label: 'telegramCommands' });
        const parts2 = data.split(':');
        const repoAction = parts2[1];
        const repoName = parts2[2];
        const repoFull = (0, repoResolver_1.repoFullName)(repoName);
        try {
            if (repoAction === 'audit') {
                const { triggerAudit } = require('./auditOrchestrator');
                (0, safeFire_1.fireAndForget)(triggerAudit({ repoFullName: repoFull, repoName, commitSha: `manual-${Date.now()}`,
                    commitMessage: '[manual]', branchName: 'main', authorName: 'Human', authorEmail: '', topicId: threadId }), { label: 'telegramCommands' });
                await (0, telegramClient_1.sendTelegramMessage)(`Audit triggered for ${repoName}.`, null, threadId);
            }
            else if (repoAction === 'execute') {
                (0, safeFire_1.fireAndForget)((0, auditOrchestrator_1.executeApprovedTasks)(repoFull, repoName, threadId), { label: 'telegramCommands' });
                await (0, telegramClient_1.sendTelegramMessage)(`Executing tasks for ${repoName}...`, null, threadId);
            }
            else if (repoAction === 'stop') {
                await (0, auditDb_1.stopAllTasksForRepo)(repoFull);
                await (0, telegramClient_1.sendTelegramMessage)(`Stopped all tasks for ${repoName}.`, null, threadId);
            }
            else if (repoAction === 'lock') {
                const { lockRepo } = require('./repoLock');
                await lockRepo(repoName, 'inline-menu');
                await (0, telegramClient_1.sendTelegramMessage)(`🔐 ${repoName} locked.`, null, threadId);
            }
            else if (repoAction === 'security') {
                const { runSecurityScan } = require('./securityScanner');
                (0, safeFire_1.fireAndForget)(runSecurityScan({ repoFullName: repoFull, repoName, commitSha: 'HEAD', topicId: threadId }), { label: 'telegramCommands' });
                await (0, telegramClient_1.sendTelegramMessage)(`Security scan started for ${repoName}.`, null, threadId);
            }
            else if (repoAction === 'status') {
                await (0, telegramClient_1.sendTelegramMessage)(`Use /sentinel status ${repoName} for details.`, null, threadId);
            }
        }
        catch (err) {
            logger_1.default.warn({ err: err.message, repoAction, repoName }, 'Repo callback failed');
        }
        return true;
    }
    if (data.startsWith('approve:')) {
        await (0, safeFire_1.safeFire)((0, agentRoom_1.answerCallback)(queryId), { label: 'telegramCommands' });
        const approveAction = data.replace('approve:', '');
        try {
            if (approveAction === 'sprint') {
                const { approveSprint } = require('./sprintOrchestrator');
                (0, safeFire_1.fireAndForget)(approveSprint(threadId), { label: 'telegramCommands' });
            }
            else if (approveAction === 'skip-sprint') {
                try {
                    const { cancelAutoApprove } = require('./autoApprover');
                    await cancelAutoApprove();
                }
                catch { }
                const { getCurrentSprint, updateSprint } = require('./sprintDb');
                const sprint = await getCurrentSprint().catch(() => null);
                if (sprint)
                    await updateSprint(sprint.id, { status: 'skipped' });
                await (0, telegramClient_1.sendTelegramMessage)('Sprint skipped. Next proposal Sunday 8pm.', null, threadId);
            }
            else if (approveAction === 'self') {
                (0, safeFire_1.fireAndForget)((0, auditOrchestrator_1.executeApprovedTasks)((0, repoResolver_1.repoFullName)('project-sentinel'), 'project-sentinel', threadId), { label: 'telegramCommands' });
            }
        }
        catch (err) {
            logger_1.default.warn({ err: err.message }, 'Approve callback failed');
        }
        return true;
    }
    if (data.startsWith('dym:')) {
        await (0, safeFire_1.safeFire)((0, agentRoom_1.answerCallback)(queryId), { label: 'telegramCommands' });
        const dymAction = data.replace('dym:', '');
        if (dymAction === 'cancel') {
            await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)('OK — nothing done.', null, threadId), { label: 'telegramCommands' });
        }
        return true;
    }
    if (data.startsWith('task-approve:')) {
        await (0, safeFire_1.safeFire)((0, agentRoom_1.answerCallback)(queryId), { label: 'telegramCommands' });
        const taskId = data.replace('task-approve:', '');
        const result = await (0, dbClient_1.query)(`UPDATE audit_tasks SET safe_to_auto_execute = true
       WHERE id = $1 RETURNING repo_full_name, task_number, title`, [taskId]).catch(() => null);
        if (result?.rows?.[0]) {
            const { repo_full_name, task_number, title } = result.rows[0];
            const repoName = repo_full_name.split('/')[1];
            await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`✅ Task #${task_number} approved: ${title}\nExecuting now...`, null, threadId), { label: 'telegramCommands' });
            (0, safeFire_1.fireAndForget)((0, auditOrchestrator_1.executeApprovedTasks)(repo_full_name, repoName, threadId), { label: 'telegramCommands' });
        }
        return true;
    }
    if (data.startsWith('task-skip:')) {
        await (0, safeFire_1.safeFire)((0, agentRoom_1.answerCallback)(queryId), { label: 'telegramCommands' });
        const taskId = data.replace('task-skip:', '');
        const sel = await (0, dbClient_1.query)('SELECT task_number, title FROM audit_tasks WHERE id = $1', [taskId]).catch(() => null);
        if (sel?.rows?.[0]) {
            await (0, auditDb_1.updateAuditTask)(taskId, { status: 'skipped' });
            await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`⏭️ Task #${sel.rows[0].task_number} skipped: ${sel.rows[0].title}`, null, threadId), { label: 'telegramCommands' });
        }
        return true;
    }
    if (data.startsWith('task-approve-all:')) {
        await (0, safeFire_1.safeFire)((0, agentRoom_1.answerCallback)(queryId), { label: 'telegramCommands' });
        const repoFull = data.replace('task-approve-all:', '');
        const repoName = repoFull.split('/')[1];
        await (0, safeFire_1.safeFire)((0, dbClient_1.query)(`UPDATE audit_tasks SET safe_to_auto_execute = true
       WHERE repo_full_name = $1 AND status = 'queued'`, [repoFull]), { label: 'telegramCommands' });
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`✅ All tasks approved for ${repoName}. Executing...`, null, threadId), { label: 'telegramCommands' });
        (0, safeFire_1.fireAndForget)((0, auditOrchestrator_1.executeApprovedTasks)(repoFull, repoName, threadId), { label: 'telegramCommands' });
        return true;
    }
    if (!data.startsWith('conflict:'))
        return false;
    const conflictParts = data.split(':');
    const action = conflictParts[1];
    const conflictId = conflictParts.slice(2).join(':');
    await (0, safeFire_1.safeFire)((0, agentRoom_1.answerCallback)(queryId), { label: 'telegramCommands' });
    const conflict = (0, conflictDetector_1.getPendingConflict)(conflictId);
    if (!conflict) {
        await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)('Conflict already resolved or expired.', null, topicId), { label: 'telegramCommands' });
        return true;
    }
    const repoName = conflict.repoFullName.split('/')[1];
    switch (action) {
        case 'wait':
            await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`⏳ ${conflict.agentId} will wait. Conflict locks held — agent will retry.`, null, topicId), { label: 'telegramCommands' });
            break;
        case 'skip':
            await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`⏭️ ${conflict.agentId} skipping conflicted files on ${repoName} and proceeding with the rest.`, null, topicId), { label: 'telegramCommands' });
            break;
        case 'reassign':
            await (0, safeFire_1.safeFire)((0, conflictDetector_1.releaseAllLocks)(conflict.repoFullName, conflict.lockedBy || conflict.agentId), { label: 'telegramCommands' });
            await (0, safeFire_1.safeFire)((0, telegramClient_1.sendTelegramMessage)(`🔄 Locks released for ${repoName}. ${conflict.agentId} can now acquire the files or be reassigned.`, null, topicId), { label: 'telegramCommands' });
            break;
    }
    (0, conflictDetector_1.resolvePendingConflict)(conflictId);
    return true;
}
module.exports = { handleCommand, handleCallbackQuery };
//# sourceMappingURL=telegramCommands.js.map