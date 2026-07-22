const checkAuthorityMock = jest.fn();
const canDelegateToMock = jest.fn();
const logAuthorityActionMock = jest.fn();
jest.mock('../src/viktorAuthority', () => ({
  checkAuthority: (...a: any[]) => checkAuthorityMock(...a),
  canDelegateTo: (...a: any[]) => canDelegateToMock(...a),
  logAuthorityAction: (...a: any[]) => logAuthorityActionMock(...a),
}));

const getSettingsMock = jest.fn();
jest.mock('../src/settingsDb', () => ({ getSettings: (...a: any[]) => getSettingsMock(...a) }));

const sendSlackMessageToChannelMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/slackClient', () => ({
  sendSlackMessageToChannel: (...a: any[]) => sendSlackMessageToChannelMock(...a),
}));

const dispatchToAgentMock = jest.fn();
jest.mock('../src/agents/externalAgentRegistry', () => ({
  dispatchToAgent: (...a: any[]) => dispatchToAgentMock(...a),
}));

const getCurrentSprintMock = jest.fn();
jest.mock('../src/sprintDb', () => ({ getCurrentSprint: (...a: any[]) => getCurrentSprintMock(...a) }));

const approveSprintMock = jest.fn();
jest.mock('../src/sprintOrchestrator', () => ({ approveSprint: (...a: any[]) => approveSprintMock(...a) }));

const repoFullNameMock = jest.fn((r: string) => `owner/${r}`);
jest.mock('../src/repoResolver', () => ({ repoFullName: (...a: any[]) => repoFullNameMock(...a) }));

const resolveAllOpenIssuesMock = jest.fn();
const getOpenIssuesMock = jest.fn();
jest.mock('../src/securityDb', () => ({
  resolveAllOpenIssues: (...a: any[]) => resolveAllOpenIssuesMock(...a),
  getOpenIssues: (...a: any[]) => getOpenIssuesMock(...a),
}));

import { handleViktorMessage } from '../src/agents/viktorWatcher';

const VIKTOR_ID = 'U_VIKTOR_REAL';

describe('viktorWatcher — gating', () => {
  const ORIGINAL_ENV = process.env;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env['VIKTOR_SLACK_USER_ID'];
    getSettingsMock.mockResolvedValue({ sentinel_paused: false });
  });
  afterAll(() => { process.env = ORIGINAL_ENV; });

  it('is inert when VIKTOR_SLACK_USER_ID is unconfigured', async () => {
    await handleViktorMessage({ user: 'U_ANYONE', text: 'approve sprint', channel: 'C1' });
    expect(checkAuthorityMock).not.toHaveBeenCalled();
    expect(logAuthorityActionMock).not.toHaveBeenCalled();
  });

  it('ignores a message from a user that is not Viktor even when configured', async () => {
    process.env['VIKTOR_SLACK_USER_ID'] = VIKTOR_ID;
    await handleViktorMessage({ user: 'U_SOMEONE_ELSE', text: 'approve sprint', channel: 'C1' });
    expect(checkAuthorityMock).not.toHaveBeenCalled();
  });

  it('denies (kill switch) and logs when Sentinel is paused, without checking authority rules', async () => {
    process.env['VIKTOR_SLACK_USER_ID'] = VIKTOR_ID;
    getSettingsMock.mockResolvedValue({ sentinel_paused: true });
    await handleViktorMessage({ user: VIKTOR_ID, text: 'approve sprint', channel: 'C1' });
    expect(checkAuthorityMock).not.toHaveBeenCalled();
    expect(logAuthorityActionMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'denied', reasoning: expect.stringMatching(/paused/i) }));
    expect(sendSlackMessageToChannelMock).toHaveBeenCalledWith(expect.stringMatching(/paused/i), 'C1');
  });

  it('fails closed (treats as paused) when reading settings itself throws', async () => {
    process.env['VIKTOR_SLACK_USER_ID'] = VIKTOR_ID;
    getSettingsMock.mockRejectedValue(new Error('db down'));
    await handleViktorMessage({ user: VIKTOR_ID, text: 'approve sprint', channel: 'C1' });
    expect(checkAuthorityMock).not.toHaveBeenCalled();
    expect(logAuthorityActionMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'denied' }));
  });

  it('ignores unrecognized text from Viktor without logging an authority event', async () => {
    process.env['VIKTOR_SLACK_USER_ID'] = VIKTOR_ID;
    await handleViktorMessage({ user: VIKTOR_ID, text: 'just chatting, how is everyone', channel: 'C1' });
    expect(logAuthorityActionMock).not.toHaveBeenCalled();
  });
});

