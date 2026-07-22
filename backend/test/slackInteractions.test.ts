const verifySlackSignatureMock = jest.fn().mockReturnValue(true);
jest.mock('../src/slackEvents', () => ({
  verifySlackSignature: (...a: any[]) => verifySlackSignatureMock(...a),
}));

const sendSlackMessageMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/slackClient', () => ({
  sendSlackMessage: (...a: any[]) => sendSlackMessageMock(...a),
}));

jest.mock('../src/repoResolver', () => ({
  repoFullName: (name: string) => `your-org/${name}`,
}));

const executeApprovedTasksMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/auditOrchestrator', () => ({
  executeApprovedTasks: (...a: any[]) => executeApprovedTasksMock(...a),
}));

const stopAllTasksForRepoMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/auditDb', () => ({
  stopAllTasksForRepo: (...a: any[]) => stopAllTasksForRepoMock(...a),
}));

import { handleSlackInteraction } from '../src/slackInteractions';

function mockRes() {
  const res: any = { statusCode: null, body: null };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (obj: any) => { res.body = obj; return res; };
  res.send = (obj: any) => { res.body = obj; return res; };
  return res;
}

function interactionReq(actions: any[]) {
  return { headers: {}, body: { payload: JSON.stringify({ actions }) } };
}

describe('handleSlackInteraction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verifySlackSignatureMock.mockReturnValue(true);
  });

  it('rejects with 401 on an invalid signature, never touching any handler', async () => {
    verifySlackSignatureMock.mockReturnValue(false);
    const res = mockRes();
    await handleSlackInteraction(interactionReq([{ action_id: 'execute', value: 'costpilot' }]), res);
    expect(res.statusCode).toBe(401);
    expect(executeApprovedTasksMock).not.toHaveBeenCalled();
  });

  it('execute button triggers executeApprovedTasks with the repo from the button value', async () => {
    const res = mockRes();
    await handleSlackInteraction(interactionReq([{ action_id: 'execute', value: 'costpilot' }]), res);
    expect(res.statusCode).toBe(200);
    expect(executeApprovedTasksMock).toHaveBeenCalledWith('your-org/costpilot', 'costpilot', null);
    expect(sendSlackMessageMock).toHaveBeenCalledWith(expect.stringContaining('costpilot'), 'costpilot', null);
  });

  it('skip button triggers stopAllTasksForRepo with the repo from the button value', async () => {
    const res = mockRes();
    await handleSlackInteraction(interactionReq([{ action_id: 'skip', value: 'costpilot' }]), res);
    expect(stopAllTasksForRepoMock).toHaveBeenCalledWith('your-org/costpilot');
    expect(executeApprovedTasksMock).not.toHaveBeenCalled();
  });

  it('ignores an unrecognized action_id without throwing', async () => {
    const res = mockRes();
    await expect(
      handleSlackInteraction(interactionReq([{ action_id: 'mystery', value: 'costpilot' }]), res)
    ).resolves.toBeUndefined();
    expect(executeApprovedTasksMock).not.toHaveBeenCalled();
    expect(stopAllTasksForRepoMock).not.toHaveBeenCalled();
  });

  it('ignores a button with no value (no repo to act on) without throwing', async () => {
    const res = mockRes();
    await expect(
      handleSlackInteraction(interactionReq([{ action_id: 'execute', value: undefined }]), res)
    ).resolves.toBeUndefined();
    expect(executeApprovedTasksMock).not.toHaveBeenCalled();
  });

  it('does not throw on malformed payload JSON', async () => {
    const res = mockRes();
    const req = { headers: {}, body: { payload: '{not json' } };
    await expect(handleSlackInteraction(req, res)).resolves.toBeUndefined();
  });

  it('does not throw when the payload has no actions at all', async () => {
    const res = mockRes();
    await expect(handleSlackInteraction(interactionReq([]), res)).resolves.toBeUndefined();
  });
});
