jest.mock('../src/projectDb', () => ({
  getRepoAutomationPolicy: jest.fn(),
}));

jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/utils/execAsync', () => ({
  execAsync: jest.fn(),
}));

const cloneMock = jest.fn();
jest.mock('simple-git', () => {
  const factory = () => ({ clone: cloneMock });
  return factory;
});

const projectDb = require('../src/projectDb');
const { execAsync } = require('../src/utils/execAsync');
const { sendTelegramMessage } = require('../src/telegramClient');
const { applySecurityPatches } = require('../src/securityPatcher');

describe('securityPatcher repo policy enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('blocks security patch execution when repo policy disallows task execution', async () => {
    projectDb.getRepoAutomationPolicy.mockResolvedValue({
      preset: 'audit-only',
      policy: {
        allowTaskExecution: false,
        allowPrOpen: false,
        allowPrUpdate: false,
        allowAutoPush: false,
      },
    });

    await applySecurityPatches('your-org/tapcash', 'tapcash', [{
      id: 1,
      auto_fixable: true,
      issue_type: 'vulnerability',
      severity: 'high',
      title: 'Minimatch ReDoS',
      description: 'Package manager dependency issue',
    }], null);

    expect(execAsync).not.toHaveBeenCalled();
    expect(cloneMock).not.toHaveBeenCalled();
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      expect.stringContaining('Security Patch Blocked'),
      'tapcash',
      null
    );
  });
});