describe('viktorWatcher — approve sprint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['VIKTOR_SLACK_USER_ID'] = VIKTOR_ID;
    getSettingsMock.mockResolvedValue({ sentinel_paused: false });
  });

  it('denies when no sprint proposal exists', async () => {
    getCurrentSprintMock.mockResolvedValue(null);
    await handleViktorMessage({ user: VIKTOR_ID, text: 'approve sprint', channel: 'C1' });
    expect(checkAuthorityMock).not.toHaveBeenCalled();
    expect(logAuthorityActionMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'denied', reasoning: expect.stringMatching(/No sprint proposal/) }));
    expect(approveSprintMock).not.toHaveBeenCalled();
  });

  it('denies when the sprint is not in "proposed" status', async () => {
    getCurrentSprintMock.mockResolvedValue({ id: 1, status: 'executing', total_tasks: 4 });
    await handleViktorMessage({ user: VIKTOR_ID, text: 'approve sprint', channel: 'C1' });
    expect(logAuthorityActionMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'denied', reasoning: expect.stringMatching(/already executing/) }));
    expect(approveSprintMock).not.toHaveBeenCalled();
  });

  it('checks authority with the sprint\'s task count as scope, denies and does not execute when over limit', async () => {
    getCurrentSprintMock.mockResolvedValue({ id: 1, status: 'proposed', total_tasks: 20 });
    checkAuthorityMock.mockResolvedValue({ allowed: false, reason: 'max_tasks=20 exceeds max_scope limit 5', rule: null });
    await handleViktorMessage({ user: VIKTOR_ID, text: 'approve sprint', channel: 'C1' });
    expect(checkAuthorityMock).toHaveBeenCalledWith('sprint_approve', { max_tasks: 20 });
    expect(approveSprintMock).not.toHaveBeenCalled();
    expect(logAuthorityActionMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'denied' }));
    expect(sendSlackMessageToChannelMock).toHaveBeenCalledWith(expect.stringMatching(/Denied/), 'C1');
  });

  it('executes approveSprint and logs "executed" when within authority', async () => {
    getCurrentSprintMock.mockResolvedValue({ id: 1, status: 'proposed', total_tasks: 3 });
    checkAuthorityMock.mockResolvedValue({ allowed: true, reason: 'within configured authority', rule: {} });
    approveSprintMock.mockResolvedValue(undefined);
    await handleViktorMessage({ user: VIKTOR_ID, text: 'approve sprint', channel: 'C1' });
    expect(approveSprintMock).toHaveBeenCalledWith(null);
    expect(logAuthorityActionMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'executed' }));
    expect(sendSlackMessageToChannelMock).toHaveBeenCalledWith(expect.stringMatching(/approved/i), 'C1');
  });

  it('logs execution_failed if approveSprint itself throws after being authorized', async () => {
    getCurrentSprintMock.mockResolvedValue({ id: 1, status: 'proposed', total_tasks: 3 });
    checkAuthorityMock.mockResolvedValue({ allowed: true, reason: 'ok', rule: {} });
    approveSprintMock.mockRejectedValue(new Error('sprint db down'));
    await handleViktorMessage({ user: VIKTOR_ID, text: 'approve sprint', channel: 'C1' });
    expect(logAuthorityActionMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'execution_failed' }));
  });
});

