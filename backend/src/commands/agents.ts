import logger from '../logger';
import { sendTelegramMessage } from '../telegramClient';
import { repoFullName } from '../repoResolver';
import { getAgentRoomSummary } from '../agentRoom';
import { getAllAgents } from '../agentDb';
import { runSelfAudit } from '../selfAuditor';
import { executeApprovedTasks } from '../auditOrchestrator';

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
      runSelfAudit().catch((err: any) => logger.error({ err: err.message }, 'Self-audit failed'));
      return true;
    }
    case 'self-approve': {
      await sendTelegramMessage('Approving Sentinel self-improvement tasks...', null, topicId);
      executeApprovedTasks(
        repoFullName('project-sentinel'),
        'project-sentinel',
        topicId
      ).catch(() => {});
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
      runAgentStandup().catch((err: any) => logger.error({ err: err.message }, 'Manual standup failed'));
      return true;
    }
    case 'leaderboard': {
      const { postAgentLeaderboard } = require('../agentLeaderboard') as { postAgentLeaderboard: () => Promise<void> };
      postAgentLeaderboard().catch((err: any) => logger.error({ err: err.message }, 'Manual leaderboard failed'));
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
    default:
      return false;
  }
}

export = { handleAgentsCmd };
