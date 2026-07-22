import crypto from 'crypto';

const loggerMock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
// The factory must not reference loggerMock directly (jest.mock() factories
// are hoisted above const declarations, so that threw a TDZ ReferenceError)
// — deferring the lookup inside each method closure avoids it, same
// resolution as the dispatchCommandMock/recordAgentReplyMock pattern below.
jest.mock('../src/logger', () => ({
  info:  (...a: any[]) => loggerMock.info(...a),
  warn:  (...a: any[]) => loggerMock.warn(...a),
  error: (...a: any[]) => loggerMock.error(...a),
  debug: (...a: any[]) => loggerMock.debug(...a),
}));

const dispatchCommandMock = jest.fn();
jest.mock('../src/commandRegistry', () => ({
  dispatchCommand: (...a: any[]) => dispatchCommandMock(...a),
}));

const recordAgentReplyMock = jest.fn().mockResolvedValue(false);
jest.mock('../src/agents/externalAgentRegistry', () => ({
  recordAgentReply: (...a: any[]) => recordAgentReplyMock(...a),
}));

import { handleSlackEvent, verifySlackSignature, stripBotMention } from '../src/slackEvents';

function signedRequest(bodyObj: any, opts: { secret?: string; badSig?: boolean; staleTimestamp?: boolean } = {}) {
  const secret = opts.secret ?? 'test-signing-secret';
  const rawBody = Buffer.from(JSON.stringify(bodyObj));
  const timestamp = opts.staleTimestamp
    ? String(Math.floor(Date.now() / 1000) - 60 * 10) // 10 minutes old — outside the 5-minute window
    : String(Math.floor(Date.now() / 1000));
  const baseString = `v0:${timestamp}:${rawBody.toString()}`;
  const validSig = 'v0=' + crypto.createHmac('sha256', secret).update(baseString).digest('hex');

  return {
    headers: {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': opts.badSig ? 'v0=deadbeef' : validSig,
    },
    rawBody,
    body: bodyObj,
  };
}

function mockRes() {
  const res: any = { statusCode: null, body: null };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (obj: any) => { res.body = obj; return res; };
  return res;
}

describe('stripBotMention', () => {
  it('removes a leading <@BOTID> mention with a following space', () => {
    expect(stripBotMention('<@U0LAN0Z89> audit costpilot')).toBe('audit costpilot');
  });

  it('removes a leading mention followed by punctuation', () => {
    expect(stripBotMention('<@U0LAN0Z89>: audit costpilot')).toBe('audit costpilot');
  });

  it('leaves text unchanged when there is no leading mention', () => {
    expect(stripBotMention('audit costpilot')).toBe('audit costpilot');
  });
});

describe('verifySlackSignature', () => {
  const originalSecret = process.env.SLACK_SIGNING_SECRET;
  beforeEach(() => { process.env.SLACK_SIGNING_SECRET = 'test-signing-secret'; });
  afterAll(() => {
    if (originalSecret) process.env.SLACK_SIGNING_SECRET = originalSecret;
    else delete process.env.SLACK_SIGNING_SECRET;
  });

  it('accepts a correctly signed request', () => {
    const req = signedRequest({ type: 'event_callback' });
    expect(verifySlackSignature(req)).toBe(true);
  });

  it('rejects a request with an invalid signature', () => {
    const req = signedRequest({ type: 'event_callback' }, { badSig: true });
    expect(verifySlackSignature(req)).toBe(false);
  });

  it('rejects a request with a stale timestamp (replay protection)', () => {
    const req = signedRequest({ type: 'event_callback' }, { staleTimestamp: true });
    expect(verifySlackSignature(req)).toBe(false);
  });

  it('rejects when SLACK_SIGNING_SECRET is not configured', () => {
    delete process.env.SLACK_SIGNING_SECRET;
    const req = signedRequest({ type: 'event_callback' });
    expect(verifySlackSignature(req)).toBe(false);
  });

  it('rejects when signature headers are missing entirely', () => {
    expect(verifySlackSignature({ headers: {}, body: {} })).toBe(false);
  });

  it('logs a warning (not silently) when signature headers are missing entirely', () => {
    loggerMock.warn.mockClear();
    verifySlackSignature({ headers: {}, body: {} });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ hasTimestamp: false, hasSignature: false }),
      expect.stringContaining('missing required signature headers')
    );
  });

  it('logs a warning (not silently) when the signature itself does not match', () => {
    loggerMock.warn.mockClear();
    const req = signedRequest({ type: 'event_callback' }, { badSig: true });
    verifySlackSignature(req);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sigLengthMatch: expect.any(Boolean) }),
      expect.stringContaining('signature verification failed')
    );
  });
});

