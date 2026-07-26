const queryMock = jest.fn();
jest.mock('../src/dbClient', () => ({ query: (...a: any[]) => queryMock(...a) }));

const sendSlackMessageMock = jest.fn();
jest.mock('../src/slackClient', () => ({
  sendSlackMessage: (...a: any[]) => sendSlackMessageMock(...a),
}));

const listExternalAgentsMock = jest.fn();
jest.mock('../src/agents/externalAgentRegistry', () => ({
  listExternalAgents: (...a: any[]) => listExternalAgentsMock(...a),
}));

const enqueueScheduledJobMock = jest.fn().mockResolvedValue(undefined);
const cancelScheduledJobMock  = jest.fn().mockResolvedValue(true);
jest.mock('../src/queueClient', () => ({
  enqueueScheduledJob: (...a: any[]) => enqueueScheduledJobMock(...a),
  cancelScheduledJob:  (...a: any[]) => cancelScheduledJobMock(...a),
}));

jest.mock('../src/workers/scheduledJobsWorker', () => ({
  ROUNDTABLE_TIMEOUT_JOB: 'roundtable-timeout',
}));

const axiosPostMock = jest.fn();
jest.mock('axios', () => ({ post: (...a: any[]) => axiosPostMock(...a) }));

import {
  initRoundtableSchema,
  startRoundtable,
  recordRoundtableReply,
  runRoundtableSynthesis,
} from '../src/agents/roundtable';

const ROSTER = [
  { id: 'kilo',  displayName: 'Kilo',  slackMention: '@kilo',  role: 'worker',   enabled: true },
  { id: 'manus', displayName: 'Manus', slackMention: '@manus', role: 'worker',   enabled: true },
  { id: 'viktor', displayName: 'Viktor', slackMention: '@viktor', role: 'authority', enabled: true },
];

describe('roundtable — schema init', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates roundtable_sessions and a unique channel+ts index', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await initRoundtableSchema();
    expect(queryMock.mock.calls.some(c => String(c[0]).includes('CREATE TABLE IF NOT EXISTS roundtable_sessions'))).toBe(true);
    expect(queryMock.mock.calls.some(c => String(c[0]).includes('idx_roundtable_channel_ts'))).toBe(true);
  });
});

describe('roundtable — startRoundtable', () => {
  beforeEach(() => jest.clearAllMocks());

  it('defaults to all enabled worker agents when agentIds is omitted, posts one mention message, records a session, and schedules the timeout', async () => {
    listExternalAgentsMock.mockResolvedValue(ROSTER);
    sendSlackMessageMock.mockResolvedValue({ ok: true, ts: '111.222', channel: 'C1' });
    queryMock.mockResolvedValue({ rows: [{ id: 9 }] });

    const result = await startRoundtable('costpilot', 'how should we approach the auth refactor?');

    expect(result).toEqual({ ok: true, sessionId: 9 });
    expect(sendSlackMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('@kilo @manus'),
      'costpilot',
      null
    );
    const insertCall = queryMock.mock.calls.find(c => String(c[0]).includes('INSERT INTO roundtable_sessions'));
    expect(insertCall[1]).toEqual(['costpilot', 'how should we approach the auth refactor?', ['kilo', 'manus'], 'C1', '111.222']);
    expect(enqueueScheduledJobMock).toHaveBeenCalledWith(
      'roundtable-timeout',
      { sessionId: 9 },
      5 * 60 * 1000,
      'roundtable-timeout:9'
    );
  });

  it('uses an explicit agentIds list when given, instead of defaulting', async () => {
    listExternalAgentsMock.mockResolvedValue(ROSTER);
    sendSlackMessageMock.mockResolvedValue({ ok: true, ts: '1', channel: 'C1' });
    queryMock.mockResolvedValue({ rows: [{ id: 1 }] });

    await startRoundtable('costpilot', 'question', ['viktor']);

    expect(sendSlackMessageMock).toHaveBeenCalledWith(expect.stringContaining('@viktor'), 'costpilot', null);
  });

  it('fails with a reason when there are no enabled worker agents and none were given', async () => {
    listExternalAgentsMock.mockResolvedValue([]);
    const result = await startRoundtable('costpilot', 'question');
    expect(result.ok).toBe(false);
    expect(sendSlackMessageMock).not.toHaveBeenCalled();
  });

  it('fails with a reason when Slack delivery does not produce a ts/channel (e.g. unconfigured)', async () => {
    listExternalAgentsMock.mockResolvedValue(ROSTER);
    sendSlackMessageMock.mockResolvedValue(null);
    const result = await startRoundtable('costpilot', 'question');
    expect(result.ok).toBe(false);
    expect(enqueueScheduledJobMock).not.toHaveBeenCalled();
  });
});

