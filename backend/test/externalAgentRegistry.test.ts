const queryMock = jest.fn();
jest.mock('../src/dbClient', () => ({ query: (...a: any[]) => queryMock(...a) }));

const sendSlackMessageMock = jest.fn();
jest.mock('../src/slackClient', () => ({
  sendSlackMessage: (...a: any[]) => sendSlackMessageMock(...a),
}));

import {
  initExternalAgentSchema,
  getExternalAgent,
  listExternalAgents,
  dispatchToAgent,
} from '../src/agents/externalAgentRegistry';

describe('externalAgentRegistry — schema init', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates the table and seeds all 5 confirmed roster agents idempotently', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await initExternalAgentSchema();

    const insertCalls = queryMock.mock.calls.filter(c => String(c[0]).includes('INSERT INTO external_agents'));
    expect(insertCalls).toHaveLength(5);
    const seededIds = insertCalls.map(c => c[1][0]);
    expect(seededIds.sort()).toEqual(['coderabbit', 'devin', 'kilo', 'manus', 'viktor']);
    // Idempotent — never overwrites an existing row (e.g. an operator's disable/rename)
    expect(insertCalls.every(c => String(c[0]).includes('ON CONFLICT (id) DO NOTHING'))).toBe(true);
  });
});

describe('externalAgentRegistry — lookups', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getExternalAgent maps a DB row to the ExternalAgent shape', async () => {
    queryMock.mockResolvedValue({
      rows: [{ id: 'kilo', display_name: 'Kilo', slack_mention: '@Kilo', role: 'worker', enabled: true }],
    });
    const agent = await getExternalAgent('kilo');
    expect(agent).toEqual({ id: 'kilo', displayName: 'Kilo', slackMention: '@Kilo', role: 'worker', enabled: true });
  });

  it('getExternalAgent returns null for an unknown id', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    expect(await getExternalAgent('nonexistent')).toBeNull();
  });

  it('listExternalAgents filters by enabledOnly when requested', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await listExternalAgents({ enabledOnly: true });
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('WHERE enabled = true'));
  });
});

describe('externalAgentRegistry — dispatchToAgent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mentions the agent in Slack and returns the message ts', async () => {
    queryMock.mockResolvedValue({
      rows: [{ id: 'kilo', display_name: 'Kilo', slack_mention: '@Kilo', role: 'worker', enabled: true }],
    });
    sendSlackMessageMock.mockResolvedValue({ ok: true, ts: '123.456' });

    const result = await dispatchToAgent('kilo', 'fix the flaky test in auth.ts', 'costpilot');

    expect(sendSlackMessageMock).toHaveBeenCalledWith('@Kilo fix the flaky test in auth.ts', 'costpilot', null);
    expect(result).toEqual({ ts: '123.456' });
  });

  it('returns null without calling Slack for an unknown agent id', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const result = await dispatchToAgent('nonexistent', 'task', 'costpilot');
    expect(result).toBeNull();
    expect(sendSlackMessageMock).not.toHaveBeenCalled();
  });

  it('returns null without calling Slack for a disabled agent', async () => {
    queryMock.mockResolvedValue({
      rows: [{ id: 'kilo', display_name: 'Kilo', slack_mention: '@Kilo', role: 'worker', enabled: false }],
    });
    const result = await dispatchToAgent('kilo', 'task', 'costpilot');
    expect(result).toBeNull();
    expect(sendSlackMessageMock).not.toHaveBeenCalled();
  });

  it('returns null (does not throw) when Slack delivery itself no-ops (e.g. unconfigured)', async () => {
    queryMock.mockResolvedValue({
      rows: [{ id: 'kilo', display_name: 'Kilo', slack_mention: '@Kilo', role: 'worker', enabled: true }],
    });
    sendSlackMessageMock.mockResolvedValue(null);
    const result = await dispatchToAgent('kilo', 'task', 'costpilot');
    expect(result).toBeNull();
  });

  it('returns null (does not throw) when the agent lookup itself fails', async () => {
    queryMock.mockRejectedValue(new Error('db down'));
    const result = await dispatchToAgent('kilo', 'task', 'costpilot');
    expect(result).toBeNull();
  });

  it('returns null (does not throw) when Slack delivery itself rejects', async () => {
    queryMock.mockResolvedValue({
      rows: [{ id: 'kilo', display_name: 'Kilo', slack_mention: '@Kilo', role: 'worker', enabled: true }],
    });
    sendSlackMessageMock.mockRejectedValue(new Error('slack down'));
    const result = await dispatchToAgent('kilo', 'task', 'costpilot');
    expect(result).toBeNull();
  });
});