describe('viktorWatcher — approve security', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['VIKTOR_SLACK_USER_ID'] = VIKTOR_ID;
    getSettingsMock.mockResolvedValue({ sentinel_paused: false });
  });

  it('denies when not authorized', async () => {
    checkAuthorityMock.mockResolvedValue({ allowed: false, reason: 'disabled', rule: null });
    await handleViktorMessage({ user: VIKTOR_ID, text: 'approve security costpilot', channel: 'C1' });
    expect(resolveAllOpenIssuesMock).not.toHaveBeenCalled();
    expect(logAuthorityActionMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'denied', targetRepo: 'costpilot' }));
  });

  it('resolves issues and logs executed when authorized and every open issue is low/medium severity', async () => {
    checkAuthorityMock.mockResolvedValue({ allowed: true, reason: 'ok', rule: {} });
    getOpenIssuesMock.mockResolvedValue([{ severity: 'low' }, { severity: 'medium' }]);
    resolveAllOpenIssuesMock.mockResolvedValue(2);
    await handleViktorMessage({ user: VIKTOR_ID, text: 'approve security costpilot', channel: 'C1' });
    expect(repoFullNameMock).toHaveBeenCalledWith('costpilot');
    expect(resolveAllOpenIssuesMock).toHaveBeenCalledWith('owner/costpilot');
    expect(logAuthorityActionMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'executed', targetRepo: 'costpilot' }));
  });

  it('denies (even though the rule is enabled) when an open issue is above the low/medium ceiling', async () => {
    checkAuthorityMock.mockResolvedValue({ allowed: true, reason: 'ok', rule: {} });
    getOpenIssuesMock.mockResolvedValue([{ severity: 'low' }, { severity: 'critical' }]);
    await handleViktorMessage({ user: VIKTOR_ID, text: 'approve security costpilot', channel: 'C1' });
    expect(resolveAllOpenIssuesMock).not.toHaveBeenCalled();
    expect(logAuthorityActionMock).toHaveBeenCalledWith(expect.objectContaining({
      decision: 'denied', reasoning: expect.stringMatching(/critical/),
    }));
  });

  it('fails closed (denies) when checking open-issue severities itself throws', async () => {
    checkAuthorityMock.mockResolvedValue({ allowed: true, reason: 'ok', rule: {} });
    getOpenIssuesMock.mockRejectedValue(new Error('db down'));
    await handleViktorMessage({ user: VIKTOR_ID, text: 'approve security costpilot', channel: 'C1' });
    expect(resolveAllOpenIssuesMock).not.toHaveBeenCalled();
    expect(logAuthorityActionMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'denied' }));
  });
});

describe('viktorWatcher — delegate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['VIKTOR_SLACK_USER_ID'] = VIKTOR_ID;
    getSettingsMock.mockResolvedValue({ sentinel_paused: false });
  });

  it('denies delegation to an agent not in can_delegate_to', async () => {
    canDelegateToMock.mockResolvedValue(false);
    await handleViktorMessage({ user: VIKTOR_ID, text: 'delegate kilo costpilot fix the flaky test', channel: 'C1' });
    expect(dispatchToAgentMock).not.toHaveBeenCalled();
    expect(logAuthorityActionMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'denied', targetAgent: 'kilo', targetRepo: 'costpilot' }));
  });

  it('dispatches and logs executed when the agent is authorized', async () => {
    canDelegateToMock.mockResolvedValue(true);
    dispatchToAgentMock.mockResolvedValue({ ts: '123.456' });
    await handleViktorMessage({ user: VIKTOR_ID, text: 'delegate kilo costpilot fix the flaky test in auth.ts', channel: 'C1' });
    expect(dispatchToAgentMock).toHaveBeenCalledWith('kilo', 'fix the flaky test in auth.ts', 'costpilot');
    expect(logAuthorityActionMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'executed', targetAgent: 'kilo', targetRepo: 'costpilot' }));
  });
});
