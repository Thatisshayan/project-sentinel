import { safeFire, fireAndForget } from '../utils/safeFire';
import logger from '../logger';
import { sendTelegramMessage } from '../telegramClient';
import { approveSprint, getSprintStatus, pauseSprint, resumeSprint } from '../sprintOrchestrator';
import type { SprintRow, SprintProposal } from '../types/sprintRow';

async function handleSprintCmd(subcommand: string, parts: string[], chatId: string | null, topicId: number | null): Promise<boolean> {
  switch (subcommand) {
    case 'approve-sprint': {
      approveSprint(topicId)
        .catch((err: any) => logger.error({ err: err.stack ?? err.message }, 'approve-sprint failed'));
      return true;
    }
    case 'skip-sprint': {
      const { getCurrentSprint, updateSprint } = require('../sprintDb') as {
        getCurrentSprint: () => Promise<SprintRow | null>;
        updateSprint: (id: number, data: Partial<SprintRow>) => Promise<SprintRow | null>;
      };
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
      fireAndForget(getSprintStatus(topicId), { label: 'sprint' })
      return true;
    }
    case 'pause-sprint': {
      fireAndForget(pauseSprint(topicId), { label: 'sprint' })
      return true;
    }
    case 'resume-sprint': {
      fireAndForget(resumeSprint(topicId), { label: 'sprint' })
      return true;
    }
    case 'propose-sprint': {
      const { generateSprintProposal } = require('../sprintPlanner') as {
        generateSprintProposal: () => Promise<{ sprint: SprintRow; proposal: SprintProposal }>;
      };
      await sendTelegramMessage('Generating sprint proposal...', null, topicId);
      generateSprintProposal().catch((err) =>
        logger.error({ err: err.stack ?? err.message }, 'Manual sprint proposal failed')
      );
      return true;
    }
    case 'run-sprint': {
      const { getCurrentSprint } = require('../sprintDb') as { getCurrentSprint: () => Promise<SprintRow | null> };
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
        const { executeNextSprintTask } = require('../sprintOrchestrator') as { executeNextSprintTask: (sprintId: number, topicId: number | null) => Promise<void> };
        await sendTelegramMessage(`Resuming sprint execution (${sprint.total_tasks} tasks)...`, null, topicId);
        fireAndForget(executeNextSprintTask(sprint.id, topicId), { label: 'sprint' })
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

