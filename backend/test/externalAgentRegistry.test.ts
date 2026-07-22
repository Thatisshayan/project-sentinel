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
  recordAgentReply,
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

  it('mentions the agent in Slack, records a dispatch row, and returns the message ts', async () => {
    queryMock.mockResolvedValue({
      rows: [{ id: 'kilo', display_name: 'Kilo', slack_mention: '@Kilo', role: 'worker', enabled: true }],
    });
    sendSlackMessageMock.mockResolvedValue({ ok: true, ts: '123.456', channel: 'C1' });

    const result = await dispatchToAgent('kilo', 'fix the flaky test in auth.ts', 'costpilot');

    expect(sendSlackMessageMock).toHaveBeenCalledWith('@Kilo fix the flaky test in auth.ts', 'costpilot', null);
    expect(result).toEqual({ ts: '123.456' });
    const insertCall = queryMock.mock.calls.find(c => String(c[0]).includes('INSERT INTO agent_dispatches'));
    expect(insertCall[1]).toEqual(['kilo', 'costpilot', 'fix the flaky test in auth.ts', 'C1', '123.456']);
  });

  it('resolves null when Slack succeeds but returns no channel (cannot record a dispatch row)', async () => {
    queryMock.mockResolvedValue({
      rows: [{ id: 'kilo', display_name: 'Kilo', slack_mention: '@Kilo', role: 'worker', enabled: true }],
    });
    sendSlackMessageMock.mockResolvedValue({ ok: true, ts: '123.456' }); // no channel field
    const result = await dispatchToAgent('kilo', 'task', 'costpilot');
    expect(result).toBeNull();
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

describe('externalAgentRegistry — recordAgentReply', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marks a pending dispatch as replied and returns true when the channel+ts matches', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 1, agent_id: 'kilo', repo_name: 'costpilot' }] });
    const matched = await recordAgentReply('C1', '123.456', 'Done, opened PR #42');
    expect(matched).toBe(true);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("status = 'replied'"),
      ['C1', '123.456', 'Done, opened PR #42']
    );
  });

  it('returns false (not an error) when nothing pending matches the thread', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const matched = await recordAgentReply('C1', 'not-a-real-ts', 'hello');
    expect(matched).toBe(false);
  });
});
