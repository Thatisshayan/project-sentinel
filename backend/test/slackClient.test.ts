const queryMock = jest.fn();
jest.mock('../src/dbClient', () => ({ query: (...a: any[]) => queryMock(...a) }));

const httpsRequestMock = jest.fn();
jest.mock('https', () => ({ request: (...a: any[]) => httpsRequestMock(...a) }));

import { sendSlackMessage, sendSlackButtons, getSlackChannelId, upsertSlackChannel, createChannelForRepo } from '../src/slackClient';

/** Builds a fake https.request()/response pair that immediately "completes" with the given JSON body. */
function mockHttpsResponse(jsonBody: any) {
  httpsRequestMock.mockImplementation((_options: any, callback: any) => {
    const res = {
      on: (event: string, handler: any) => {
        if (event === 'data') handler(JSON.stringify(jsonBody));
        if (event === 'end') handler();
      },
    };
    callback(res);
    return { on: jest.fn(), setTimeout: jest.fn(), write: jest.fn(), end: jest.fn(), destroy: jest.fn() };
  });
}

describe('slackClient — safe-by-default when unconfigured', () => {
  const originalToken = process.env.SLACK_BOT_TOKEN;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SLACK_BOT_TOKEN;
  });
  afterAll(() => {
    if (originalToken) process.env.SLACK_BOT_TOKEN = originalToken;
  });

  it('is a no-op and does not throw when SLACK_BOT_TOKEN is unset', async () => {
    const result = await sendSlackMessage('hello', 'costpilot', null);
    expect(result).toBeNull();
    expect(queryMock).not.toHaveBeenCalled(); // never even looks up a channel
  });

  it('is a no-op when SLACK_BOT_TOKEN is set but no channel is mapped for the repo', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    queryMock.mockResolvedValue({ rows: [] });

    const result = await sendSlackMessage('hello', 'costpilot', null);
    expect(result).toBeNull();
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('SELECT channel_id'), ['costpilot']);
  });

  it('is a no-op when repoName is null (no lookup possible)', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    const result = await sendSlackMessage('hello', null, null);
    expect(result).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('does not throw if the channel lookup query itself fails', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
    queryMock.mockRejectedValue(new Error('db down'));
    await expect(sendSlackMessage('hello', 'costpilot', null)).resolves.toBeNull();
  });
});

describe('slackClient — createChannelForRepo', () => {
  const originalToken = process.env.SLACK_BOT_TOKEN;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  });
  afterAll(() => {
    if (originalToken) process.env.SLACK_BOT_TOKEN = originalToken;
    else delete process.env.SLACK_BOT_TOKEN;
  });

  it('returns null without calling Slack when unconfigured', async () => {
    delete process.env.SLACK_BOT_TOKEN;
    const id = await createChannelForRepo('costpilot');
    expect(id).toBeNull();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('creates the channel, persists the mapping, and returns its id on success', async () => {
    mockHttpsResponse({ ok: true, channel: { id: 'C111' } });
    queryMock.mockResolvedValue({ rows: [] });

    const id = await createChannelForRepo('CostPilot');

    expect(id).toBe('C111');
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT'), ['costpilot', 'C111']);
  });

  it('looks up and reuses the existing channel id when the name is already taken', async () => {
    // conversations.create retries (transient-failure handling in
    // retryWithBackoff) before the name_taken error finally propagates, so
    // the mock must branch on which endpoint is being called, not on call
    // count — a naive call-count-based mock would misattribute retries of
    // conversations.create to the conversations.list follow-up call.
    httpsRequestMock.mockImplementation((options: any, callback: any) => {
      const body = options.path.includes('conversations.create')
        ? { ok: false, error: 'name_taken' }
        : { ok: true, channels: [{ name: 'costpilot', id: 'C222' }] };
      const res = { on: (event: string, handler: any) => {
        if (event === 'data') handler(JSON.stringify(body));
        if (event === 'end') handler();
      } };
      callback(res);
      return { on: jest.fn(), setTimeout: jest.fn(), write: jest.fn(), end: jest.fn(), destroy: jest.fn() };
    });
    queryMock.mockResolvedValue({ rows: [] });

    const id = await createChannelForRepo('costpilot');
    expect(id).toBe('C222');
  }, 10000);

  it('resolves null (does not throw) on an unrecognized Slack error', async () => {
    mockHttpsResponse({ ok: false, error: 'invalid_auth' });
    await expect(createChannelForRepo('costpilot')).resolves.toBeNull();
  });
});

describe('slackClient — sendSlackButtons', () => {
  const originalToken = process.env.SLACK_BOT_TOKEN;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  });
  afterAll(() => {
    if (originalToken) process.env.SLACK_BOT_TOKEN = originalToken;
    else delete process.env.SLACK_BOT_TOKEN;
  });

  it('is a no-op when unconfigured', async () => {
    delete process.env.SLACK_BOT_TOKEN;
    const result = await sendSlackButtons('text', 'costpilot', [[{ text: 'Go', actionId: 'execute', value: 'costpilot' }]]);
    expect(result).toBeNull();
  });

  it('is a no-op when no channel is mapped for the repo', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const result = await sendSlackButtons('text', 'costpilot', [[{ text: 'Go', actionId: 'execute', value: 'costpilot' }]]);
    expect(result).toBeNull();
  });

  it('sends a chat.postMessage request with an actions block built from the button grid', async () => {
    queryMock.mockResolvedValue({ rows: [{ channel_id: 'C1' }] });
    mockHttpsResponse({ ok: true });

    await sendSlackButtons('Audit complete', 'costpilot', [
      [
        { text: '✅ Execute', actionId: 'execute', value: 'costpilot' },
        { text: '⏭ Skip', actionId: 'skip', value: 'costpilot' },
      ],
    ]);

    expect(httpsRequestMock).toHaveBeenCalled();
    const writeCall = (httpsRequestMock.mock.results[0].value as any).write.mock.calls[0][0];
    const sentBody = JSON.parse(writeCall);
    expect(sentBody.channel).toBe('C1');
    expect(sentBody.blocks[1].elements).toHaveLength(2);
    expect(sentBody.blocks[1].elements[0]).toMatchObject({ action_id: 'execute', value: 'costpilot' });
  });
});

describe('slackClient — channel mapping helpers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getSlackChannelId lowercases the repo name before querying', async () => {
    queryMock.mockResolvedValue({ rows: [{ channel_id: 'C123' }] });
    const id = await getSlackChannelId('CostPilot');
    expect(id).toBe('C123');
    expect(queryMock).toHaveBeenCalledWith(expect.any(String), ['costpilot']);
  });

  it('upsertSlackChannel issues an ON CONFLICT upsert', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await upsertSlackChannel('CostPilot', 'C456');
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      ['costpilot', 'C456']
    );
  });
});
