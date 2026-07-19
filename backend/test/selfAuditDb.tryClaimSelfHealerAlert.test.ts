const queryMock = jest.fn();
jest.mock('../src/dbClient', () => ({ query: (...a: any[]) => queryMock(...a) }));

import { tryClaimSelfHealerAlert } from '../src/selfAuditDb';

describe('selfAuditDb.tryClaimSelfHealerAlert', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns true and issues the atomic UPDATE...WHERE...RETURNING when the claim succeeds', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 1 }] });
    const claimed = await tryClaimSelfHealerAlert(300000);

    expect(claimed).toBe(true);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('UPDATE self_healer_alert_state');
    expect(sql).toContain('SET last_alert_at = NOW()');
    expect(sql).toContain('last_alert_at IS NULL OR last_alert_at < NOW()');
    expect(params).toEqual([300000]);
  });

  it('returns false when the WHERE clause matches no row (still within cooldown)', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const claimed = await tryClaimSelfHealerAlert(300000);
    expect(claimed).toBe(false);
  });
});
