const getDegradedComponentsMock  = jest.fn();
const tryClaimSelfHealerAlertMock = jest.fn();
const sendTelegramMessageMock    = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/selfAuditDb', () => ({
  getDegradedComponents:     (...a: any[]) => getDegradedComponentsMock(...a),
  recordComponentFailure:    jest.fn().mockResolvedValue(undefined),
  recordComponentSuccess:    jest.fn().mockResolvedValue(undefined),
  tryClaimSelfHealerAlert:   (...a: any[]) => tryClaimSelfHealerAlertMock(...a),
}));

jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: (...a: any[]) => sendTelegramMessageMock(...a),
}));

import { checkAndHeal } from '../src/selfHealer';

describe('selfHealer cooldown (durable, DB-backed)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not alert when there are no degraded components', async () => {
    getDegradedComponentsMock.mockResolvedValue([]);
    await checkAndHeal();
    expect(tryClaimSelfHealerAlertMock).not.toHaveBeenCalled();
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it('sends the alert when degraded and the DB cooldown claim succeeds', async () => {
    getDegradedComponentsMock.mockResolvedValue([
      { component_name: 'webhook', failure_count: 3, last_error: 'timeout' },
    ]);
    tryClaimSelfHealerAlertMock.mockResolvedValue(true);

    await checkAndHeal();

    expect(tryClaimSelfHealerAlertMock).toHaveBeenCalledWith(5 * 60 * 1000);
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessageMock.mock.calls[0][0]).toContain('Self-Healing Alert');
  });

  it('suppresses the alert when the DB cooldown claim fails (still within cooldown)', async () => {
    getDegradedComponentsMock.mockResolvedValue([
      { component_name: 'webhook', failure_count: 3, last_error: 'timeout' },
    ]);
    tryClaimSelfHealerAlertMock.mockResolvedValue(false);

    await checkAndHeal();

    expect(tryClaimSelfHealerAlertMock).toHaveBeenCalledWith(5 * 60 * 1000);
    expect(sendTelegramMessageMock).not.toHaveBeenCalled();
  });

  it('re-checks the cooldown claim on every call — no in-memory state carried between invocations', async () => {
    // Regression test for the original bug: an in-memory `lastHealAlertAt`
    // variable would reset to 0 on every process restart, meaning the
    // cooldown decision now must come from tryClaimSelfHealerAlert() every
    // single time, never from module-level state.
    getDegradedComponentsMock.mockResolvedValue([
      { component_name: 'webhook', failure_count: 3, last_error: 'timeout' },
    ]);

    tryClaimSelfHealerAlertMock.mockResolvedValueOnce(true);
    await checkAndHeal();
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);

    tryClaimSelfHealerAlertMock.mockResolvedValueOnce(false);
    await checkAndHeal();
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1); // still 1, not 2

    tryClaimSelfHealerAlertMock.mockResolvedValueOnce(true);
    await checkAndHeal();
    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(2);

    expect(tryClaimSelfHealerAlertMock).toHaveBeenCalledTimes(3);
  });
});
