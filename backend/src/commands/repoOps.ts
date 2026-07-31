import { safeFire, fireAndForget } from '../utils/safeFire';
import logger from '../logger';
import { repoFullName } from '../repoResolver';
import { sendTelegramMessage } from '../telegramClient';
import { findNotionProject } from '../notionClient';
import { stopDebugAttempts, query as dbQuery } from '../dbClient';
import { executeApprovedTasks, triggerAudit, processNextBatch } from '../auditOrchestrator';
import { stopAllTasksForRepo, updateAuditTask } from '../auditDb';
import { getAllAgents } from '../agentDb';
import type {
  getOpenIssues as getOpenIssuesType,
  getLatestSecurityScore as getLatestSecurityScoreType,
  getPortfolioSecuritySummary as getPortfolioSecuritySummaryType,
  resolveAllOpenIssues as resolveAllOpenIssuesType,
} from '../securityDb';
import type { runSecurityScan as runSecurityScanType } from '../securityScanner';
import type { applySecurityPatches as applySecurityPatchesType } from '../securityPatcher';
import type { getPortfolioSummary as getPortfolioSummaryType } from '../portfolioAnalytics';
import type { getAllLocked as getAllLockedType, lockRepo as lockRepoType, unlockRepo as unlockRepoType } from '../repoLock';
import type {
  addMemoryEntry as addMemoryEntryType,
  getMemoryEntries as getMemoryEntriesType,
  deleteMemoryEntry as deleteMemoryEntryType,
} from '../projectMemory';
import type {
  getFullRepoList as getFullRepoListType,
  getDefaultBranch as getDefaultBranchType,
  discoverAndOnboardRepos as discoverAndOnboardReposType,
} from '../repoDiscovery';
import type { runStrategicBrain as runStrategicBrainType } from '../sentinelBrain';
import type { updateSettings as updateSettingsType } from '../settingsDb';
import type { isPendingAutoApprove as isPendingAutoApproveType, cancelAutoApprove as cancelAutoApproveType } from '../autoApprover';
import type { syncAllRepoMetrics as syncAllRepoMetricsType } from '../githubMetricsSyncer';
import type { execAsync as execAsyncType } from '../utils/execAsync';
import type { listBuilders as listBuildersType } from '../builderRouter';
import type { canonicalizeRepoName as canonicalizeRepoNameType } from '../repoResolver';
import type {
  sendMenu as sendMenuType,
  showMainMenu as showMainMenuType,
  showRepoMenu as showRepoMenuType,
  showApprovalsMenu as showApprovalsMenuType,
} from '../telegramMenus';

async function handleStop(projectArg: string, topicId: number | null): Promise<boolean> {
  if (!projectArg) {
    await sendTelegramMessage('Usage: /sentinel stop <repo-name>', null, topicId);
    return true;
  }
  try {
    await stopDebugAttempts(projectArg);
    await sendTelegramMessage(
      `✅ Debug attempts stopped for: ${projectArg}\nNo further automatic fixes will run.`,
      projectArg, topicId
    );
  } catch (err: any) {
    await sendTelegramMessage(`❌ Error stopping: ${err.message}`, projectArg, topicId);
  }
  return true;
}

async function handleStatus(projectArg: string, topicId: number | null): Promise<boolean> {
  if (!projectArg) {
    await sendTelegramMessage('Usage: /sentinel status <repo-name>', null, topicId);
    return true;
  }
  try {
    const project = await findNotionProject(projectArg);
    if (!project) {
      await sendTelegramMessage(`No Notion project found for: ${projectArg}`, projectArg, topicId);
      return true;
    }
    await sendTelegramMessage(
      `Project: ${project.projectName}\nNotion: ${project.url}`,
      projectArg, topicId
    );
  } catch (err: any) {
    await sendTelegramMessage(`❌ Error: ${err.message}`, projectArg, topicId);
  }
  return true;
}

async function handleBuilds(projectArg: string, topicId: number | null): Promise<boolean> {
  if (!projectArg) {
    await sendTelegramMessage('Usage: /sentinel builds <repo-name>', null, topicId);
    return true;
  }
  try {
    const project = await findNotionProject(projectArg);
    if (!project) {
      await sendTelegramMessage(`No project found for: ${projectArg}`, projectArg, topicId);
      return true;
    }
    await sendTelegramMessage(
      `Checking builds for ${projectArg}...\n\nNote: Provide a commit SHA for detailed status.\nCheck GitHub Actions / Vercel / Railway directly for latest build.`,
      projectArg, topicId
    );
  } catch (err: any) {
    await sendTelegramMessage(`❌ Error: ${err.message}`, projectArg, topicId);
  }
  return true;
}

