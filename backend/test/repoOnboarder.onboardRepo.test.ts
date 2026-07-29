const createNotionProjectMock = jest.fn();
jest.mock('../src/notionClient', () => ({
  createNotionProject: (...a: any[]) => createNotionProjectMock(...a),
}));

const sendTelegramMessageMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/telegramClient', () => ({
  sendTelegramMessage: (...a: any[]) => sendTelegramMessageMock(...a),
}));

const triggerAuditMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/auditOrchestrator', () => ({
  triggerAudit: (...a: any[]) => triggerAuditMock(...a),
}));

const createChannelForRepoMock = jest.fn().mockResolvedValue(null);
jest.mock('../src/slackClient', () => ({
  createChannelForRepo: (...a: any[]) => createChannelForRepoMock(...a),
}));

jest.mock('../src/repoResolver', () => ({
  repoFullName: (r: string) => `test-org/${r}`,
  getGithubOrg: () => 'test-org',
}));

import axios from 'axios';
jest.mock('axios');

import { onboardRepo } from '../src/repoOnboarder';

/**
 * Regression guard: createNotionProject previously didn't exist anywhere in
 * notionClient.ts, so onboardRepo() always hit the "not available" branch,
 * yet unconditionally told the operator "Notion row created ✅" regardless.
 * Now the summary message must reflect what actually happened.
 */
describe('onboardRepo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['PUBLIC_DOMAIN'] = 'sentinel.example.com';
    process.env['GITHUB_TOKEN'] = 'tok';
    (axios.post as jest.Mock).mockResolvedValue({ data: {} });
  });

  it('reports Notion success when createNotionProject resolves a page id', async () => {
    createNotionProjectMock.mockResolvedValue('page-123');

    await onboardRepo('new-repo');

    const msg = sendTelegramMessageMock.mock.calls[0][0];
    expect(msg).toContain('Notion row created ✅');
    expect(createNotionProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ repoName: 'new-repo' })
    );
  });

  it('reports Notion failure (not silent success) when createNotionProject resolves null', async () => {
    createNotionProjectMock.mockResolvedValue(null);

    await onboardRepo('new-repo');

    const msg = sendTelegramMessageMock.mock.calls[0][0];
    expect(msg).toContain('Notion row created ❌');
    expect(msg).not.toContain('Notion row created ✅');
  });

  it('reports webhook and audit failures accurately rather than always claiming success', async () => {
    createNotionProjectMock.mockResolvedValue('page-123');
    (axios.post as jest.Mock).mockRejectedValue(new Error('github down'));
    triggerAuditMock.mockRejectedValue(new Error('audit boom'));

    await onboardRepo('new-repo');

    const msg = sendTelegramMessageMock.mock.calls[0][0];
    expect(msg).toContain('GitHub webhook registered ❌');
    expect(msg).toContain('First audit triggered ❌');
  });

  it('reports the Slack channel in the summary when created successfully', async () => {
    createNotionProjectMock.mockResolvedValue('page-123');
    createChannelForRepoMock.mockResolvedValue('C123456');

    await onboardRepo('New-Repo');

    const msg = sendTelegramMessageMock.mock.calls[0][0];
    expect(msg).toContain('Slack channel ✅ #new-repo');
  });

  it('reports Slack channel failure (not silent success) when Slack is unconfigured', async () => {
    createNotionProjectMock.mockResolvedValue('page-123');
    createChannelForRepoMock.mockResolvedValue(null);

    await onboardRepo('new-repo');

    const msg = sendTelegramMessageMock.mock.calls[0][0];
    expect(msg).toContain('Slack channel ❌');
  });
});
