const logger              = require('../logger');
const { sendTelegramMessage } = require('../telegramClient');
const { repoFullName }    = require('../repoResolver');
const { getAgentRoomSummary } = require('../agentRoom');
const { getAllAgents }    = require('../agentDb');
const { runSelfAudit }   = require('../selfAuditor');
const {
  executeApprovedTasks,
} = require('../auditOrchestrator');

async function handleAgentsCmd(subcommand, parts, chatId, topicId) {
  switch (subcommand) {
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
      await sendTelegramMessage('Approving Sentinel self-improvement tasks...', null, topicId);
      executeApprovedTasks(
        repoFullName('project-sentinel'),
        'project-sentinel',
        topicId
      ).catch(() => {});
      return true;
    }
    case 'bots': {
      const { getConfiguredBots } = require('../agentBots');
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
      const { getConfiguredBots, sendAsAgent } = require('../agentBots');
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
    case 'setup-bots': {
      const { getConfiguredBots, configureBotProfile } = require('../agentBots');
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
      const { runAgentStandup } = require('../agentStandup');
      await sendTelegramMessage('Running agent standup...', null, topicId);
      runAgentStandup().catch(err => logger.error({ err: err.message }, 'Manual standup failed'));
      return true;
    }
    case 'leaderboard': {
      const { postAgentLeaderboard } = require('../agentLeaderboard');
      postAgentLeaderboard().catch(err => logger.error({ err: err.message }, 'Manual leaderboard failed'));
      return true;
    }
    case 'memory': {
      const { getHistory } = require('../conversationMemory');
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
    default:
      return false;
  }
}

module.exports = { handleAgentsCmd };