async function handleRetry(projectArg: string, topicId: number | null): Promise<boolean> {
  if (!projectArg) {
    await sendTelegramMessage('Usage: /sentinel retry <repo-name>', null, topicId);
    return true;
  }
  await sendTelegramMessage(
    `Manual retry for ${projectArg} is noted.\nPush a new commit to trigger the full loop, or check the latest build manually.`,
    projectArg, topicId
  );
  return true;
}

async function handleHelp(topicId: number | null, chatId: string | null): Promise<boolean> {
  const { sendMenu } = require('../telegramMenus') as { sendMenu: typeof sendMenuType };
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

async function handleExecute(repoArg: string, topicId: number | null): Promise<boolean> {
  if (!repoArg) {
    await sendTelegramMessage('Usage: /sentinel execute <repo-name>', null, topicId);
    return true;
  }
  await sendTelegramMessage(`Starting task execution for ${repoArg}...`, repoArg, topicId);
  executeApprovedTasks(repoFullName(repoArg), repoArg, topicId)
    .catch((err: any) => logger.error({ err: err.stack ?? err.message }, 'Execute failed'));
  return true;
}

async function handleSkipAudit(repoArg: string, topicId: number | null): Promise<boolean> {
  await stopAllTasksForRepo(repoFullName(repoArg));
  await sendTelegramMessage(
    `Audit skipped for ${repoArg}. Tasks remain in Notion as Queued.`,
    repoArg, topicId
  );
  return true;
}

async function handleManualAudit(repoArg: string, topicId: number | null): Promise<boolean> {
  if (!repoArg) {
    await sendTelegramMessage('Usage: /sentinel audit <repo-name>', null, topicId);
    return true;
  }

  // Found live in production (2026-07-22): a natural-language mention like
  // "@sentinel audit the costpilot repo" gets tokenized by the verb-first
  // parser as repo="the" (the very next word, literally) — with no
  // validation here, that went straight into triggerAudit(), which cloned
  // "github.com/<org>/the.git", failed with an unhelpful raw git error deep
  // in the logs, and gave the user no visible feedback at all. Validating
  // against the actual tracked-repo list first turns a doomed clone
  // attempt + silent-to-the-user failure into an immediate, clear reply.
  const { getFullRepoList } = require('../repoDiscovery') as { getFullRepoList: typeof getFullRepoListType };
  const repos = await getFullRepoList().catch((err: any) => {
    logger.warn({ err: err.message }, 'getFullRepoList failed during audit repo-name validation — proceeding without it');
    return null;
  });
  const match = repos?.find(r => r.repoName.toLowerCase() === repoArg.toLowerCase());

  if (repos && !match) {
    await sendTelegramMessage(
      [
        `⚠️ No tracked repo named "${repoArg}" — not attempting an audit.`,
        `Tracked repos: ${repos.map(r => r.repoName).join(', ') || '(none loaded)'}`,
      ].join('\n'),
      repoArg, topicId
    );
    return true;
  }

  // repos===null means the validation lookup itself failed (not that the
  // repo is unknown) — proceed as before rather than block a legitimate
  // audit on a transient GitHub API error.
  const resolvedRepoName     = match?.repoName     || repoArg;
  const resolvedRepoFullName = match?.repoFullName || repoFullName(repoArg);

  const project = await findNotionProject(resolvedRepoName).catch(() => null);
  const { getDefaultBranch } = require('../repoDiscovery') as { getDefaultBranch: typeof getDefaultBranchType };
  const branchName = await getDefaultBranch(resolvedRepoFullName).catch(() => 'main');
  await sendTelegramMessage(`Manual audit triggered for ${resolvedRepoName}...`, resolvedRepoName, topicId);
  triggerAudit({
    repoFullName:  resolvedRepoFullName,
    repoName:      resolvedRepoName,
    projectName:   project?.projectName || resolvedRepoName,
    commitSha:     `manual-${Date.now()}`,
    commitMessage: '[manual-audit]',
    branchName,
    authorName:    'Human',
    authorEmail:   '',
    topicId,
  }).catch((err: any) => logger.error({ err: err.stack ?? err.message }, 'Manual audit failed'));
  return true;
}

async function handleListTasks(repoArg: string, topicId: number | null, chatId: string | null): Promise<boolean> {
  if (!repoArg) {
    await sendTelegramMessage('Usage: /sentinel tasks <repo-name>', null, topicId);
    return true;
  }
  interface ListedTaskRow {
    id: number;
    task_number: number;
    title: string;
    priority: string;
    status: string;
    safe_to_auto_execute: boolean;
    batch_number: number;
  }
  const r = await dbQuery<ListedTaskRow>(`
    SELECT id, task_number, title, priority, status,
           safe_to_auto_execute, batch_number
    FROM audit_tasks
    WHERE repo_full_name=$1
      AND status IN ('queued','in_progress','failed','build_check')
    ORDER BY task_number ASC LIMIT 12
  `, [repoFullName(repoArg)]);

  if (r.rows.length === 0) {
    await sendTelegramMessage(`No active tasks for ${repoArg}.`, repoArg, topicId);
    return true;
  }

  const EMOJI: Record<string, string> = { critical:'🔴', high:'🟠', medium:'🟡', low:'🟢' };
  const list  = r.rows.map((t) =>
    `${t.task_number}. [B${t.batch_number}] ${EMOJI[t.priority]||'⚪'} ${t.title} — ${t.status}${t.safe_to_auto_execute?'':' 🔒'}`
  ).join('\n');

  await sendTelegramMessage(`Tasks for ${repoArg}:\n\n${list}\n\n🔒 = needs approval`, repoArg, topicId);

  const unsafe = r.rows.filter((t) => !t.safe_to_auto_execute && t.status === 'queued');
  if (unsafe.length > 0 && chatId) {
    const { sendMenu } = require('../telegramMenus') as { sendMenu: typeof sendMenuType };
    const buttons = unsafe.map((t) => [
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

async function handleSkipBatch(repoArg: string, batchNumArg: string, topicId: number | null): Promise<boolean> {
  if (!repoArg || !batchNumArg) {
    await sendTelegramMessage(
      'Usage: /sentinel skip-batch <repo-name> <batch-number>', null, topicId
    );
    return true;
  }
  const r = await dbQuery<{ id: number }>(`
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
    repoArg, topicId
  );
  fireAndForget(processNextBatch(repoFullName(repoArg), repoArg, topicId), { label: 'repoOps' })
  return true;
}

async function handleRepoOpsCmd(subcommand: string, parts: string[], chatId: string | null, topicId: number | null): Promise<boolean> {
  if (parts[2]) {
    const { canonicalizeRepoName } = require('../repoResolver') as { canonicalizeRepoName: typeof canonicalizeRepoNameType };
    const canon = canonicalizeRepoName(parts[2]);
    if (canon) parts[2] = canon.repoName;
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
      if (parts[2]) return handleSkipAudit(parts[2], topicId);
      await sendTelegramMessage('Usage: /sentinel skip <repo-name>', null, topicId);
      return true;
    case 'audit':
      return handleManualAudit(parts[2] || '', topicId);
    case 'tasks':
      return handleListTasks(parts[2] || '', topicId, chatId);
    case 'skip-batch':
      return handleSkipBatch(parts[2] || '', parts[3] || '', topicId);

    case 'remember': {
      // D-027 item 6 (project memory) — /sentinel remember <repo> <text>
      const repo = parts[2];
      const content = parts.slice(3).join(' ').trim();
      if (!repo || !content) {
        await sendTelegramMessage('Usage: /sentinel remember <repo> <text to remember>', null, topicId);
        return true;
      }
      const { addMemoryEntry } = require('../projectMemory') as { addMemoryEntry: typeof addMemoryEntryType };
      await addMemoryEntry(repoFullName(repo), 'note', content, 'human');
      await sendTelegramMessage(`🧠 Remembered for ${repo}: ${content}`, repo, topicId);
      return true;
    }

    case 'project-memory': {
      // Named distinctly from the existing 'memory' subcommand
      // (commands/agents.ts), which shows Telegram conversation history for
      // a topic — a different feature from this repo-scoped engineering memory.
      const repo = parts[2];
      if (!repo) { await sendTelegramMessage('Usage: /sentinel project-memory <repo>', null, topicId); return true; }
      const { getMemoryEntries } = require('../projectMemory') as { getMemoryEntries: typeof getMemoryEntriesType };
      const entries = await getMemoryEntries(repoFullName(repo));
      if (entries.length === 0) {
        await sendTelegramMessage(`No memory recorded for ${repo} yet. Use /sentinel remember ${repo} <text>.`, repo, topicId);
        return true;
      }
      const lines = entries.map((e) => `#${e.id} [${e.type}] ${e.content}`);
      await sendTelegramMessage(`🧠 Memory for ${repo}:\n\n${lines.join('\n')}`, repo, topicId);
      return true;
    }

    case 'forget': {
      const repo = parts[2];
      const id = parseInt(parts[3] || '', 10);
      if (!repo || !id) { await sendTelegramMessage('Usage: /sentinel forget <repo> <id>', null, topicId); return true; }
      const { deleteMemoryEntry } = require('../projectMemory') as { deleteMemoryEntry: typeof deleteMemoryEntryType };
      const deleted = await deleteMemoryEntry(repoFullName(repo), id);
      await sendTelegramMessage(deleted ? `🧠 Forgot #${id} for ${repo}.` : `No memory entry #${id} found for ${repo}.`, repo, topicId);
      return true;
    }

    case 'lock': {
      if (!parts[2]) { await sendTelegramMessage('Usage: /sentinel lock <repo>', null, topicId); return true; }
      const { lockRepo } = require('../repoLock') as { lockRepo: typeof lockRepoType };
      await lockRepo(parts[2], 'manual');
      await sendTelegramMessage(
        `🔐 ${parts[2]} locked. No agents will touch it until /sentinel unlock ${parts[2]}`,
        parts[2], topicId
      );
      return true;
    }
    case 'unlock': {
      if (!parts[2]) { await sendTelegramMessage('Usage: /sentinel unlock <repo>', null, topicId); return true; }
      const { unlockRepo } = require('../repoLock') as { unlockRepo: typeof unlockRepoType };
      await unlockRepo(parts[2]);
      await sendTelegramMessage(`🔓 ${parts[2]} unlocked.`, parts[2], topicId);
      return true;
    }
    case 'locked': {
      const { getAllLocked } = require('../repoLock') as { getAllLocked: typeof getAllLockedType };
      const locked = await getAllLocked();
      if (locked.length === 0) {
        await sendTelegramMessage('No repos currently locked.', null, topicId);
        return true;
      }
      const lines = locked.map((l) =>
        `🔐 ${l.repoName} — ${l.reason} (since ${new Date(l.lockedAt).toLocaleTimeString('en-CA')})`
      );
      await sendTelegramMessage(lines.join('\n'), null, topicId);
      return true;
    }
    case 'health': {
      const { getPortfolioSummary } = require('../portfolioAnalytics') as { getPortfolioSummary: typeof getPortfolioSummaryType };
      const s = await getPortfolioSummary().catch(() => null);
      if (!s) { await sendTelegramMessage('Portfolio data unavailable.', null, topicId); return true; }
      const lines = [...s.metrics]
        .sort((a, b) => parseFloat(a.health_score || '0') - parseFloat(b.health_score || '0'))
        .map((m) => {
          const score = parseFloat(m.health_score || '0');
          const dot   = score >= 7 ? '🟢' : score >= 5 ? '🟡' : '🔴';
          return `${dot} ${m.repo_name}: ${m.health_score}/10`;
        });
      await sendTelegramMessage(`Portfolio Health\n\n${lines.join('\n')}`, null, topicId);
      return true;
    }
    case 'what': {
      const working = (await getAllAgents().catch(() => [])).filter((a) => a.status === 'working');
      if (working.length === 0) {
        await sendTelegramMessage('Sentinel is idle. No active agent tasks.', null, topicId);
        return true;
      }
      const lines = working.map((a) =>
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
      const updated = await dbQuery<{ id: number }>(`
        UPDATE audit_tasks SET safe_to_auto_execute = true
        WHERE repo_full_name = $1 AND status = 'queued'
        RETURNING id
      `, [repoFullName(parts[2])]).catch(() => null);
      const count = updated?.rows?.length || 0;
      await sendTelegramMessage(
        `Unlocked ${count} tasks for ${parts[2]}. Starting execution...`, parts[2], topicId
      );
      if (count > 0) {
        executeApprovedTasks(repoFullName(parts[2]), parts[2], topicId)
          .catch((err: any) => logger.error({ err: err.stack ?? err.message }, 'Force-execute failed'));
      }
      return true;
    }
    case 'security': {
      const { getOpenIssues, getLatestSecurityScore, getPortfolioSecuritySummary } = require('../securityDb') as {
        getOpenIssues: typeof getOpenIssuesType;
        getLatestSecurityScore: typeof getLatestSecurityScoreType;
        getPortfolioSecuritySummary: typeof getPortfolioSecuritySummaryType;
      };
      if (parts[2]) {
        const [score, issues] = await Promise.all([
          getLatestSecurityScore(parts[2]),
          getOpenIssues(repoFullName(parts[2])),
        ]);
        const counts = {
          critical: issues.filter((i) => i.severity === 'critical').length,
          high:     issues.filter((i) => i.severity === 'high').length,
          medium:   issues.filter((i) => i.severity === 'medium').length,
          low:      issues.filter((i) => i.severity === 'low').length,
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
          issues.slice(0, 5).map((i) => `  · [${i.severity}] ${i.title}`).join('\n'),
          ``,
          `/sentinel security-scan ${parts[2]} — fresh scan`,
          `/sentinel security-patch ${parts[2]} — auto-fix safe issues`,
        ].join('\n'), parts[2], topicId);
      } else {
        const portfolio = await getPortfolioSecuritySummary();
        const lines = portfolio
          .sort((a, b) => parseFloat(a.score) - parseFloat(b.score))
          .map((r) => `${r.repo_name}: ${r.score}/10 (${r.critical_count || 0} critical)`);
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
      const { runSecurityScan } = require('../securityScanner') as { runSecurityScan: typeof runSecurityScanType };
      await sendTelegramMessage(`Running security scan on ${parts[2]}...`, parts[2], topicId);
      fireAndForget(runSecurityScan({
        repoFullName: repoFullName(parts[2]),
        repoName: parts[2], commitSha: 'HEAD', topicId,
      }), { label: 'repoOps' })
      return true;
    }
    case 'security-patch': {
      if (!parts[2]) {
        await sendTelegramMessage('Usage: /sentinel security-patch <repo>', null, topicId);
        return true;
      }
      const { getOpenIssues: getIssues } = require('../securityDb') as { getOpenIssues: typeof getOpenIssuesType };
      const { applySecurityPatches }     = require('../securityPatcher') as { applySecurityPatches: typeof applySecurityPatchesType };
      const patchIssues = await getIssues(repoFullName(parts[2]));
      fireAndForget(applySecurityPatches(repoFullName(parts[2]), parts[2], patchIssues, topicId), { label: 'repoOps' })
      return true;
    }
    case 'security-approve': {
      if (!parts[2]) {
        await sendTelegramMessage('Usage: /sentinel security-approve <repo>', null, topicId);
        return true;
      }
      const { resolveAllOpenIssues } = require('../securityDb') as { resolveAllOpenIssues: typeof resolveAllOpenIssuesType };
      let count = 0;
      let dbFailed = false;
      try {
        count = await resolveAllOpenIssues(repoFullName(parts[2]));
      } catch (err: any) {
        logger.warn({ err: err.message, repo: parts[2] }, 'resolveAllOpenIssues failed');
        dbFailed = true;
      }
      await sendTelegramMessage(
        dbFailed
          ? `⚠️ Security approval for ${parts[2]} could not be recorded — database error. Please retry.`
          : `Security approval for ${parts[2]} noted — ${count} open issue(s) marked resolved.\nMake sure the fix is actually merged on GitHub.`,
        parts[2], topicId
      );
      return true;
    }
    case 'webhook-status': {
      const [seen, allMetrics] = await Promise.all([
        dbQuery<{ repo_name: string; last_seen: string; snapshots: number }>(`
          SELECT repo_name, MAX(last_commit_at) as last_seen, COUNT(*) as snapshots
          FROM portfolio_metrics
          WHERE last_commit_at > NOW() - INTERVAL '7 days'
          GROUP BY repo_name
          ORDER BY last_seen DESC
          LIMIT 20
        `).catch(() => ({ rows: [] })),
        dbQuery<{ repo_name: string }>(`SELECT DISTINCT repo_name FROM portfolio_metrics`).catch(() => ({ rows: [] })),
      ]);

      const seenNames = new Set(seen.rows.map((r) => r.repo_name.toLowerCase()));
      const allNames  = allMetrics.rows.map((r) => r.repo_name.toLowerCase());
      const missing   = allNames.filter((n: string) => !seenNames.has(n));

      // portfolio_metrics is an append-only snapshot table written by both the
      // webhook handler and the periodic metrics sync — this count reflects
      // metric snapshots, not discrete webhook deliveries, so it must not be
      // labeled "events" (that overstates what's actually being measured).
      const receivingLines = seen.rows.map((r) =>
        `✅ ${r.repo_name} — last activity ${new Date(r.last_seen).toLocaleDateString('en-CA')} (${r.snapshots} metric snapshot(s) in 7d)`
      );
      const missingLines = missing.map((n: string) => `❌ ${n} — no metric activity in 7 days`);

      await sendTelegramMessage([
        `Webhook Status (last 7 days, inferred from metric activity)`,
        ``,
        ...receivingLines,
        ...(missingLines.length ? ['', 'Missing webhooks:', ...missingLines] : []),
        ``,
        `For missing repos: GitHub repo → Settings → Webhooks → Add`,
        `URL: ${process.env['PUBLIC_DOMAIN'] ? `https://${process.env['PUBLIC_DOMAIN']}/webhook/github` : '<PUBLIC_DOMAIN>/webhook/github'}`,
        `Events: push, pull_request`,
      ].join('\n'), null, topicId);
      return true;
    }
    case 'brain': {
      const { runStrategicBrain } = require('../sentinelBrain') as { runStrategicBrain: typeof runStrategicBrainType };
      await sendTelegramMessage('🧠 Running strategic brain...', null, topicId);
      runStrategicBrain(topicId).catch((err: any) =>
        logger.error({ err: err.stack ?? err.message }, 'Manual brain run failed')
      );
      return true;
    }
    case 'menu': {
      const { showMainMenu } = require('../telegramMenus') as { showMainMenu: typeof showMainMenuType };
      await showMainMenu(chatId, topicId);
      return true;
    }
    case 'repo': {
      if (!parts[2]) { await sendTelegramMessage('Usage: /sentinel repo <name>', null, topicId); return true; }
      const { showRepoMenu } = require('../telegramMenus') as { showRepoMenu: typeof showRepoMenuType };
      await showRepoMenu(chatId, topicId, parts[2]);
      return true;
    }
    case 'approve': {
      const { showApprovalsMenu } = require('../telegramMenus') as { showApprovalsMenu: typeof showApprovalsMenuType };
      let sprintPending = false;
      try {
        const { isPendingAutoApprove } = require('../autoApprover') as { isPendingAutoApprove: typeof isPendingAutoApproveType };
        sprintPending = await isPendingAutoApprove().catch(() => false);
      } catch (err: any) { logger.warn({ err: err.message }, 'autoApprover module failed to load — sprintPending defaults to false'); }
      await showApprovalsMenu(chatId, topicId, {
        sprint:    sprintPending,
        selfAudit: false,
        security:  null,
      });
      return true;
    }
    case 'pause': {
      try {
        const { cancelAutoApprove } = require('../autoApprover') as { cancelAutoApprove: typeof cancelAutoApproveType };
        await safeFire(cancelAutoApprove(), { label: 'repoOps' })
      } catch (err: any) { logger.warn({ err: err.message }, 'cancelAutoApprove failed'); }
      try {
        await dbQuery(`UPDATE agent_registry SET status='paused' WHERE status='idle'`);
      } catch (err: any) {
        logger.error({ err: err.stack ?? err.message }, 'Telegram pause failed to update agent_registry');
      }
      try {
        // Phase 6's kill switch — viktorWatcher.ts checks this flag before
        // executing any Viktor-initiated action. Without this, pause only
        // ever gated auto-approve and idle agents, not Viktor's authority
        // path, which the plan doc explicitly flagged as unverified.
        const { updateSettings } = require('../settingsDb') as { updateSettings: typeof updateSettingsType };
        await updateSettings({ sentinel_paused: true });
      } catch (err: any) {
        logger.error({ err: err.stack ?? err.message }, 'pause failed to set sentinel_paused — Viktor kill switch NOT engaged');
      }
      await sendTelegramMessage(
        '⏸ All automation paused.\nSprints, audits, and builds will not auto-execute. All idle agents have been paused. Viktor-initiated actions will be denied.\nSend /sentinel resume to restart.',
        null, topicId
      );
      return true;
    }
    case 'resume': {
      try {
        await dbQuery(`UPDATE agent_registry SET status='idle' WHERE status='paused'`);
      } catch (err: any) {
        logger.error({ err: err.stack ?? err.message }, 'Telegram resume failed to update agent_registry');
      }
      try {
        const { updateSettings } = require('../settingsDb') as { updateSettings: typeof updateSettingsType };
        await updateSettings({ sentinel_paused: false });
      } catch (err: any) {
        logger.error({ err: err.stack ?? err.message }, 'resume failed to clear sentinel_paused');
      }
      await sendTelegramMessage('▶️ Automation resumed. Paused agents are idle again. Viktor-initiated actions will be evaluated again.', null, topicId);
      return true;
    }
    case 'reset-failed': {
      if (!parts[2]) {
        await sendTelegramMessage('Usage: /sentinel reset-failed <repo>', null, topicId);
        return true;
      }
      const r = await dbQuery<{ id: number }>(`
        UPDATE audit_tasks
        SET status = 'queued', failure_reason = NULL
        WHERE repo_full_name = $1 AND status = 'failed'
        RETURNING id
      `, [repoFullName(parts[2])]).catch(() => null);
      const count = r?.rows?.length || 0;
      await sendTelegramMessage(
        `♻️ Reset ${count} failed tasks to queued for ${parts[2]}.\n/sentinel execute ${parts[2]} to run them.`,
        parts[2], topicId
      );
      return true;
    }
    case 'repos': {
      if (parts[2] === 'scan') {
        await sendTelegramMessage('🔎 Scanning GitHub for new repos...', null, topicId);
        const { discoverAndOnboardRepos } = require('../repoDiscovery') as { discoverAndOnboardRepos: typeof discoverAndOnboardReposType };
        discoverAndOnboardRepos()
          .then((result) => sendTelegramMessage(
            result.discovered > 0
              ? `✅ Found and onboarded ${result.discovered} new repo(s): ${(result.repos || []).join(', ')}`
              : '✅ Scan complete — no new repos found.',
            null, topicId
          ))
          .catch((err: any) => sendTelegramMessage(`❌ Repo scan failed: ${err.message}`, null, topicId));
        return true;
      }
      const { getFullRepoList } = require('../repoDiscovery') as { getFullRepoList: typeof getFullRepoListType };
      const list = await getFullRepoList().catch(() => []);
      await sendTelegramMessage(
        [`📁 Tracked repos (${list.length}):`, ...list.map((r) => `· ${r.repoName}`),
         '', '/sentinel repos scan — scan GitHub for new repos now'].join('\n'),
        null, topicId
      );
      return true;
    }
    case 'sync-metrics': {
      await sendTelegramMessage('🔄 Syncing repo health metrics from GitHub API...', null, topicId);
      const { syncAllRepoMetrics } = require('../githubMetricsSyncer') as { syncAllRepoMetrics: typeof syncAllRepoMetricsType };
      syncAllRepoMetrics()
        .then((result) => sendTelegramMessage(
          `✅ Metrics sync complete — ${result?.synced ?? 0}/${result?.total ?? 0} repos updated.`,
          null, topicId
        ))
        .catch((err: any) => sendTelegramMessage(
          `❌ Metrics sync failed: ${err.message}`, null, topicId
        ));
      return true;
    }
    case 'check-builder': {
      const { execAsync } = require('../utils/execAsync') as { execAsync: typeof execAsyncType };
      const { listBuilders }   = require('../builderRouter') as { listBuilders: typeof listBuildersType };
      const lines: string[] = [];

      try {
        const { stdout } = await execAsync('aider --version 2>&1', { timeout: 8000 });
        lines.push(`✅ aider: ${stdout.trim()}`);
      } catch (e) {
        lines.push(`❌ aider: NOT FOUND — builder tasks will fail`);
      }

      try {
        await execAsync('git --version 2>&1', { timeout: 5000 });
        lines.push(`✅ git: available`);
      } catch {
        lines.push(`❌ git: NOT FOUND`);
      }

      lines.push('');

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

export = {
  handleRepoOpsCmd,
  handleStop, handleStatus, handleBuilds, handleRetry,
  handleHelp, handleExecute, handleSkipAudit, handleManualAudit,
  handleListTasks, handleSkipBatch,
};