describe('handleSlackEvent', () => {
  const originalSecret = process.env.SLACK_SIGNING_SECRET;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';
  });
  afterAll(() => {
    if (originalSecret) process.env.SLACK_SIGNING_SECRET = originalSecret;
    else delete process.env.SLACK_SIGNING_SECRET;
  });

  it('logs an unconditional "request received" line before any signature/type check — so a silent stretch in prod logs can never mean "maybe something arrived and was silently dropped"', async () => {
    loggerMock.info.mockClear();
    const req = { headers: {}, body: { type: 'event_callback', event: { type: 'app_mention' } } };
    const res = mockRes();
    await handleSlackEvent(req, res);
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'event_callback', hasEvent: true, eventSubtype: 'app_mention' }),
      'Slack webhook request received'
    );
  });

  it('answers the url_verification handshake without requiring a valid signature', async () => {
    const req = { headers: {}, body: { type: 'url_verification', challenge: 'abc123' } };
    const res = mockRes();
    await handleSlackEvent(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ challenge: 'abc123' });
    expect(dispatchCommandMock).not.toHaveBeenCalled();
  });

  it('rejects an event with an invalid signature (401), never reaching dispatch', async () => {
    const req = signedRequest({ type: 'event_callback', event: { type: 'app_mention', text: 'audit x', channel: 'C1' } }, { badSig: true });
    const res = mockRes();
    await handleSlackEvent(req, res);
    expect(res.statusCode).toBe(401);
    expect(dispatchCommandMock).not.toHaveBeenCalled();
  });

  it('dispatches the mention text (mention stripped) for a valid app_mention event', async () => {
    dispatchCommandMock.mockResolvedValue(true);
    const req = signedRequest({
      type: 'event_callback',
      event: { type: 'app_mention', text: '<@U0BOT> audit costpilot', channel: 'C1' },
    });
    const res = mockRes();
    await handleSlackEvent(req, res);

    expect(res.statusCode).toBe(200);
    expect(dispatchCommandMock).toHaveBeenCalledWith('audit costpilot', null, null);
  });

  it('does not dispatch for non-mention event types', async () => {
    const req = signedRequest({
      type: 'event_callback',
      event: { type: 'message', text: 'hello', channel: 'C1' },
    });
    const res = mockRes();
    await handleSlackEvent(req, res);
    expect(dispatchCommandMock).not.toHaveBeenCalled();
  });

  it('does not throw when dispatchCommand itself rejects', async () => {
    dispatchCommandMock.mockRejectedValue(new Error('boom'));
    const req = signedRequest({
      type: 'event_callback',
      event: { type: 'app_mention', text: '<@U0BOT> audit costpilot', channel: 'C1' },
    });
    const res = mockRes();
    await expect(handleSlackEvent(req, res)).resolves.toBeUndefined();
  });

  it('routes a threaded message event to recordAgentReply (Phase 4 reply correlation)', async () => {
    const req = signedRequest({
      type: 'event_callback',
      event: { type: 'message', text: 'Done, opened PR #42', channel: 'C1', thread_ts: '123.456' },
    });
    const res = mockRes();
    await handleSlackEvent(req, res);
    expect(recordAgentReplyMock).toHaveBeenCalledWith('C1', '123.456', 'Done, opened PR #42');
  });

  it('ignores a message event with no thread_ts (not a reply to anything)', async () => {
    const req = signedRequest({
      type: 'event_callback',
      event: { type: 'message', text: 'just chatting', channel: 'C1' },
    });
    const res = mockRes();
    await handleSlackEvent(req, res);
    expect(recordAgentReplyMock).not.toHaveBeenCalled();
  });

  it('does not throw when recordAgentReply itself rejects', async () => {
    recordAgentReplyMock.mockRejectedValue(new Error('db down'));
    const req = signedRequest({
      type: 'event_callback',
      event: { type: 'message', text: 'reply', channel: 'C1', thread_ts: '123.456' },
    });
    const res = mockRes();
    await expect(handleSlackEvent(req, res)).resolves.toBeUndefined();
  });
});
