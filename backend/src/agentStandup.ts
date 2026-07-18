import { safeFire, fireAndForget } from './utils/safeFire';
import logger from './logger';
import { getAllAgents } from './agentDb';
import dbClient from './dbClient';
import { sendAsAgent } from './agentBots';
import { getStandupLine } from './agentPersonality';
import { sendTelegramMessage } from './telegramClient';

const { query } = dbClient;

const AGENT_ROOM_TOPIC = (): number => parseInt(process.env['AGENT_ROOM_TOPIC_ID'] || '494');

async function getRealAgentStats(agentId: string): Promise<any> {
  const [taskRows, cycleRows] = await Promise.all([
    query(`
      SELECT
        COUNT(CASE WHEN status IN ('done','build_check') THEN 1 END)::int AS done,
        COUNT(CASE WHEN status = 'failed' THEN 1 END)::int                AS failed,
        COUNT(CASE WHEN status = 'queued' THEN 1 END)::int                AS queued,
        COUNT(pr_url)::int                                                 AS prs
      FROM audit_tasks
      WHERE builder_agent = $1
        AND created_at > NOW() - INTERVAL '7 days'
    `, [agentId]).catch(() => ({ rows: [{}] })),
    query(`
      SELECT COUNT(*)::int AS audits
      FROM audit_cycles
      WHERE audit_agent = $1
        AND created_at > NOW() - INTERVAL '7 days'
    `, [agentId]).catch(() => ({ rows: [{}] })),
  ]);
  return {
    done:   parseInt(taskRows.rows[0]?.done    || 0),
    failed: parseInt(taskRows.rows[0]?.failed  || 0),
    queued: parseInt(taskRows.rows[0]?.queued  || 0),
    prs:    parseInt(taskRows.rows[0]?.prs     || 0),
    audits: parseInt(cycleRows.rows[0]?.audits || 0),
  };
}

async function runAgentStandup(): Promise<void> {
  logger.info('Running agent standup');

  try {
    const agents = await getAllAgents();

    for (const agent of agents) {
      if (agent.status === 'disabled') continue;

      const real  = await getRealAgentStats(agent.agent_id).catch(() => ({}));

      const stats = {
        tasks:          real.done   || 0,
        done:           real.done   || 0,
        failed:         real.failed || 0,
        prs:            real.prs    || 0,
        audits:         real.audits || 0,
        queued:         real.queued || 0,
        tasksGenerated: 0,
        debugs:         0,
        issues:         0,
        complex:        0,
      };

      const line = getStandupLine(agent.agent_id, stats);

      await sendAsAgent(agent.agent_id, line, null).catch(async () => {
        await safeFire(sendTelegramMessage(
          `${agent.emoji || '🤖'} ${agent.agent_label}: ${line}`,
          null, AGENT_ROOM_TOPIC()
        ), { label: 'agentStandup' })
      });

      // Small delay so messages don't stack instantly
      await new Promise(r => setTimeout(r, 1500));
    }

    logger.info('Agent standup complete');
  } catch (err: any) {
    logger.error({ err: err.stack ?? err.message }, 'Agent standup failed');
  }
}

export = { runAgentStandup };

