process.env.SENTINEL_UI_KEY = '';

// M-5 regression guard: the dashboard POST /api/command route must NOT pass a
// literal `null` for chatId to handleCommand — that previously became the
// string "null" reaching Telegram. The route must pass 0 (impossible chat_id).
// We mock agentDb.logAgentMessage and telegramCommands.handleCommand and
// assert the exact call signature. Kept in a separate file to avoid leaking
// these module mocks into api.test.js's portfolio/auth suites.

jest.mock('../src/dbClient', () => ({
  query: jest.fn(),
}));

jest.mock('../src/agentDb', () => ({
  logAgentMessage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/telegramCommands', () => ({
  handleCommand: jest.fn().mockResolvedValue(true),
}));

const { logAgentMessage } = require('../src/agentDb');
const { handleCommand }     = require('../src/telegramCommands');
const request = require('supertest');
const express = require('express');
const apiRouter = require('../src/api');

const app = express();
app.use(express.json());
app.use('/api', apiRouter);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/command — chatId contract (M-5)', () => {
  it('passes chatId=0 (never null) to handleCommand', async () => {
    const res = await request(app)
      .post('/api/command')
      .send({ text: '/start', fromName: 'Shayan' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(handleCommand).toHaveBeenCalledTimes(1);
    const args = handleCommand.mock.calls[0];
    expect(args[0]).toBe('/start');        // text
    expect(args[1]).toBe(0);              // chatId — must NOT be null
    expect(args[1]).not.toBeNull();
    expect(args[2]).toBeNull();           // topicId
    expect(args[3]).toBe('Shayan');       // fromName
    expect(args[4]).toBeNull();           // message
  });

  it('defaults fromName to "Dashboard" when omitted', async () => {
    const res = await request(app)
      .post('/api/command')
      .send({ text: 'hello world' });

    expect(res.status).toBe(200);
    expect(handleCommand.mock.calls[0][3]).toBe('Dashboard');
    expect(handleCommand.mock.calls[0][1]).toBe(0);
  });

  it('returns 400 when text is missing', async () => {
    const res = await request(app)
      .post('/api/command')
      .send({ fromName: 'Shayan' });

    expect(res.status).toBe(400);
    expect(handleCommand).not.toHaveBeenCalled();
  });

  it('returns 400 when text is not a string', async () => {
    const res = await request(app)
      .post('/api/command')
      .send({ text: 123 });

    expect(res.status).toBe(400);
    expect(handleCommand).not.toHaveBeenCalled();
  });

  it('logs the user message to agent_messages before dispatching', async () => {
    await request(app)
      .post('/api/command')
      .send({ text: '/menu', fromName: 'Shayan' });

    expect(logAgentMessage).toHaveBeenCalledTimes(1);
    const logArgs = logAgentMessage.mock.calls[0];
    expect(logArgs[0]).toBe('dashboard_user');
    expect(logArgs[1]).toBe('Shayan');
    expect(logArgs[2]).toBe('/menu');
    expect(logArgs[3]).toBe('info');
    expect(logArgs[4]).toBeNull();
  });

  it('responds 200 even if handleCommand rejects (non-blocking fire)', async () => {
    handleCommand.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app)
      .post('/api/command')
      .send({ text: '/start' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