describe('roundtable — recordRoundtableReply', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns false (no-op) when no pending session matches the thread', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const matched = await recordRoundtableReply('C1', 'not-a-real-ts', { text: 'hello' });
    expect(matched).toBe(false);
  });

  it('appends a reply and does not yet synthesize when fewer replies than agents_asked', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 9, agents_asked: ['kilo', 'manus'], agents_responded: [] }] }) // SELECT
      .mockResolvedValueOnce({ rows: [{ agents_responded: [{ hint: 'kilo', text: 'I think X', responded_at: '2026-01-01T00:00:00.000Z' }] }] }); // UPDATE ... RETURNING

    const matched = await recordRoundtableReply('C1', '111.222', { text: 'I think X', username: 'kilo' });

    expect(matched).toBe(true);
    const updateCall = queryMock.mock.calls.find(c => String(c[0]).includes('agents_responded = agents_responded ||'));
    const appendedReply = JSON.parse(updateCall[1][1]);
    expect(appendedReply).toEqual([{ hint: 'kilo', text: 'I think X', responded_at: expect.any(String) }]);
    expect(cancelScheduledJobMock).not.toHaveBeenCalled();
  });

  it('appends via an atomic jsonb UPDATE, not a read-modify-write of the full array — guards against the lost-reply race', async () => {
    // A pre-existing reply from another agent must already be in the row;
    // the fix must not require reading it into JS to preserve it — the
    // UPDATE's own `agents_responded || $2::jsonb` does that atomically.
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 9, agents_asked: ['kilo', 'manus'], agents_responded: [{ hint: 'manus', text: 'earlier reply', responded_at: 'x' }] }] }) // SELECT
      .mockResolvedValueOnce({ rows: [{ agents_responded: [
        { hint: 'manus', text: 'earlier reply', responded_at: 'x' },
        { hint: 'kilo', text: 'I think X', responded_at: '2026-01-01T00:00:00.000Z' },
      ] }] }); // UPDATE ... RETURNING reflects both replies, not just this one

    await recordRoundtableReply('C1', '111.222', { text: 'I think X', username: 'kilo' });

    const updateCall = queryMock.mock.calls.find(c => String(c[0]).includes('agents_responded = agents_responded ||'));
    expect(String(updateCall[0])).toContain('agents_responded || $2::jsonb');
    // Only the new reply is sent as a param — never the full previously-read array.
    expect(JSON.parse(updateCall[1][1])).toEqual([{ hint: 'kilo', text: 'I think X', responded_at: expect.any(String) }]);
  });

  it('triggers synthesis and cancels the timeout once replies reach agents_asked count', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 9, agents_asked: ['kilo'], agents_responded: [] }] }) // SELECT in recordRoundtableReply
      .mockResolvedValueOnce({ rows: [{ agents_responded: [{ hint: 'kilo', text: 'reply', responded_at: 'x' }] }] }) // UPDATE agents_responded ... RETURNING
      // runRoundtableSynthesis's atomic claim UPDATE — conditional on
      // status='pending', so the row only returns for the one caller that
      // wins the race. Mirrors what a real conditional UPDATE would return.
      .mockResolvedValueOnce({ rows: [{ id: 9, question: 'q', agents_asked: ['kilo'], agents_responded: [{ hint: 'kilo', text: 'reply', responded_at: 'x' }], repo_name: 'costpilot', thread_ts: '111.222' }] })
      .mockResolvedValue({ rows: [] }); // UPDATE ... status='complete'

    axiosPostMock.mockResolvedValue({ data: { choices: [{ message: { content: 'synthesis text' } }] } });
    process.env['NVIDIA_API_KEY'] = 'test-key';
    sendSlackMessageMock.mockResolvedValue({ ok: true, ts: '999', channel: 'C1' });

    const matched = await recordRoundtableReply('C1', '111.222', { text: 'reply', username: 'kilo' });

    expect(matched).toBe(true);
    expect(cancelScheduledJobMock).toHaveBeenCalledWith('roundtable-timeout:9');
    expect(sendSlackMessageMock).toHaveBeenCalledWith(expect.stringContaining('synthesis text'), 'costpilot', '111.222');
    delete process.env['NVIDIA_API_KEY'];
  });
});

