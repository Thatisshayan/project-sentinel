"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const safeFire_1 = require("../utils/safeFire");
const logger_1 = __importDefault(require("../logger"));
const repoResolver_1 = require("../repoResolver");
const telegramClient_1 = require("../telegramClient");
const notionClient_1 = require("../notionClient");
const dbClient_1 = require("../dbClient");
const auditOrchestrator_1 = require("../auditOrchestrator");
const auditDb_1 = require("../auditDb");
const agentDb_1 = require("../agentDb");
async function handleStop(projectArg, topicId) {
    if (!projectArg) {
        await (0, telegramClient_1.sendTelegramMessage)('Usage: /sentinel stop <repo-name>', null, topicId);
        return true;
    }
    try {
        await (0, dbClient_1.stopDebugAttempts)(projectArg);
        await (0, telegramClient_1.sendTelegramMessage)(`✅ Debug attempts stopped for: ${projectArg}\nNo further automatic fixes will run.`, null, topicId);
    }
    catch (err) {
        await (0, telegramClient_1.sendTelegramMessage)(`❌ Error stopping: ${err.message}`, null, topicId);
    }
    return true;
}
async function handleStatus(projectArg, topicId) {
    if (!projectArg) {
        await (0, telegramClient_1.sendTelegramMessage)('Usage: /sentinel status <repo-name>', null, topicId);
        return true;
    }
    try {
        const project = await (0, notionClient_1.findNotionProject)(projectArg);
        if (!project) {
            await (0, telegramClient_1.sendTelegramMessage)(`No Notion project found for: ${projectArg}`, null, topicId);
            return true;
        }
        await (0, telegramClient_1.sendTelegramMessage)(`Project: ${project.projectName}\nNotion: ${project.url}`, null, topicId);
    }
    catch (err) {
        await (0, telegramClient_1.sendTelegramMessage)(`❌ Error: ${err.message}`, null, topicId);
    }
    return true;
}
async function handleBuilds(projectArg, topicId) {
    if (!projectArg) {
        await (0, telegramClient_1.sendTelegramMessage)('Usage: /sentinel builds <repo-name>', null, topicId);
        return true;
    }
    try {
        const project = await (0, notionClient_1.findNotionProject)(projectArg);
        if (!project) {
            await (0, telegramClient_1.sendTelegramMessage)(`No project found for: ${projectArg}`, null, topicId);
            return true;
        }
        await (0, telegramClient_1.sendTelegramMessage)(`Checking builds for ${projectArg}...\n\nNote: Provide a commit SHA for detailed status.\nCheck GitHub Actions / Vercel / Railway directly for latest build.`, null, topicId);
    }
    catch (err) {
        await (0, telegramClient_1.sendTelegramMessage)(`❌ Error: ${err.message}`, null, topicId);
    }
    return true;
}
async function handleRetry(projectArg, topicId) {
    if (!projectArg) {
        await (0, telegramClient_1.sendTelegramMessage)('Usage: /sentinel retry <repo-name>', null, topicId);
        return true;
    }
    await (0, telegramClient_1.sendTelegramMessage)(`Manual retry for ${projectArg} is noted.\nPush a new commit to trigger the full loop, or check the latest build manually.`, null, topicId);
    return true;
}
async function handleHelp(topicId, chatId) {
    const { sendMenu } = require('../telegramMenus');
    await sendMenu(chatId, topicId, '🛡️ Project Sentinel — Command Reference', [
        [
            { text: '📊 Reports & Data', callback_data: 'help:reports' },
            { text: '🤖 Agents & Bots', callback_data: 'help:agents' },
        ],
        [
            { text: '🔨 Repos & Execution', callback_data: 'help:repos' },
            { text: '🏃 Sprint & Planning', callback_data: 'help:sprint' },
        ],
        [
            { text: '🔒 Security', callback_data: 'help:security' },
            { text: '⚙️ System & Control', callback_data: 'help:system' },
        ],
        [
            { text: '📖 Full Command List', callback_data: 'help:full' },
        ],
    ]);
    return true;
}
async function handleExecute(repoArg, topicId) {
    if (!repoArg) {
        await (0, telegramClient_1.sendTelegramMessage)('Usage: /sentinel execute <repo-name>', null, topicId);
        return true;
    }
    await (0, telegramClient_1.sendTelegramMessage)(`Starting task execution for ${repoArg}...`, null, topicId);
    (0, auditOrchestrator_1.executeApprovedTasks)((0, repoResolver_1.repoFullName)(repoArg), repoArg, topicId)
        .catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'Execute failed'));
    return true;
}
async function handleSkipAudit(repoArg, topicId) {
    await (0, auditDb_1.stopAllTasksForRepo)((0, repoResolver_1.repoFullName)(repoArg));
    await (0, telegramClient_1.sendTelegramMessage)(`Audit skipped for ${repoArg}. Tasks remain in Notion as Queued.`, null, topicId);
    return true;
}
async function handleManualAudit(repoArg, topicId) {
    if (!repoArg) {
        await (0, telegramClient_1.sendTelegramMessage)('Usage: /sentinel audit <repo-name>', null, topicId);
        return true;
    }
    const project = await (0, notionClient_1.findNotionProject)(repoArg).catch(() => null);
    await (0, telegramClient_1.sendTelegramMessage)(`Manual audit triggered for ${repoArg}...`, null, topicId);
    (0, auditOrchestrator_1.triggerAudit)({
        repoFullName: (0, repoResolver_1.repoFullName)(repoArg),
        repoName: repoArg,
        projectName: project?.projectName || repoArg,
        commitSha: `manual-${Date.now()}`,
        commitMessage: '[manual-audit]',
        branchName: 'main',
        authorName: 'Human',
        authorEmail: '',
        topicId,
    }).catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'Manual audit failed'));
    return true;
}
async function handleListTasks(repoArg, topicId, chatId) {
    if (!repoArg) {
        await (0, telegramClient_1.sendTelegramMessage)('Usage: /sentinel tasks <repo-name>', null, topicId);
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
  `, [(0, repoResolver_1.repoFullName)(repoArg)]);
    if (r.rows.length === 0) {
        await (0, telegramClient_1.sendTelegramMessage)(`No active tasks for ${repoArg}.`, null, topicId);
        return true;
    }
    const EMOJI = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
    const list = r.rows.map((t) => `${t.task_number}. [B${t.batch_number}] ${EMOJI[t.priority] || '⚪'} ${t.title} — ${t.status}${t.safe_to_auto_execute ? '' : ' 🔒'}`).join('\n');
    await (0, telegramClient_1.sendTelegramMessage)(`Tasks for ${repoArg}:\n\n${list}\n\n🔒 = needs approval`, null, topicId);
    const unsafe = r.rows.filter((t) => !t.safe_to_auto_execute && t.status === 'queued');
    if (unsafe.length > 0 && chatId) {
        const { sendMenu } = require('../telegramMenus');
        const buttons = unsafe.map((t) => [
            { text: `✅ #${t.task_number}: ${t.title.substring(0, 28)}`, callback_data: `task-approve:${t.id}` },
            { text: '⏭️ Skip', callback_data: `task-skip:${t.id}` },
        ]);
        buttons.push([
            { text: '✅ Approve All & Run', callback_data: `task-approve-all:${(0, repoResolver_1.repoFullName)(repoArg)}` },
        ]);
        await sendMenu(chatId, topicId, `🔒 ${unsafe.length} task(s) need your approval:`, buttons);
    }
    return true;
}
async function handleSkipBatch(repoArg, batchNumArg, topicId) {
    if (!repoArg || !batchNumArg) {
        await (0, telegramClient_1.sendTelegramMessage)('Usage: /sentinel skip-batch <repo-name> <batch-number>', null, topicId);
        return true;
    }
    const { query } = require('../dbClient');
    const r = await query(`
    SELECT id FROM audit_tasks
    WHERE repo_full_name=$1
      AND batch_number=$2
      AND status IN ('queued','in_progress')
  `, [(0, repoResolver_1.repoFullName)(repoArg), parseInt(batchNumArg)]);
    for (const row of r.rows) {
        await (0, auditDb_1.updateAuditTask)(row.id, { status: 'skipped' });
    }
    await (0, telegramClient_1.sendTelegramMessage)(`Batch ${batchNumArg} skipped for ${repoArg}. Moving to next batch...`, null, topicId);
    (0, safeFire_1.fireAndForget)((0, auditOrchestrator_1.processNextBatch)((0, repoResolver_1.repoFullName)(repoArg), repoArg, topicId), { label: 'repoOps' });
    return true;
}
async function handleRepoOpsCmd(subcommand, parts, chatId, topicId) {
    if (parts[2]) {
        const { canonicalizeRepoName } = require('../repoResolver');
        const canon = canonicalizeRepoName(parts[2]);
        if (canon)
            parts[2] = canon.repoName;
    }
    switch (subcommand) {
        case 'stop':
            return handleStop(parts[2] || '', topicId);
        case 'status':
            return handleStatus(parts[2] || '', topicId);
        case 'builds':
            return handleBuilds(parts[2] || '', topicId);
        case 'retry':
            return handleRetry(parts[2] || '', topicId);
        case 'help':
            return handleHelp(topicId, chatId);
        case 'execute':
            return handleExecute(parts[2] || '', topicId);
        case 'skip':
            if (parts[2])
                return handleSkipAudit(parts[2], topicId);
            await (0, telegramClient_1.sendTelegramMessage)('Usage: /sentinel skip <repo-name>', null, topicId);
            return true;
        case 'audit':
            return handleManualAudit(parts[2] || '', topicId);
        case 'tasks':
            return handleListTasks(parts[2] || '', topicId, chatId);
        case 'skip-batch':
            return handleSkipBatch(parts[2] || '', parts[3] || '', topicId);
        case 'lock': {
            if (!parts[2]) {
                await (0, telegramClient_1.sendTelegramMessage)('Usage: /sentinel lock <repo>', null, topicId);
                return true;
            }
            const { lockRepo } = require('../repoLock');
            await lockRepo(parts[2], 'manual');
            await (0, telegramClient_1.sendTelegramMessage)(`🔐 ${parts[2]} locked. No agents will touch it until /sentinel unlock ${parts[2]}`, null, topicId);
            return true;
        }
        case 'unlock': {
            if (!parts[2]) {
                await (0, telegramClient_1.sendTelegramMessage)('Usage: /sentinel unlock <repo>', null, topicId);
                return true;
            }
            const { unlockRepo } = require('../repoLock');
            await unlockRepo(parts[2]);
            await (0, telegramClient_1.sendTelegramMessage)(`🔓 ${parts[2]} unlocked.`, null, topicId);
            return true;
        }
        case 'locked': {
            const { getAllLocked } = require('../repoLock');
            const locked = await getAllLocked();
            if (locked.length === 0) {
                await (0, telegramClient_1.sendTelegramMessage)('No repos currently locked.', null, topicId);
                return true;
            }
            const lines = locked.map((l) => `🔐 ${l.repoName} — ${l.reason} (since ${new Date(l.lockedAt).toLocaleTimeString('en-CA')})`);
            await (0, telegramClient_1.sendTelegramMessage)(lines.join('\n'), null, topicId);
            return true;
        }
        case 'health': {
            const { getPortfolioSummary } = require('../portfolioAnalytics');
            const s = await getPortfolioSummary().catch(() => null);
            if (!s) {
                await (0, telegramClient_1.sendTelegramMessage)('Portfolio data unavailable.', null, topicId);
                return true;
            }
            const lines = [...s.metrics]
                .sort((a, b) => parseFloat(a.health_score) - parseFloat(b.health_score))
                .map((m) => {
                const score = parseFloat(m.health_score);
                const dot = score >= 7 ? '🟢' : score >= 5 ? '🟡' : '🔴';
                return `${dot} ${m.repo_name}: ${m.health_score}/10`;
            });
            await (0, telegramClient_1.sendTelegramMessage)(`Portfolio Health\n\n${lines.join('\n')}`, null, topicId);
            return true;
        }
        case 'what': {
            const working = (await (0, agentDb_1.getAllAgents)().catch(() => [])).filter((a) => a.status === 'working');
            if (working.length === 0) {
                await (0, telegramClient_1.sendTelegramMessage)('Sentinel is idle. No active agent tasks.', null, topicId);
                return true;
            }
            const lines = working.map((a) => `· ${a.agent_label} → ${a.repo_full_name?.split('/')[1]} — ${a.task_title}`);
            await (0, telegramClient_1.sendTelegramMessage)(`🤖 Active right now:\n\n${lines.join('\n')}`, null, topicId);
            return true;
        }
        case 'force-execute': {
            if (!parts[2]) {
                await (0, telegramClient_1.sendTelegramMessage)('Usage: /sentinel force-execute <repo>', null, topicId);
                return true;
            }
            const { query: dbQuery } = require('../dbClient');
            const updated = await dbQuery(`
        UPDATE audit_tasks SET safe_to_auto_execute = true
        WHERE repo_full_name = $1 AND status = 'queued'
        RETURNING id
      `, [(0, repoResolver_1.repoFullName)(parts[2])]).catch(() => null);
            const count = updated?.rows?.length || 0;
            await (0, telegramClient_1.sendTelegramMessage)(`Unlocked ${count} tasks for ${parts[2]}. Starting execution...`, null, topicId);
            if (count > 0) {
                (0, auditOrchestrator_1.executeApprovedTasks)((0, repoResolver_1.repoFullName)(parts[2]), parts[2], topicId)
                    .catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'Force-execute failed'));
            }
            return true;
        }
        case 'security': {
            const { getOpenIssues, getLatestSecurityScore, getPortfolioSecuritySummary } = require('../securityDb');
            if (parts[2]) {
                const [score, issues] = await Promise.all([
                    getLatestSecurityScore(parts[2]),
                    getOpenIssues((0, repoResolver_1.repoFullName)(parts[2])),
                ]);
                const counts = {
                    critical: issues.filter((i) => i.severity === 'critical').length,
                    high: issues.filter((i) => i.severity === 'high').length,
                    medium: issues.filter((i) => i.severity === 'medium').length,
                    low: issues.filter((i) => i.severity === 'low').length,
                };
                await (0, telegramClient_1.sendTelegramMessage)([
                    `🔒 Security — ${parts[2]}`,
                    `Score: ${score?.score || 'N/A'}/10`,
                    ``,
                    `🔴 Critical: ${counts.critical}`,
                    `🟠 High: ${counts.high}`,
                    `🟡 Medium: ${counts.medium}`,
                    `🟢 Low: ${counts.low}`,
                    ``,
                    issues.slice(0, 5).map((i) => `  · [${i.severity}] ${i.title}`).join('\n'),
                    ``,
                    `/sentinel security-scan ${parts[2]} — fresh scan`,
                    `/sentinel security-patch ${parts[2]} — auto-fix safe issues`,
                ].join('\n'), null, topicId);
            }
            else {
                const portfolio = await getPortfolioSecuritySummary();
                const lines = portfolio
                    .sort((a, b) => parseFloat(a.score) - parseFloat(b.score))
                    .map((r) => `${r.repo_name}: ${r.score}/10 (${r.critical_count || 0} critical)`);
                await (0, telegramClient_1.sendTelegramMessage)(`🔒 Portfolio Security\n\n${lines.join('\n') || 'No security data yet.'}`, null, topicId);
            }
            return true;
        }
        case 'security-scan': {
            if (!parts[2]) {
                await (0, telegramClient_1.sendTelegramMessage)('Usage: /sentinel security-scan <repo>', null, topicId);
                return true;
            }
            const { runSecurityScan } = require('../securityScanner');
            await (0, telegramClient_1.sendTelegramMessage)(`Running security scan on ${parts[2]}...`, null, topicId);
            (0, safeFire_1.fireAndForget)(runSecurityScan({
                repoFullName: (0, repoResolver_1.repoFullName)(parts[2]),
                repoName: parts[2], commitSha: 'HEAD', topicId,
            }), { label: 'repoOps' });
            return true;
        }
        case 'security-patch': {
            if (!parts[2]) {
                await (0, telegramClient_1.sendTelegramMessage)('Usage: /sentinel security-patch <repo>', null, topicId);
                return true;
            }
            const { getOpenIssues: getIssues } = require('../securityDb');
            const { applySecurityPatches } = require('../securityPatcher');
            const patchIssues = await getIssues((0, repoResolver_1.repoFullName)(parts[2]));
            (0, safeFire_1.fireAndForget)(applySecurityPatches((0, repoResolver_1.repoFullName)(parts[2]), parts[2], patchIssues, topicId), { label: 'repoOps' });
            return true;
        }
        case 'security-approve': {
            await (0, telegramClient_1.sendTelegramMessage)(`Security approval for ${parts[2] || 'repo'} noted.\nReview and merge the open PR on GitHub.`, null, topicId);
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
            const seenNames = new Set(seen.rows.map((r) => r.repo_name.toLowerCase()));
            const allNames = allMetrics.rows.map((r) => r.repo_name.toLowerCase());
            const missing = allNames.filter((n) => !seenNames.has(n));
            const receivingLines = seen.rows.map((r) => `✅ ${r.repo_name} — last event ${new Date(r.last_seen).toLocaleDateString('en-CA')} (${r.events} events)`);
            const missingLines = missing.map((n) => `❌ ${n} — no webhook events in 7 days`);
            await (0, telegramClient_1.sendTelegramMessage)([
                `Webhook Status (last 7 days)`,
                ``,
                ...receivingLines,
                ...(missingLines.length ? ['', 'Missing webhooks:', ...missingLines] : []),
                ``,
                `For missing repos: GitHub repo → Settings → Webhooks → Add`,
                `URL: ${process.env['RAILWAY_PUBLIC_DOMAIN'] ? `https://${process.env['RAILWAY_PUBLIC_DOMAIN']}/webhook/github` : '<RAILWAY_URL>/webhook/github'}`,
                `Events: push, pull_request`,
            ].join('\n'), null, topicId);
            return true;
        }
        case 'brain': {
            const { runStrategicBrain } = require('../sentinelBrain');
            await (0, telegramClient_1.sendTelegramMessage)('🧠 Running strategic brain...', null, topicId);
            runStrategicBrain(topicId).catch((err) => logger_1.default.error({ err: err.stack ?? err.message }, 'Manual brain run failed'));
            return true;
        }
        case 'menu': {
            const { showMainMenu } = require('../telegramMenus');
            await showMainMenu(chatId, topicId);
            return true;
        }
        case 'repo': {
            if (!parts[2]) {
                await (0, telegramClient_1.sendTelegramMessage)('Usage: /sentinel repo <name>', null, topicId);
                return true;
            }
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
            }
            catch { }
            await showApprovalsMenu(chatId, topicId, {
                sprint: sprintPending,
                selfAudit: false,
                security: null,
            });
            return true;
        }
        case 'pause': {
            try {
                const { cancelAutoApprove } = require('../autoApprover');
                await (0, safeFire_1.safeFire)(cancelAutoApprove(), { label: 'repoOps' });
            }
            catch { }
            try {
                await (0, dbClient_1.query)(`UPDATE agent_registry SET status='paused' WHERE status='idle'`);
            }
            catch (err) {
                logger_1.default.error({ err: err.stack ?? err.message }, 'Telegram pause failed to update agent_registry');
            }
            await (0, telegramClient_1.sendTelegramMessage)('⏸ All automation paused.\nSprints, audits, and builds will not auto-execute. All idle agents have been paused.\nSend /sentinel resume to restart.', null, topicId);
            return true;
        }
        case 'resume': {
            try {
                await (0, dbClient_1.query)(`UPDATE agent_registry SET status='idle' WHERE status='paused'`);
            }
            catch (err) {
                logger_1.default.error({ err: err.stack ?? err.message }, 'Telegram resume failed to update agent_registry');
            }
            await (0, telegramClient_1.sendTelegramMessage)('▶️ Automation resumed. Paused agents are idle again.', null, topicId);
            return true;
        }
        case 'reset-failed': {
            if (!parts[2]) {
                await (0, telegramClient_1.sendTelegramMessage)('Usage: /sentinel reset-failed <repo>', null, topicId);
                return true;
            }
            const { query: dbq } = require('../dbClient');
            const r = await dbq(`
        UPDATE audit_tasks
        SET status = 'queued', failure_reason = NULL
        WHERE repo_full_name = $1 AND status = 'failed'
        RETURNING id
      `, [(0, repoResolver_1.repoFullName)(parts[2])]).catch(() => null);
            const count = r?.rows?.length || 0;
            await (0, telegramClient_1.sendTelegramMessage)(`♻️ Reset ${count} failed tasks to queued for ${parts[2]}.\n/sentinel execute ${parts[2]} to run them.`, null, topicId);
            return true;
        }
        case 'repos': {
            if (parts[2] === 'scan') {
                await (0, telegramClient_1.sendTelegramMessage)('🔎 Scanning GitHub for new repos...', null, topicId);
                const { discoverAndOnboardRepos } = require('../repoDiscovery');
                discoverAndOnboardRepos()
                    .then((result) => (0, telegramClient_1.sendTelegramMessage)(result.discovered > 0
                    ? `✅ Found and onboarded ${result.discovered} new repo(s): ${result.repos.join(', ')}`
                    : '✅ Scan complete — no new repos found.', null, topicId))
                    .catch((err) => (0, telegramClient_1.sendTelegramMessage)(`❌ Repo scan failed: ${err.message}`, null, topicId));
                return true;
            }
            const { getFullRepoList } = require('../repoDiscovery');
            const list = await getFullRepoList().catch(() => []);
            await (0, telegramClient_1.sendTelegramMessage)([`📁 Tracked repos (${list.length}):`, ...list.map((r) => `· ${r.repoName}`),
                '', '/sentinel repos scan — scan GitHub for new repos now'].join('\n'), null, topicId);
            return true;
        }
        case 'sync-metrics': {
            await (0, telegramClient_1.sendTelegramMessage)('🔄 Syncing repo health metrics from GitHub API...', null, topicId);
            const { syncAllRepoMetrics } = require('../githubMetricsSyncer');
            syncAllRepoMetrics()
                .then((result) => (0, telegramClient_1.sendTelegramMessage)(`✅ Metrics sync complete — ${result?.synced ?? 0}/${result?.total ?? 0} repos updated.`, null, topicId))
                .catch((err) => (0, telegramClient_1.sendTelegramMessage)(`❌ Metrics sync failed: ${err.message}`, null, topicId));
            return true;
        }
        case 'check-builder': {
            const { execAsync } = require('../utils/execAsync');
            const { listBuilders } = require('../builderRouter');
            const lines = [];
            try {
                const { stdout } = await execAsync('aider --version 2>&1', { timeout: 8000 });
                lines.push(`✅ aider: ${stdout.trim()}`);
            }
            catch (e) {
                lines.push(`❌ aider: NOT FOUND — builder tasks will fail`);
            }
            try {
                await execAsync('git --version 2>&1', { timeout: 5000 });
                lines.push(`✅ git: available`);
            }
            catch {
                lines.push(`❌ git: NOT FOUND`);
            }
            lines.push('');
            const builders = listBuilders();
            for (const b of builders) {
                const icon = b.configured ? '✅' : '○';
                lines.push(`${icon} ${b.label}${b.configured ? '' : ' — key not set'}`);
            }
            await (0, telegramClient_1.sendTelegramMessage)(`🔧 Builder Status\n\n${lines.join('\n')}`, null, topicId);
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
//# sourceMappingURL=repoOps.js.map