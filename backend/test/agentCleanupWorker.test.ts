jest.useFakeTimers();

const fireAndForgetMock = jest.fn();
jest.mock('../src/utils/safeFire', () => ({
  fireAndForget: (...args: any[]) => fireAndForgetMock(...args),
}));

const releaseExpiredLocksMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/agentDb', () => ({
  releaseExpiredLocks: () => releaseExpiredLocksMock(),
}));

const updatePinnedStatusBoardMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/agentRoom', () => ({
  updatePinnedStatusBoard: () => updatePinnedStatusBoardMock(),
}));

import { startAgentCleanupWorker } from '../src/workers/agentCleanupWorker';

describe('startAgentCleanupWorker', () => {
  beforeEach(() => {
    jest.clearAllTimers();
    fireAndForgetMock.mockClear();
    releaseExpiredLocksMock.mockClear();
    updatePinnedStatusBoardMock.mockClear();
  });

  it('fires an initial status board update immediately on startup', () => {
    startAgentCleanupWorker();
    expect(fireAndForgetMock).toHaveBeenCalledWith(expect.anything(), { label: 'workers' });
    // updatePinnedStatusBoard() was invoked synchronously to produce the promise passed in
    expect(updatePinnedStatusBoardMock).toHaveBeenCalledTimes(1);
  });

  it('releases expired locks every hour, not before', () => {
    startAgentCleanupWorker();
    releaseExpiredLocksMock.mockClear();

    jest.advanceTimersByTime(59 * 60 * 1000);
    expect(releaseExpiredLocksMock).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1 * 60 * 1000 + 1);
    expect(releaseExpiredLocksMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes the pinned status board every 30 minutes, not before', () => {
    startAgentCleanupWorker();
    updatePinnedStatusBoardMock.mockClear();

    jest.advanceTimersByTime(29 * 60 * 1000);
    expect(updatePinnedStatusBoardMock).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1 * 60 * 1000 + 1);
    expect(updatePinnedStatusBoardMock).toHaveBeenCalledTimes(1);
  });
});
