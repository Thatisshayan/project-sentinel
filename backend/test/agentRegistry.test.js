jest.mock('../src/dbClient', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
}));

const { query } = require('../src/dbClient');

describe('markAgentError', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is exported from agentDb', () => {
    const { markAgentError } = require('../src/agentDb');
    expect(typeof markAgentError).toBe('function');
  });

  it('updates agent_registry status to error', async () => {
    const { markAgentError } = require('../src/agentDb');
    await markAgentError('nvidia', 'invalid_api_key');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'error'"),
      expect.arrayContaining(['nvidia'])
    );
  });

  it('stores the reason in the registry', async () => {
    const { markAgentError } = require('../src/agentDb');
    await markAgentError('gemini', 'invalid_api_key');
    const call = query.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes("status = 'error'"));
    expect(call).toBeDefined();
    expect(call[1]).toContain('invalid_api_key');
  });
});
