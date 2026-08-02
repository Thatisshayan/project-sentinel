import { safeFire, fireAndForget } from '../utils/safeFire';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import logger from '../logger';
import { sendTelegramMessage } from '../telegramClient';
import { repoFullName } from '../repoResolver';
import { getAgentRoomSummary } from '../agentRoom';
import { getAllAgents } from '../agentDb';
import { runSelfAudit } from '../selfAuditor';
import { executeApprovedTasks } from '../auditOrchestrator';
import { dispatchToAgent, listExternalAgents } from '../agents/externalAgentRegistry';
import { ensureProject, recordEvent, upsertDecision, summarizeProjectSnapshot, upsertMilestone, upsertRelease, upsertRisk, upsertKpi } from '../boardroomDb';
import { getRecentAuthorityLog, listAuthorityRules } from '../viktorAuthority';
import type { ConversationHistoryRow } from '../types/conversationHistoryRow';

const execFileAsync = promisify(execFile);

async function handleAgentsCmd(subcommand: string, parts: string[], chatId: string | null, topicId: number | null): Promise<boolean> {
  switch (subcommand) {
    case 'agents': {
      const summary = await getAgentRoomSummary();
      await sendTelegramMessage(summary, null, topicId);
      return true;
    }
    case 'agent-room': {
      await sendTelegramMessage(
        `Agent room topic ID: ${process.env['AGENT_ROOM_TOPIC_ID'] || 'not configured'}\n` +
        `Set AGENT_ROOM_TOPIC_ID in Railway to activate.`,
        null, topicId
      );
      return true;
    }
    case 'self-audit': {
      await sendTelegramMessage('Triggering Sentinel self-audit...', null, topicId);
      runSelfAudit().catch((err: any) => logger.error({ err: err.stack ?? err.message }, 'Self-audit failed'));
      return true;
    }
    case 'self-approve': {
      await sendTelegramMessage('Approving Sentinel self-improvement tasks...', null, topicId);
      fireAndForget(executeApprovedTasks(
        repoFullName('project-sentinel'),
        'project-sentinel',
        topicId
      ), { label: 'agents' })
      return true;
    }
    case 'bots': {
      const { getConfiguredBots } = require('../agentBots') as { getConfiguredBots: () => { configured: string[]; missing: string[] } };
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
    case 'test-bots': {
      const { getConfiguredBots, sendAsAgent } = require('../agentBots') as { getConfiguredBots: () => { configured: string[]; missing: string[] }; sendAsAgent: (id: string, msg: string) => Promise<unknown> };
      const { configured, missing } = getConfiguredBots();
      await sendTelegramMessage(
        `Testing ${configured.length} agent bots...`, null, topicId
      );
      for (const agentId of configured) {
        const result = await sendAsAgent(agentId, `🟢 ${agentId} is online and ready.`);
        if (!result) {
          await sendTelegramMessage(`❌ ${agentId} failed — check bot token and group membership`, null, topicId);
        }
        await new Promise<void>(resolve => setTimeout(resolve, 800));
      }
      if (missing.length > 0) {
        await sendTelegramMessage(
          `⚠️ Missing tokens for: ${missing.join(', ')}\nAdd BOT_TOKEN_<NAME> to Railway.`,
          null, topicId
        );
      }
      return true;
    }
    case 'setup-bots': {
      const { getConfiguredBots, configureBotProfile } = require('../agentBots') as { getConfiguredBots: () => { configured: string[] }; configureBotProfile: (id: string, name: string) => Promise<void> };
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
    case 'standup': {
      const { runAgentStandup } = require('../agentStandup') as { runAgentStandup: () => Promise<void> };
      await sendTelegramMessage('Running agent standup...', null, topicId);
      runAgentStandup().catch((err: any) => logger.error({ err: err.stack ?? err.message }, 'Manual standup failed'));
      return true;
    }
    case 'leaderboard': {
      const { postAgentLeaderboard } = require('../agentLeaderboard') as { postAgentLeaderboard: () => Promise<void> };
      postAgentLeaderboard().catch((err: any) => logger.error({ err: err.stack ?? err.message }, 'Manual leaderboard failed'));
      return true;
    }
    case 'memory': {
      const { getHistory } = require('../conversationMemory') as { getHistory: (topicId: string | number, limit?: number) => Promise<ConversationHistoryRow[]> };
      const history = await getHistory(topicId ?? 0, 10).catch(() => []);
      if (history.length === 0) {
        await sendTelegramMessage('No conversation history for this topic yet.', null, topicId);
        return true;
      }
      const lines = history.map((h) =>
        `${h.from_name}: ${h.message.slice(0, 80)}\n→ ${(h.response || '').slice(0, 80)}`
      );
      await sendTelegramMessage(
        `Last ${history.length} exchanges:\n\n${lines.join('\n\n')}`, null, topicId
      );
      return true;
    }
    case 'assign': {
      // Phase 4 of docs/2026-07-22-slack-agent-roster-plan.md — dispatch a
      // task to an external Slack-native agent (Kilo, Viktor, Devin, Manus,
      // CodeRabbit). Syntax: assign <agent-id> <repo> <task description...>
      const [agentId, repo, ...taskWords] = parts.slice(2);
      const taskDescription = taskWords.join(' ');
      if (!agentId || !repo || !taskDescription) {
        const roster = await listExternalAgents({ enabledOnly: true }).catch(() => []);
        await sendTelegramMessage(
          [
            'Usage: assign <agent-id> <repo> <task description>',
            roster.length ? `Available agents: ${roster.map(a => a.id).join(', ')}` : '',
          ].filter(Boolean).join('\n'),
          null, topicId
        );
        return true;
      }
      const result = await dispatchToAgent(agentId, taskDescription, repo);
      await sendTelegramMessage(
        result
          ? `📤 Dispatched to ${agentId} in ${repo}'s Slack channel: "${taskDescription}"`
          : `⚠️ Could not dispatch to ${agentId} — check the agent id is valid/enabled and Slack is configured with a channel for ${repo}.`,
        repo, topicId
      );
      return true;
    }
    case 'hermes': {
      // Boardroom-first local command surface for Hermes. Keeps the scope to
      // project state, decisions, events, and a quick status readout.
      const action = (parts[2] || '').toLowerCase();
      const repo = parts[3] || null;
      const message = parts.slice(4).join(' ').trim();

      if (!action || !repo) {
        await sendTelegramMessage(
          [
            'Usage: hermes <ingest|build|test|note|event|decision|status|milestone|release|risk|kpi> <repo> [message]',
            'Examples:',
            '  hermes ingest project-sentinel',
            '  hermes milestone project-sentinel Local audit baseline',
            '  hermes release project-sentinel v1.2.0 ready for review',
            '  hermes build project-sentinel',
            '  hermes test project-sentinel',
            '  hermes risk project-sentinel high build flakes',
            '  hermes kpi project-sentinel build_passing 1 %',
            '  hermes status project-sentinel',
          ].join('\n'),
          repo, topicId
        );
        return true;
      }

      await ensureProject({ repoFullName: repo, repoName: repo, displayName: repo, currentPhase: 'hermes', lastActivityAt: new Date().toISOString() }).catch(() => null);

      const localRoot = process.env['REPO_ROOT'] || 'D:\\AgentDevWork\\repos';
      const repoLeaf = repo.split('/').pop() || repo;
      const repoPath = path.join(localRoot, repoLeaf);
      const runGit = async (args: string[]) => {
        try {
          const result = await execFileAsync('git', args, { cwd: repoPath, timeout: 30000 });
          return String(result.stdout || '').trim();
        } catch {
          return '';
        }
      };

      const packageJsonPath = path.join(repoPath, 'package.json');
      const packageJson = fs.existsSync(packageJsonPath) ? JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { scripts?: Record<string, string> } : null;
      const scripts = packageJson?.scripts || {};
      const hasBuildScript = Boolean(scripts['build']);
      const hasTestScript = Boolean(scripts['test']);
      const runPackageScript = async (scriptName: 'build' | 'test') => {
        if (!hasBuildScript && scriptName === 'build') {
          return { code: 0, stdout: '', stderr: 'No build script defined in package.json' };
        }
        if (!hasTestScript && scriptName === 'test') {
          return { code: 0, stdout: '', stderr: 'No test script defined in package.json' };
        }
        try {
          const result = await execFileAsync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', scriptName, '--', '--runInBand'], { cwd: repoPath, timeout: scriptName === 'build' ? 300000 : 300000 });
          return { code: 0, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
        } catch (err: any) {
          return { code: Number.isInteger(err.code) ? err.code : 1, stdout: String(err.stdout || ''), stderr: String(err.stderr || err.message || '') };
        }
      };

      if (action === 'status') {
        const summary = await summarizeProjectSnapshot(repo);
        await sendTelegramMessage(summary, repo, topicId);
        return true;
      }

      if (action === 'build') {
        const result = await runPackageScript('build');
        const passed = result.code === 0;
        await upsertKpi({
          projectId: repo,
          name: 'build_status',
          value: passed ? 1 : 0,
          unit: 'bool',
          status: passed ? 'ok' : 'attention',
          source: 'hermes',
          sourceRef: 'npm run build',
        });
        if (!passed) {
          await upsertRisk({
            projectId: repo,
            severity: 'high',
            category: 'build',
            title: 'Build failed',
            description: (result.stderr || result.stdout || 'build failed').slice(0, 2000),
            status: 'open',
            source: 'hermes',
            sourceRef: 'npm run build',
          });
        }
        await sendTelegramMessage([
          'Hermes build completed for ' + repo + '.',
          'Status: ' + (passed ? 'passed' : 'failed'),
          'Exit code: ' + result.code,
          result.stderr ? ('Stderr: ' + result.stderr.slice(0, 400)) : null,
        ].filter(Boolean).join('\n'), repo, topicId);
        return true;
      }

      if (action === 'ingest') {
        const status = await runGit(['status', '--short', '--branch']);
        const branch = await runGit(['branch', '--show-current']);
        const commit = await runGit(['rev-parse', '--short', 'HEAD']);
        const upstream = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
        const divergence = upstream ? await runGit(['rev-list', '--left-right', '--count', upstream + '...HEAD']) : '';
        const worktree = status ? status.split(/\r?\n/).filter(Boolean) : [];
        const statusLines = worktree.filter((line) => !line.startsWith('##'));
        const staged = statusLines.filter((line) => /^ [MDARCU!?]/.test(line)).length;
        const unstaged = statusLines.filter((line) => /^[MDARCU!?][ MDARCU!?]/.test(line)).length;
        const untracked = statusLines.filter((line) => line.includes('??')).length;
        const hasChanges = statusLines.length > 0;
        const packageJsonPath = path.join(repoPath, 'package.json');
        const hasPackageJson = fs.existsSync(packageJsonPath);
        const packageJson = hasPackageJson ? JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { scripts?: Record<string, string>, packageManager?: string } : null;
        const scripts = packageJson?.scripts || {};
        const packageManager = packageJson?.packageManager || (fs.existsSync(path.join(repoPath, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(repoPath, 'yarn.lock')) ? 'yarn' : fs.existsSync(path.join(repoPath, 'package-lock.json')) ? 'npm' : 'unknown');
        const hasBuildScript = Boolean(scripts['build']);
        const hasTestScript = Boolean(scripts['test']);
        const hasLintScript = Boolean(scripts['lint']);
        const hasCoverageScript = Boolean(scripts['test:coverage']);
        const hasIntegrationScript = Boolean(scripts['test:integration']);
        const lockfile = fs.existsSync(path.join(repoPath, 'pnpm-lock.yaml')) ? 'pnpm-lock.yaml' : fs.existsSync(path.join(repoPath, 'yarn.lock')) ? 'yarn.lock' : fs.existsSync(path.join(repoPath, 'package-lock.json')) ? 'package-lock.json' : null;

        await recordEvent({
          projectId: repo,
          eventType: 'local_state',
          sourceSystem: 'hermes',
          payload: {
            branch,
            commit,
            repoPath,
            upstream: upstream || null,
            divergence: divergence || null,
            workingTree: statusLines,
            hasChanges,
            staged,
            unstaged,
            untracked,
            packageManager,
            lockfile,
            hasBuildScript,
            hasTestScript,
            hasLintScript,
            hasCoverageScript,
            hasIntegrationScript,
          },
        });

        if (hasChanges) {
          await upsertRisk({
            projectId: repo,
            severity: statusLines.length > 8 ? 'high' : 'medium',
            category: 'local_state',
            title: 'Local workspace has pending changes',
            description: statusLines.slice(0, 20).join('\n'),
            status: 'open',
            source: 'hermes',
            sourceRef: 'git status --short --branch',
          });
        }
        if (upstream && divergence) {
          const parts = divergence.split(/\s+/).map((n) => Number(n || 0));
          const behind = parts[0] || 0;
          const ahead = parts[1] || 0;
          if (behind > 0 || ahead > 0) {
            await upsertRisk({
              projectId: repo,
              severity: behind > 0 ? 'high' : 'medium',
              category: 'sync',
              title: 'Branch diverged from upstream',
              description: 'Behind: ' + behind + '; Ahead: ' + ahead + '; upstream: ' + upstream,
              status: 'open',
              source: 'hermes',
              sourceRef: 'git rev-list --left-right --count',
            });
          }
        }
        if (!hasBuildScript || !hasTestScript || !hasLintScript) {
          await upsertRisk({
            projectId: repo,
            severity: 'low',
            category: 'tooling',
            title: 'Missing common repo scripts',
            description: [!hasBuildScript ? 'build' : null, !hasTestScript ? 'test' : null, !hasLintScript ? 'lint' : null].filter(Boolean).join(', '),
            status: 'open',
            source: 'hermes',
            sourceRef: 'package.json',
          });
        }

        await upsertKpi({ projectId: repo, name: 'working_tree_dirty', value: hasChanges ? 1 : 0, unit: 'bool', status: hasChanges ? 'attention' : 'ok', source: 'hermes', sourceRef: 'git status --short --branch' });
        await upsertKpi({ projectId: repo, name: 'staged_files', value: staged, unit: 'files', status: staged > 0 ? 'attention' : 'ok', source: 'hermes', sourceRef: 'git status --short --branch' });
        await upsertKpi({ projectId: repo, name: 'unstaged_files', value: unstaged, unit: 'files', status: unstaged > 0 ? 'attention' : 'ok', source: 'hermes', sourceRef: 'git status --short --branch' });
        await upsertKpi({ projectId: repo, name: 'untracked_files', value: untracked, unit: 'files', status: untracked > 0 ? 'attention' : 'ok', source: 'hermes', sourceRef: 'git status --short --branch' });
        await upsertKpi({ projectId: repo, name: 'commit_present', value: commit ? 1 : 0, unit: 'bool', status: commit ? 'ok' : 'attention', source: 'hermes', sourceRef: 'git rev-parse --short HEAD' });
        await upsertKpi({ projectId: repo, name: 'has_build_script', value: hasBuildScript ? 1 : 0, unit: 'bool', status: hasBuildScript ? 'ok' : 'attention', source: 'hermes', sourceRef: 'package.json' });
        await upsertKpi({ projectId: repo, name: 'has_test_script', value: hasTestScript ? 1 : 0, unit: 'bool', status: hasTestScript ? 'ok' : 'attention', source: 'hermes', sourceRef: 'package.json' });
        await upsertKpi({ projectId: repo, name: 'has_lint_script', value: hasLintScript ? 1 : 0, unit: 'bool', status: hasLintScript ? 'ok' : 'attention', source: 'hermes', sourceRef: 'package.json' });
        await upsertKpi({ projectId: repo, name: 'has_coverage_script', value: hasCoverageScript ? 1 : 0, unit: 'bool', status: hasCoverageScript ? 'ok' : 'attention', source: 'hermes', sourceRef: 'package.json' });
        await upsertKpi({ projectId: repo, name: 'has_integration_script', value: hasIntegrationScript ? 1 : 0, unit: 'bool', status: hasIntegrationScript ? 'ok' : 'attention', source: 'hermes', sourceRef: 'package.json' });
        await upsertMilestone({
          projectId: repo,
          title: 'Hermes local-state review',
          description: 'Branch: ' + (branch || 'unknown') + '; changes: ' + statusLines.length + '; package manager: ' + packageManager,
          status: hasChanges ? 'active' : 'ready',
          progress: hasChanges ? 50 : 100,
          source: 'hermes',
          sourceRef: 'ingest',
        });
        await upsertRelease({
          projectId: repo,
          version: commit || branch || 'local-snapshot',
          status: 'observed',
          releaseNotes: 'Hermes local ingest snapshot (' + packageManager + ')',
        });

        await sendTelegramMessage([
          'Hermes ingest recorded for ' + repo + '.',
          'Branch: ' + (branch || 'unknown'),
          'Commit: ' + (commit || 'unknown'),
          'Upstream: ' + (upstream || 'none'),
          'Divergence: ' + (divergence || 'unknown'),
          'Working tree: ' + (hasChanges ? statusLines.length + ' changed paths' : 'clean'),
          'Package manager: ' + packageManager + (lockfile ? ' (' + lockfile + ')' : ''),
          'Scripts: ' + [hasBuildScript ? 'build' : null, hasTestScript ? 'test' : null, hasLintScript ? 'lint' : null].filter(Boolean).join(', '),
        ].join('\n'), repo, topicId);
        return true;
      }
      if (!message && action !== 'status') {
        await sendTelegramMessage('Hermes needs a message for note, event, decision, milestone, release, risk, or kpi.', repo, topicId);
        return true;
      }

      if (action === 'decision') {
        await upsertDecision({ projectId: repo, title: message.slice(0, 120), decision: message, source: 'hermes' });
        await sendTelegramMessage('Recorded Hermes decision for ' + repo + '.', repo, topicId);
        return true;
      }
      if (action === 'milestone') {
        const parts = message.split('|').map((s) => s.trim());
        await upsertMilestone({ projectId: repo, title: parts[0] || message.slice(0, 120), description: parts.slice(1).join(' | ') || null, status: 'planned', source: 'hermes' });
        await sendTelegramMessage('Recorded Hermes milestone for ' + repo + '.', repo, topicId);
        return true;
      }
      if (action === 'release') {
        const parts = message.split('|').map((s) => s.trim());
        await upsertRelease({ projectId: repo, version: parts[0] || 'unknown', status: 'planned', releaseNotes: parts.slice(1).join(' | ') || null });
        await sendTelegramMessage('Recorded Hermes release for ' + repo + '.', repo, topicId);
        return true;
      }
      if (action === 'risk') {
        const parts = message.split('|').map((s) => s.trim());
        await upsertRisk({ projectId: repo, severity: parts[0] || 'medium', title: parts[1] || message.slice(0, 120), description: parts.slice(2).join(' | ') || null, source: 'hermes' });
        await sendTelegramMessage('Recorded Hermes risk for ' + repo + '.', repo, topicId);
        return true;
      }
      if (action === 'kpi') {
        const parts = message.split('|').map((s) => s.trim());
        const value = Number(parts[1]);
        await upsertKpi({ projectId: repo, name: parts[0] || 'unnamed_kpi', value: Number.isFinite(value) ? value : 0, unit: parts[2] || null, status: Number.isFinite(value) ? 'tracking' : 'attention', source: 'hermes', sourceRef: parts.slice(3).join(' | ') || null });
        await sendTelegramMessage('Recorded Hermes KPI for ' + repo + '.', repo, topicId);
        return true;
      }
      if (action === 'note' || action === 'event') {
        await recordEvent({ projectId: repo, eventType: action === 'note' ? 'local_state' : 'agent_action', sourceSystem: 'hermes', payload: { title: message.slice(0, 120), detail: message, source: 'hermes', action } });
        await sendTelegramMessage('Recorded Hermes ' + action + ' for ' + repo + '.', repo, topicId);
        return true;
      }

      await sendTelegramMessage('Unknown Hermes action. Use ingest, build, test, note, event, decision, milestone, release, risk, kpi, or status.', repo, topicId);
      return true;
    }
    case 'viktor-log': {
      // Phase 6's audit-trail command — "view/audit Viktor's recent
      // decisions" from the plan doc (name was left TBD there; "viktor log"
      // matches this repo's verb-first naming convention). parts[2], if
      // present, filters to one repo.
      const repoFilter = parts[2] || null;
      const entries = await getRecentAuthorityLog(20, repoFilter).catch((err: any) => {
        logger.error({ err: err.message }, 'viktor-log query failed');
        return [];
      });
      if (entries.length === 0) {
        await sendTelegramMessage('No Viktor authority-log entries yet.', repoFilter, topicId);
        return true;
      }
      const lines = entries.map((e) =>
        `${new Date(e.created_at).toISOString()} — ${e.decision.toUpperCase()} — ${e.action}` +
        (e.target_repo ? ` (${e.target_repo})` : '') +
        (e.target_agent ? ` → ${e.target_agent}` : '') +
        (e.reasoning ? ` — ${e.reasoning}` : '')
      );
      await sendTelegramMessage(['Viktor authority log (most recent first):', ...lines].join('\n'), repoFilter, topicId);
      return true;
    }
    case 'viktor-rules': {
      const rules = await listAuthorityRules().catch((err: any) => {
        logger.error({ err: err.message }, 'viktor-rules query failed');
        return [];
      });
      const lines = rules.map((r) =>
        `${r.enabled ? '✅' : '⬜'} ${r.actionType}` +
        (r.maxScope && Object.keys(r.maxScope).length ? ` — max_scope=${JSON.stringify(r.maxScope)}` : '') +
        (r.canDelegateTo && r.canDelegateTo.length ? ` — can_delegate_to=[${r.canDelegateTo.join(', ')}]` : '')
      );
      await sendTelegramMessage(
        ['Viktor authority rules:', ...lines, '', 'All rules ship disabled by default — enable directly in viktor_authority once you\'ve decided Viktor\'s actual scope.'].join('\n'),
        null, topicId
      );
      return true;
    }
    default:
      return false;
  }
}

export = { handleAgentsCmd };





