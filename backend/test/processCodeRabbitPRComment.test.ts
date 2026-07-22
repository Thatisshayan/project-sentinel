const sendTelegramMessageMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: (...a: any[]) => sendTelegramMessageMock(...a),
}));

const getAuditCycleMock       = jest.fn();
const createAuditCycleMock    = jest.fn();
const createAuditTaskMock     = jest.fn().mockResolvedValue({ id: 1 });
const getQueuedTaskCountMock  = jest.fn().mockResolvedValue(0);
jest.mock('../src/auditDb', () => ({
  getAuditCycle: (...a: any[]) => getAuditCycleMock(...a),
  createAuditCycle: (...a: any[]) => createAuditCycleMock(...a),
  createAuditTask: (...a: any[]) => createAuditTaskMock(...a),
  getQueuedTaskCount: (...a: any[]) => getQueuedTaskCountMock(...a),
}));

import { processCodeRabbitPRComment, isFromCodeRabbit, CODERABBIT_BOT_LOGIN } from '../src/webhook/processCodeRabbitPRComment';

describe('isFromCodeRabbit', () => {
  it('matches the known CodeRabbit bot login', () => {
    expect(isFromCodeRabbit('coderabbitai[bot]')).toBe(true);
    expect(isFromCodeRabbit(CODERABBIT_BOT_LOGIN)).toBe(true);
  });
  it('is case-insensitive', () => {
    expect(isFromCodeRabbit('CodeRabbitAI[Bot]')).toBe(true);
  });
  it('rejects other authors', () => {
    expect(isFromCodeRabbit('some-human')).toBe(false);
    expect(isFromCodeRabbit('snyk-bot')).toBe(false);
    expect(isFromCodeRabbit(undefined)).toBe(false);
    expect(isFromCodeRabbit(null)).toBe(false);
  });
});

describe('processCodeRabbitPRComment', () => {
  beforeEach(() => jest.clearAllMocks());

  const basePayload = {
    comment: {
      user: { login: 'coderabbitai[bot]' },
      body: 'This function has a critical SQL injection risk.',
      path: 'src/db.ts',
      html_url: 'https://github.com/x/y/pull/1#comment-1',
    },
    pull_request: { number: 5, head: { sha: 'abc1234' }, html_url: 'https://github.com/x/y/pull/1' },
    repository: { full_name: 'thatisshayan/costpilot' },
  };

  it('ignores comments not authored by CodeRabbit', async () => {
    const payload = { ...basePayload, comment: { ...basePayload.comment, user: { login: 'a-human' } } };
    await processCodeRabbitPRComment(payload);
    expect(createAuditTaskMock).not.toHaveBeenCalled();
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it('creates a new audit cycle when none exists yet for this commit', async () => {
    getAuditCycleMock.mockResolvedValue(null);
    createAuditCycleMock.mockResolvedValue({ id: 99 });

    await processCodeRabbitPRComment(basePayload);

    expect(createAuditCycleMock).toHaveBeenCalledWith(
      expect.objectContaining({ repoFullName: 'thatisshayan/costpilot', commitSha: 'abc1234' })
    );
    expect(createAuditTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        auditCycleId: 99,
        source: 'coderabbit',
        priority: 'critical',
        affectedFiles: ['src/db.ts'],
        safeToAutoExecute: false,
      })
    );
  });

  it('reuses an existing audit cycle for the same commit instead of creating a new one', async () => {
    getAuditCycleMock.mockResolvedValue({ id: 42 });

    await processCodeRabbitPRComment(basePayload);

    expect(createAuditCycleMock).not.toHaveBeenCalled();
    expect(createAuditTaskMock).toHaveBeenCalledWith(expect.objectContaining({ auditCycleId: 42 }));
  });

  it('sends a Slack/Telegram notification with the repoName (not null) for Slack fan-out', async () => {
    getAuditCycleMock.mockResolvedValue({ id: 42 });
    await processCodeRabbitPRComment(basePayload);
    const [message, repoName] = sendTelegramMessageMock.mock.calls[0];
    expect(repoName).toBe('costpilot');
    expect(message).toContain('costpilot');
    expect(message).toContain('#5');
  });

  it('infers severity from comment text (medium default, low for nitpicks)', async () => {
    getAuditCycleMock.mockResolvedValue({ id: 1 });
    await processCodeRabbitPRComment({
      ...basePayload,
      comment: { ...basePayload.comment, body: 'nit: rename this variable' },
    });
    expect(createAuditTaskMock).toHaveBeenCalledWith(expect.objectContaining({ priority: 'low' }));
  });

  it('does not throw when the payload is missing required fields', async () => {
    await expect(processCodeRabbitPRComment({})).resolves.toBeUndefined();
    expect(createAuditTaskMock).not.toHaveBeenCalled();
  });

  it('does not throw when both cycle lookup and creation fail', async () => {
    getAuditCycleMock.mockRejectedValue(new Error('db down'));
    createAuditCycleMock.mockRejectedValue(new Error('db down'));
    await expect(processCodeRabbitPRComment(basePayload)).resolves.toBeUndefined();
    expect(createAuditTaskMock).not.toHaveBeenCalled();
  });
});
