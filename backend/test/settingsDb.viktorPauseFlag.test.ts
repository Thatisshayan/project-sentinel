// No settingsDb.test.ts existed before Phase 6 — this file covers only the
// new sentinel_paused flag added for Viktor's kill switch (Phase 6), not a
// retrofit of full pre-existing settingsDb coverage.
const queryMock = jest.fn();
jest.mock('../src/dbClient', () => ({ query: (...a: any[]) => queryMock(...a) }));

import { initSettingsSchema, getSettings, updateSettings } from '../src/settingsDb';

describe('settingsDb — sentinel_paused (Phase 6 kill switch)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('backfills the sentinel_paused column idempotently on schema init', async () => {
    queryMock.mockResolvedValue({ rows: [{ cnt: '1' }] });
    await initSettingsSchema();
    expect(queryMock.mock.calls.some(c =>
      String(c[0]).includes('ADD COLUMN IF NOT EXISTS sentinel_paused')
    )).toBe(true);
  });

  it('getSettings defaults sentinel_paused to false when the column is null (stale row)', async () => {
    queryMock.mockResolvedValue({ rows: [{ sentinel_paused: null }] });
    const settings = await getSettings();
    expect(settings.sentinel_paused).toBe(false);
  });

  it('getSettings passes through a true sentinel_paused value', async () => {
    queryMock.mockResolvedValue({ rows: [{ sentinel_paused: true }] });
    const settings = await getSettings();
    expect(settings.sentinel_paused).toBe(true);
  });

  it('updateSettings allows setting sentinel_paused', async () => {
    queryMock.mockResolvedValue({ rows: [{ sentinel_paused: true }] });
    await updateSettings({ sentinel_paused: true });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('sentinel_paused = $1'),
      [true]
    );
  });

  it('updateSettings does not hardcode "WHERE id = 1" — system_settings is a singleton whose row id is not guaranteed to be 1', async () => {
    queryMock.mockResolvedValue({ rows: [{ sentinel_paused: true }] });
    await updateSettings({ sentinel_paused: true });
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).not.toMatch(/WHERE\s+id\s*=\s*1\b/i);
  });
});
