const queryMock = jest.fn();
jest.mock('../src/dbClient', () => ({ query: (...a: any[]) => queryMock(...a) }));

import { sendSlackMessage, getSlackChannelId, upsertSlackChannel } from '../src/slackClient';

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
