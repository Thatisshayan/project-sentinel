import logger from '../logger';
import { sendTelegramMessage } from '../telegramClient';
import { approveSprint, getSprintStatus, pauseSprint, resumeSprint } from '../sprintOrchestrator';

async function handleSprintCmd(subcommand: string, parts: string[], chatId: string | null, topicId: number | null): Promise<boolean> {
  switch (subcommand) {
    case 'approve-sprint': {
      approveSprint(topicId)
        .catch((err: any) => logger.error({ err: err.message }, 'approve-sprint failed'));
      return true;
    }
    case 'skip-sprint': {
      const { getCurrentSprint, updateSprint } = require('../sprintDb') as { getCurrentSprint: () => Promise<any>; updateSprint: (id: any, data: any) => Promise<any> };
      const sprint = await getCurrentSprint();
      if (sprint) {
        await updateSprint(sprint.id, { status: 'skipped' });
        await sendTelegramMessage('Sprint skipped. Next proposal Sunday 8pm.', null, topicId);
      } else {
        await sendTelegramMessage('No active sprint proposal to skip.', null, topicId);
      }
      return true;
    }
    case 'sprint-status': {
      getSprintStatus(topicId).catch(() => {});
      return true;
    }
    case 'pause-sprint': {
      pauseSprint(topicId).catch(() => {});
      return true;
    }
    case 'resume-sprint': {
      resumeSprint(topicId).catch(() => {});
      return true;
    }
    case 'propose-sprint': {
      const { generateSprintProposal } = require('../sprintPlanner') as { generateSprintProposal: () => Promise<any> };
      await sendTelegramMessage('Generating sprint proposal...', null, topicId);
      generateSprintProposal().catch((err: any) =>
        logger.error({ err: err.message }, 'Manual sprint proposal failed')
      );
      return true;
    }
    case 'run-sprint': {
      const { getCurrentSprint } = require('../sprintDb') as { getCurrentSprint: () => Promise<any> };
      const sprint = await getCurrentSprint().catch(() => null);
      if (!sprint) {
        await sendTelegramMessage('No active sprint. Propose one: /sentinel propose-sprint', null, topicId);
        return true;
      }
      if (sprint.status === 'proposed') {
        await sendTelegramMessage(
          `Sprint is pending approval. Use /sentinel approve-sprint to approve and start it.`,
          null, topicId
        );
        return true;
      }
      if (sprint.status === 'executing') {
        const { executeNextSprintTask } = require('../sprintOrchestrator') as { executeNextSprintTask: (...args: any[]) => Promise<any> };
        await sendTelegramMessage(`Resuming sprint execution (${sprint.total_tasks} tasks)...`, null, topicId);
        executeNextSprintTask(sprint.id, topicId).catch(() => {});
        return true;
      }
      await sendTelegramMessage(`Sprint status: ${sprint.status}. Nothing to run.`, null, topicId);
      return true;
    }
    default:
      return false;
  }
}

export = { handleSprintCmd };
