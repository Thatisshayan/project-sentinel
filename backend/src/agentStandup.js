const logger = require('./logger');
const { getAllAgents }         = require('./agentDb');
const { sendAsAgent }         = require('./agentBots');
const { getStandupLine }      = require('./agentPersonality');
const { sendTelegramMessage } = require('./telegramClient');

const AGENT_ROOM_TOPIC = () => parseInt(process.env.AGENT_ROOM_TOPIC_ID || '494');

async function runAgentStandup() {
  logger.info('Running agent standup');

  try {
    const agents = await getAllAgents();

    for (const agent of agents) {
      if (agent.status === 'disabled') continue;

      const stats = {
        tasks:          agent.completed_tasks || 0,
        done:           agent.completed_tasks || 0,
        failed:         agent.failed_tasks    || 0,
        prs:            0,
        audits:         0,
        tasksGenerated: 0,
        debugs:         0,
        issues:         0,
        complex:        0,
      };

      const line = getStandupLine(agent.agent_id, stats);

      await sendAsAgent(agent.agent_id, line, null).catch(async () => {
        await sendTelegramMessage(
          `${agent.emoji || '🤖'} ${agent.agent_label}: ${line}`,
          null, AGENT_ROOM_TOPIC()
        ).catch(() => {});
      });

      // Small delay so messages don't stack instantly
      await new Promise(r => setTimeout(r, 1500));
    }

    logger.info('Agent standup complete');
  } catch (err) {
    logger.error({ err: err.message }, 'Agent standup failed');
  }
}

module.exports = { runAgentStandup };
