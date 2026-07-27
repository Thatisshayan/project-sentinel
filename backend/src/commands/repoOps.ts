import { safeFire, fireAndForget } from '../utils/safeFire';
import logger from '../logger';
import { repoFullName } from '../repoResolver';
import { sendTelegramMessage } from '../telegramClient';
import { findNotionProject } from '../notionClient';
import { stopDebugAttempts, query as dbQuery } from '../dbClient';
import { executeApprovedTasks, triggerAudit, processNextBatch } from '../auditOrchestrator';
import { stopAllTasksForRepo, updateAuditTask } from '../auditDb';
import { getAllAgents } from '../agentDb';

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
  const { sendMenu } = require('../telegramMenus') as { sendMenu: (...args: any[]) => Promise<any> };
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
  const { getFullRepoList } = require('../repoDiscovery') as {
    getFullRepoList: () => Promise<Array<{ repoName: string; repoFullName: string }>>;
  };
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
  const { getDefaultBranch } = require('../repoDiscovery');
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
  const { query } = require('../dbClient') as { query: (...args: any[]) => Promise<any> };
  const r = await query(`
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
  const list  = r.rows.map((t: any) =>
    `${t.task_number}. [B${t.batch_number}] ${EMOJI[t.priority]||'⚪'} ${t.title} — ${t.status}${t.safe_to_auto_execute?'':' 🔒'}`
  ).join('\n');

  await sendTelegramMessage(`Tasks for ${repoArg}:\n\n${list}\n\n🔒 = needs approval`, repoArg, topicId);

  const unsafe = r.rows.filter((t: any) => !t.safe_to_auto_execute && t.status === 'queued');
  if (unsafe.length > 0 && chatId) {
    const { sendMenu } = require('../telegramMenus') as { sendMenu: (...args: any[]) => Promise<any> };
    const buttons = unsafe.map((t: any) => [
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
  const { query } = require('../dbClient') as { query: (...args: any[]) => Promise<any> };
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
    repoArg, topicId
  );
  fireAndForget(processNextBatch(repoFullName(repoArg), repoArg, topicId), { label: 'repoOps' })
  return true;
}

async function handleRepoOpsCmd(subcommand: string, parts: string[], chatId: string | null, topicId: number | null): Promise<boolean> {
  if (parts[2]) {
    const { canonicalizeRepoName } = require('../repoResolver') as { canonicalizeRepoName: (input: string) => any };
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

    case 'lock': {
      if (!parts[2]) { await sendTelegramMessage('Usage: /sentinel lock <repo>', null, topicId); return true; }
      const { lockRepo } = require('../repoLock') as { lockRepo: (repo: string, reason?: string) => Promise<void> };
      await lockRepo(parts[2], 'manual');
      await sendTelegramMessage(
        `🔐 ${parts[2]} locked. No agents will touch it until /sentinel unlock ${parts[2]}`,
        parts[2], topicId
      );
      return true;
    }
    case 'unlock': {
      if (!parts[2]) { await sendTelegramMessage('Usage: /sentinel unlock <repo>', null, topicId); return true; }
      const { unlockRepo } = require('../repoLock') as { unlockRepo: (repo: string) => Promise<void> };
      await unlockRepo(parts[2]);
      await sendTelegramMessage(`🔓 ${parts[2]} unlocked.`, parts[2], topicId);
      return true;
    }
    case 'locked': {
      const { getAllLocked } = require('../repoLock') as { getAllLocked: () => Promise<any[]> };
      const locked = await getAllLocked();
      if (locked.length === 0) {
        await sendTelegramMessage('No repos currently locked.', null, topicId);
        return true;
      }
      const lines = locked.map((l: any) =>
        `🔐 ${l.repoName} — ${l.reason} (since ${new Date(l.lockedAt).toLocaleTimeString('en-CA')})`
      );
      await sendTelegramMessage(lines.join('\n'), null, topicId);
      return true;
    }
    case 'health': {
      const { getPortfolioSummary } = require('../portfolioAnalytics') as { getPortfolioSummary: () => Promise<any> };
      const s = await getPortfolioSummary().catch(() => null);
      if (!s) { await sendTelegramMessage('Portfolio data unavailable.', null, topicId); return true; }
      const lines = [...s.metrics]
        .sort((a: any, b: any) => parseFloat(a.health_score) - parseFloat(b.health_score))
        .map((m: any) => {
          const score = parseFloat(m.health_score);
          const dot   = score >= 7 ? '🟢' : score >= 5 ? '🟡' : '🔴';
          return `${dot} ${m.repo_name}: ${m.health_score}/10`;
        });
      await sendTelegramMessage(`Portfolio Health\n\n${lines.join('\n')}`, null, topicId);
      return true;
    }
    case 'what': {
      const working = (await getAllAgents().catch(() => [])).filter((a: any) => a.status === 'working');
      if (working.length === 0) {
        await sendTelegramMessage('Sentinel is idle. No active agent tasks.', null, topicId);
        return true;
      }
      const lines = working.map((a: any) =>
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
      const { query: dbQuery } = require('../dbClient') as { query: (...args: any[]) => Promise<any> };
      const updated = await dbQuery(`
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
      const { getOpenIssues, getLatestSecurityScore, getPortfolioSecuritySummary } = require('../securityDb') as { getOpenIssues: (...args: any[]) => Promise<any[]>; getLatestSecurityScore: (repo: string) => Promise<any>; getPortfolioSecuritySummary: () => Promise<any[]> };
      if (parts[2]) {
        const [score, issues] = await Promise.all([
          getLatestSecurityScore(parts[2]),
          getOpenIssues(repoFullName(parts[2])),
        ]);
        const counts = {
          critical: issues.filter((i: any) => i.severity === 'critical').length,
          high:     issues.filter((i: any) => i.severity === 'high').length,
          medium:   issues.filter((i: any) => i.severity === 'medium').length,
          low:      issues.filter((i: any) => i.severity === 'low').length,
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
          issues.slice(0, 5).map((i: any) => `  · [${i.severity}] ${i.title}`).join('\n'),
          ``,
          `/sentinel security-scan ${parts[2]} — fresh scan`,
          `/sentinel security-patch ${parts[2]} — auto-fix safe issues`,
        ].join('\n'), parts[2], topicId);
      } else {
        const portfolio = await getPortfolioSecuritySummary();
        const lines = portfolio
          .sort((a: any, b: any) => parseFloat(a.score) - parseFloat(b.score))
          .map((r: any) => `${r.repo_name}: ${r.score}/10 (${r.critical_count || 0} critical)`);
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
      const { runSecurityScan } = require('../securityScanner') as { runSecurityScan: (...args: any[]) => Promise<any> };
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
      const { getOpenIssues: getIssues } = require('../securityDb') as { getOpenIssues: (...args: any[]) => Promise<any[]> };
      const { applySecurityPatches }     = require('../securityPatcher') as { applySecurityPatches: (...args: any[]) => Promise<any> };
      const patchIssues = await getIssues(repoFullName(parts[2]));
      fireAndForget(applySecurityPatches(repoFullName(parts[2]), parts[2], patchIssues, topicId), { label: 'repoOps' })
      return true;
    }
    case 'security-approve': {
      if (!parts[2]) {
        await sendTelegramMessage('Usage: /sentinel security-approve <repo>', null, topicId);
        return true;
      }
      const { resolveAllOpenIssues } = require('../securityDb') as { resolveAllOpenIssues: (repo: string) => Promise<number> };
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
      const { query: dbq } = require('../dbClient') as { query: (...args: any[]) => Promise<any> };
      const [seen, allMetrics] = await Promise.all([
        dbq(`
          SELECT repo_name, MAX(last_commit_at) as last_seen, COUNT(*) as snapshots
          FROM portfolio_metrics
          WHERE last_commit_at > NOW() - INTERVAL '7 days'
          GROUP BY repo_name
          ORDER BY last_seen DESC
          LIMIT 20
        `).catch(() => ({ rows: [] })),
        dbq(`SELECT DISTINCT repo_name FROM portfolio_metrics`).catch(() => ({ rows: [] })),
      ]);

      const seenNames = new Set(seen.rows.map((r: any) => r.repo_name.toLowerCase()));
      const allNames  = allMetrics.rows.map((r: any) => r.repo_name.toLowerCase());
      const missing   = allNames.filter((n: string) => !seenNames.has(n));

      // portfolio_metrics is an append-only snapshot table written by both the
      // webhook handler and the periodic metrics sync — this count reflects
      // metric snapshots, not discrete webhook deliveries, so it must not be
      // labeled "events" (that overstates what's actually being measured).
      const receivingLines = seen.rows.map((r: any) =>
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
        `URL: ${process.env['RAILWAY_PUBLIC_DOMAIN'] ? `https://${process.env['RAILWAY_PUBLIC_DOMAIN']}/webhook/github` : '<RAILWAY_URL>/webhook/github'}`,
        `Events: push, pull_request`,
      ].join('\n'), null, topicId);
      return true;
    }
    case 'brain': {
      const { runStrategicBrain } = require('../sentinelBrain') as { runStrategicBrain: (topicId?: number | null) => Promise<void> };
      await sendTelegramMessage('🧠 Running strategic brain...', null, topicId);
      runStrategicBrain(topicId).catch((err: any) =>
        logger.error({ err: err.stack ?? err.message }, 'Manual brain run failed')
      );
      return true;
    }
    case 'menu': {
      const { showMainMenu } = require('../telegramMenus') as { showMainMenu: (...args: any[]) => Promise<any> };
      await showMainMenu(chatId, topicId);
      return true;
    }
    case 'repo': {
      if (!parts[2]) { await sendTelegramMessage('Usage: /sentinel repo <name>', null, topicId); return true; }
      const { showRepoMenu } = require('../telegramMenus') as { showRepoMenu: (...args: any[]) => Promise<any> };
      await showRepoMenu(chatId, topicId, parts[2]);
      return true;
    }
    case 'approve': {
      const { showApprovalsMenu } = require('../telegramMenus') as { showApprovalsMenu: (...args: any[]) => Promise<any> };
      let sprintPending = false;
      try {
        const { isPendingAutoApprove } = require('../autoApprover') as { isPendingAutoApprove: () => Promise<boolean> };
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
        const { cancelAutoApprove } = require('../autoApprover') as { cancelAutoApprove: () => Promise<boolean> };
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
        const { updateSettings } = require('../settingsDb') as { updateSettings: (u: Record<string, any>) => Promise<any> };
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
        const { updateSettings } = require('../settingsDb') as { updateSettings: (u: Record<string, any>) => Promise<any> };
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
      const { query: dbq } = require('../dbClient') as { query: (...args: any[]) => Promise<any> };
      const r = await dbq(`
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
        const { discoverAndOnboardRepos } = require('../repoDiscovery') as { discoverAndOnboardRepos: () => Promise<any> };
        discoverAndOnboardRepos()
          .then((result: any) => sendTelegramMessage(
            result.discovered > 0
              ? `✅ Found and onboarded ${result.discovered} new repo(s): ${result.repos.join(', ')}`
              : '✅ Scan complete — no new repos found.',
            null, topicId
          ))
          .catch((err: any) => sendTelegramMessage(`❌ Repo scan failed: ${err.message}`, null, topicId));
        return true;
      }
      const { getFullRepoList } = require('../repoDiscovery') as { getFullRepoList: () => Promise<any[]> };
      const list = await getFullRepoList().catch(() => []);
      await sendTelegramMessage(
        [`📁 Tracked repos (${list.length}):`, ...list.map((r: any) => `· ${r.repoName}`),
         '', '/sentinel repos scan — scan GitHub for new repos now'].join('\n'),
        null, topicId
      );
      return true;
    }
    case 'sync-metrics': {
      await sendTelegramMessage('🔄 Syncing repo health metrics from GitHub API...', null, topicId);
      const { syncAllRepoMetrics } = require('../githubMetricsSyncer') as { syncAllRepoMetrics: () => Promise<any> };
      syncAllRepoMetrics()
        .then((result: any) => sendTelegramMessage(
          `✅ Metrics sync complete — ${result?.synced ?? 0}/${result?.total ?? 0} repos updated.`,
          null, topicId
        ))
        .catch((err: any) => sendTelegramMessage(
          `❌ Metrics sync failed: ${err.message}`, null, topicId
        ));
      return true;
    }
    case 'check-builder': {
      const { execAsync } = require('../utils/execAsync') as { execAsync: (cmd: string, opts?: any) => Promise<any> };
      const { listBuilders }   = require('../builderRouter') as { listBuilders: () => any[] };
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