describe('roundtable — runRoundtableSynthesis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['NVIDIA_API_KEY'] = 'test-key';
  });
  afterEach(() => { delete process.env['NVIDIA_API_KEY']; });

  it('is idempotent — the conditional claim UPDATE matches zero rows for a session already complete (or not pending), so the function returns early without calling the LLM or posting', async () => {
    queryMock.mockResolvedValue({ rows: [] }); // session already 'complete' — the conditional UPDATE to set status='synthesizing' WHERE status='pending' matches zero rows, so the function returns early
    await runRoundtableSynthesis(1);
    expect(axiosPostMock).not.toHaveBeenCalled();
    expect(sendSlackMessageMock).not.toHaveBeenCalled();
  });

  it('logs and does nothing for an unknown session id (claim matches zero rows)', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await expect(runRoundtableSynthesis(999)).resolves.toBeUndefined();
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it('falls back to a raw-replies message when every provider fails', async () => {
    queryMock.mockResolvedValue({
      rows: [{
        id: 2, status: 'pending', question: 'q', agents_asked: ['kilo', 'manus'],
        agents_responded: [{ hint: 'kilo', text: 'reply', responded_at: 'x' }],
        repo_name: 'costpilot', thread_ts: '111.222',
      }],
    });
    axiosPostMock.mockRejectedValue(new Error('provider down'));
    sendSlackMessageMock.mockResolvedValue({ ok: true });

    await runRoundtableSynthesis(2);

    expect(sendSlackMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('Could not generate a synthesis'),
      'costpilot', '111.222'
    );
  });

  it('marks the session complete with the synthesis text on success', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: 3, status: 'pending', question: 'q', agents_asked: ['kilo'],
        agents_responded: [{ hint: 'kilo', text: 'reply', responded_at: 'x' }],
        repo_name: 'costpilot', thread_ts: '111.222',
      }],
    }).mockResolvedValueOnce({ rows: [] }); // the completion UPDATE

    axiosPostMock.mockResolvedValue({ data: { choices: [{ message: { content: 'agreement/disagreement/plan' } }] } });
    sendSlackMessageMock.mockResolvedValue({ ok: true });

    await runRoundtableSynthesis(3);

    const updateCall = queryMock.mock.calls.find(c => String(c[0]).includes("status = 'complete'"));
    expect(updateCall[1]).toEqual([3, 'agreement/disagreement/plan']);
  });

  it('does not double-call callSynthesisLLM when two concurrent runRoundtableSynthesis invocations race — the conditional UPDATE claim ensures only one proceeds', async () => {
    // First caller's claim-WHERE-pending UPDATE sees the row and proceeds.
    // Second caller's claim-WHERE-pending UPDATE sees zero rows (already
    // moved to 'synthesizing' by the first) and returns early. This
    // regression-fences M-2: without the atomic claim, both read
    // status='pending', both call the LLM, both post Slack synthesis.
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 7, question: 'q', agents_asked: ['kilo'], agents_responded: [{ hint: 'kilo', text: 'reply', responded_at: 'x' }], repo_name: 'costpilot', thread_ts: '1.2' }] })
      .mockResolvedValueOnce({ rows: [] }); // second concurrent claim UPDATE sees 0 rows
    axiosPostMock.mockResolvedValue({ data: { choices: [{ message: { content: 'synthesis' } }] } });
    sendSlackMessageMock.mockResolvedValue({ ok: true });

    const [a, b] = await Promise.all([runRoundtableSynthesis(7), runRoundtableSynthesis(7)]);

    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
    // Exactly one claim UPDATE proceeded — exactly one LLM call.
    expect(axiosPostMock).toHaveBeenCalledTimes(1);
    // Exactly one synthesis Slack post.
    expect(sendSlackMessageMock).toHaveBeenCalledTimes(1);
  });
});
