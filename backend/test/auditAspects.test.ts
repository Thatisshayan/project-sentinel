const getAspectStateMock = jest.fn();
const setAspectStateMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/projectDb', () => ({
  getAspectState: (...a: any[]) => getAspectStateMock(...a),
  setAspectState: (...a: any[]) => setAspectStateMock(...a),
}));

import auditAspects from '../src/auditAspects';
const { ASPECTS, SPRINTS_PER_ASPECT, getCurrentAspect, recordSprintCompleted, nextAspect } = auditAspects;

describe('auditAspects (D-027 item 5: multi-aspect audit rotation)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('ASPECTS covers the aspects named in the roadmap and SPRINTS_PER_ASPECT is 3 (10 tasks * 3 = 3 sprints)', () => {
    expect(SPRINTS_PER_ASPECT).toBe(3);
    expect(ASPECTS).toEqual(expect.arrayContaining(['security', 'backend', 'frontend', 'documentation', 'testing']));
  });

  test('nextAspect wraps around at the end of the list', () => {
    const last = ASPECTS[ASPECTS.length - 1];
    expect(nextAspect(last)).toBe(ASPECTS[0]);
  });

  test('getCurrentAspect initializes an unaudited repo to the first aspect at sprint 0', async () => {
    getAspectStateMock.mockResolvedValue(null);
    const state = await getCurrentAspect('tapcash');
    expect(state).toEqual({ aspect: ASPECTS[0], sprintCount: 0 });
    expect(setAspectStateMock).toHaveBeenCalledWith('tapcash', ASPECTS[0], 0);
  });

  test('getCurrentAspect returns the persisted state when present', async () => {
    getAspectStateMock.mockResolvedValue({ aspect: 'security', sprintCount: 2 });
    const state = await getCurrentAspect('tapcash');
    expect(state).toEqual({ aspect: 'security', sprintCount: 2 });
    expect(setAspectStateMock).not.toHaveBeenCalled();
  });

  test('getCurrentAspect falls back to the first aspect if the persisted value is not a recognized aspect (e.g. stale/renamed)', async () => {
    getAspectStateMock.mockResolvedValue({ aspect: 'not-a-real-aspect', sprintCount: 5 });
    const state = await getCurrentAspect('tapcash');
    expect(state).toEqual({ aspect: ASPECTS[0], sprintCount: 0 });
  });

  test('recordSprintCompleted increments the counter without rotating before 3 sprints', async () => {
    getAspectStateMock.mockResolvedValue({ aspect: 'security', sprintCount: 1 });
    const result = await recordSprintCompleted('tapcash', 'security');
    expect(result).toEqual({ aspect: 'security', sprintCount: 2, rotated: false });
    expect(setAspectStateMock).toHaveBeenCalledWith('tapcash', 'security', 2);
  });

  test('recordSprintCompleted rotates to the next aspect and resets the counter on the 3rd sprint', async () => {
    getAspectStateMock.mockResolvedValue({ aspect: 'security', sprintCount: 2 });
    const result = await recordSprintCompleted('tapcash', 'security');
    expect(result.rotated).toBe(true);
    expect(result.sprintCount).toBe(0);
    expect(result.aspect).toBe(nextAspect('security'));
    expect(setAspectStateMock).toHaveBeenCalledWith('tapcash', nextAspect('security'), 0);
  });

  test('recordSprintCompleted ignores a stale call for an aspect that has already rotated away', async () => {
    getAspectStateMock.mockResolvedValue({ aspect: 'frontend', sprintCount: 0 });
    const result = await recordSprintCompleted('tapcash', 'security');
    expect(result).toEqual({ aspect: 'frontend', sprintCount: 0, rotated: false });
    expect(setAspectStateMock).not.toHaveBeenCalled();
  });
});
