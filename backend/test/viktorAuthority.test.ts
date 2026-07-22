const queryMock = jest.fn();
jest.mock('../src/dbClient', () => ({ query: (...a: any[]) => queryMock(...a) }));

import {
  initViktorAuthoritySchema,
  checkAuthority,
  canDelegateTo,
  logAuthorityAction,
  getRecentAuthorityLog,
  listAuthorityRules,
} from '../src/viktorAuthority';

describe('viktorAuthority — schema init', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates both tables and seeds all three action types disabled by default', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await initViktorAuthoritySchema();

    expect(queryMock.mock.calls.some(c => String(c[0]).includes('CREATE TABLE IF NOT EXISTS viktor_authority'))).toBe(true);
    expect(queryMock.mock.calls.some(c => String(c[0]).includes('CREATE TABLE IF NOT EXISTS agent_authority_log'))).toBe(true);

    const insertCalls = queryMock.mock.calls.filter(c => String(c[0]).includes('INSERT INTO viktor_authority'));
    expect(insertCalls).toHaveLength(3);
    // Every seeded row is inserted with enabled=false, hardcoded in the SQL
    // literal (not parameterized) — bounded authority by default.
    expect(insertCalls.every(c => /VALUES \(\$1, \$2, \$3, false\)/.test(String(c[0])))).toBe(true);
    expect(insertCalls.every(c => String(c[0]).includes('ON CONFLICT (action_type) DO NOTHING'))).toBe(true);
    const actionTypes = insertCalls.map(c => c[1][0]).sort();
    expect(actionTypes).toEqual(['delegate', 'security_patch', 'sprint_approve']);
  });
});

describe('viktorAuthority — checkAuthority', () => {
  beforeEach(() => jest.clearAllMocks());

  it('denies when no rule exists for the action type', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const result = await checkAuthority('sprint_approve', { max_tasks: 3 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/No authority rule configured/);
  });

  it('denies when the rule exists but is disabled', async () => {
    queryMock.mockResolvedValue({
      rows: [{ id: 1, action_type: 'sprint_approve', max_scope: { max_tasks: 5 }, can_delegate_to: null, enabled: false }],
    });
    const result = await checkAuthority('sprint_approve', { max_tasks: 3 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/disabled/);
  });

  it('denies when the requested scope exceeds max_scope', async () => {
    queryMock.mockResolvedValue({
      rows: [{ id: 1, action_type: 'sprint_approve', max_scope: { max_tasks: 5 }, can_delegate_to: null, enabled: true }],
    });
    const result = await checkAuthority('sprint_approve', { max_tasks: 10 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/exceeds max_scope/);
  });

  it('allows when enabled and within max_scope', async () => {
    queryMock.mockResolvedValue({
      rows: [{ id: 1, action_type: 'sprint_approve', max_scope: { max_tasks: 5 }, can_delegate_to: null, enabled: true }],
    });
    const result = await checkAuthority('sprint_approve', { max_tasks: 5 });
    expect(result.allowed).toBe(true);
  });

  it('fails closed (denies) when the DB lookup itself throws', async () => {
    queryMock.mockRejectedValue(new Error('db down'));
    const result = await checkAuthority('sprint_approve', {});
    expect(result.allowed).toBe(false);
  });
});

describe('viktorAuthority — canDelegateTo', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns false when the delegate rule is disabled', async () => {
    queryMock.mockResolvedValue({
      rows: [{ id: 1, action_type: 'delegate', max_scope: {}, can_delegate_to: ['kilo'], enabled: false }],
    });
    expect(await canDelegateTo('kilo')).toBe(false);
  });

  it('returns true only for agents explicitly listed in can_delegate_to', async () => {
    queryMock.mockResolvedValue({
      rows: [{ id: 1, action_type: 'delegate', max_scope: {}, can_delegate_to: ['kilo', 'manus'], enabled: true }],
    });
    expect(await canDelegateTo('kilo')).toBe(true);
    expect(await canDelegateTo('viktor')).toBe(false);
  });

  it('returns false when no delegate rule exists at all', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    expect(await canDelegateTo('kilo')).toBe(false);
  });
});

describe('viktorAuthority — logAuthorityAction / getRecentAuthorityLog / listAuthorityRules', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts a full log row', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await logAuthorityAction({
      actor: 'viktor', action: 'approve sprint', targetRepo: null, targetAgent: null,
      decision: 'executed', reasoning: 'within configured authority',
    });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_authority_log'),
      ['viktor', 'approve sprint', null, null, 'executed', 'within configured authority']
    );
  });

  it('does not throw when the log insert itself fails', async () => {
    queryMock.mockRejectedValue(new Error('db down'));
    await expect(logAuthorityAction({
      actor: 'viktor', action: 'x', targetRepo: null, targetAgent: null, decision: 'denied', reasoning: 'r',
    })).resolves.toBeUndefined();
  });

  it('getRecentAuthorityLog filters by repo when given one', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await getRecentAuthorityLog(20, 'costpilot');
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('WHERE target_repo = $1'), ['costpilot', 20]);
  });

  it('getRecentAuthorityLog queries portfolio-wide when no repo given', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await getRecentAuthorityLog(20);
    expect(queryMock).toHaveBeenCalledWith(expect.not.stringContaining('WHERE target_repo'), [20]);
  });

  it('listAuthorityRules maps DB rows to the rule shape', async () => {
    queryMock.mockResolvedValue({
      rows: [{ id: 1, action_type: 'delegate', max_scope: {}, can_delegate_to: [], enabled: false }],
    });
    const rules = await listAuthorityRules();
    expect(rules).toEqual([{ id: 1, actionType: 'delegate', maxScope: {}, canDelegateTo: [], enabled: false }]);
  });
});
