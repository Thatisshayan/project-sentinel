import { safeFire, fireAndForget } from '../utils/safeFire';
import logger from '../logger';
import { sendTelegramMessage } from '../telegramClient';
import { repoFullName } from '../repoResolver';
import { getAgentRoomSummary } from '../agentRoom';
import { getAllAgents } from '../agentDb';
import { runSelfAudit } from '../selfAuditor';
import { executeApprovedTasks } from '../auditOrchestrator';
import { dispatchToAgent, listExternalAgents } from '../agents/externalAgentRegistry';
import { getRecentAuthorityLog, listAuthorityRules } from '../viktorAuthority';

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
      const { getConfiguredBots, sendAsAgent } = require('../agentBots') as { getConfiguredBots: () => { configured: string[]; missing: string[] }; sendAsAgent: (id: string, msg: string) => Promise<any> };
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
      const { getConfiguredBots, configureBotProfile } = require('../agentBots') as { getConfiguredBots: () => { configured: string[] }; configureBotProfile: (id: string, name: string) => Promise<any> };
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
      const { getHistory } = require('../conversationMemory') as { getHistory: (topicId: string | number, limit?: number) => Promise<any[]> };
      const history = await getHistory(topicId ?? 0, 10).catch(() => []);
      if (history.length === 0) {
        await sendTelegramMessage('No conversation history for this topic yet.', null, topicId);
        return true;
      }
      const lines = history.map((h: any) =>
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
      const lines = entries.map((e: any) =>
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
      const lines = rules.map((r: any) =>
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

