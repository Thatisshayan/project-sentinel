import { fireAndForget } from '../utils/safeFire';
import { releaseExpiredLocks } from '../agentDb';
import { updatePinnedStatusBoard } from '../agentRoom';
import logger from '../logger';

export function startAgentCleanupWorker(): void {
  // Release expired file locks every hour
  setInterval(() => {
    fireAndForget(releaseExpiredLocks(), { label: 'workers' })
  }, 60 * 60 * 1000);

  // Improvement 1 — update pinned status board every 30 minutes
  setInterval(() => {
    fireAndForget(updatePinnedStatusBoard(), { label: 'workers' })
  }, 30 * 60 * 1000);

  // Send initial status board on startup (non-blocking)
  fireAndForget(updatePinnedStatusBoard(), { label: 'workers' })

  logger.info('Agent cleanup worker started (locks every 1h, status board every 30m)');
}
