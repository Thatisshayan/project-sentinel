import logger from './logger';
import { getAllAgents } from './agentDb';
import { sendTelegramMessage } from './telegramClient';

const AGENT_ROOM_TOPIC = (): number => parseInt(process.env['AGENT_ROOM_TOPIC_ID'] || '494');

async function postAgentLeaderboard(): Promise<void> {
  logger.info('Posting agent leaderboard');

  try {
    const agents = await getAllAgents();
    const active = agents.filter((a: any) => a.status !== 'disabled' && (a.completed_tasks || 0) > 0);

    if (active.length === 0) {
      await sendTelegramMessage('📊 Leaderboard: No activity yet this week.', null, AGENT_ROOM_TOPIC());
      return;
    }

    const ranked = active
      .map((a: any) => ({
        ...a,
        total:       (a.completed_tasks || 0) + (a.failed_tasks || 0),
        successRate: (a.completed_tasks || 0) > 0
          ? Math.round(((a.completed_tasks || 0) / ((a.completed_tasks || 0) + (a.failed_tasks || 0))) * 100)
          : 0,
      }))
      .sort((a: any, b: any) => b.completed_tasks - a.completed_tasks || b.successRate - a.successRate);

    const medals = ['🥇', '🥈', '🥉'];
    const week   = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Toronto', month: 'short', day: 'numeric',
    });

    const lines = [
      `🏆 Agent Leaderboard — Week of ${week}`,
      ``,
      ...ranked.map((a: any, i: number) => {
        const medal = medals[i] || `${i + 1}.`;
        return `${medal} ${a.agent_label}: ${a.completed_tasks} tasks, ${a.successRate}% success`;
      }),
      ``,
      `Total tasks this week: ${ranked.reduce((s: number, a: any) => s + (a.completed_tasks || 0), 0)}`,
    ];

    await sendTelegramMessage(lines.join('\n'), null, AGENT_ROOM_TOPIC());
    logger.info('Leaderboard posted');
  } catch (err: any) {
    logger.error({ err: err.message }, 'Leaderboard failed');
  }
}

export = { postAgentLeaderboard };
