jest.mock('../src/notionClient', () => ({}));
jest.mock('../src/portfolioAnalytics', () => ({ REPO_LIST: [] }));
jest.mock('../src/portfolioDb', () => ({
  getDiscoveredRepoNames: jest.fn(),
  getOnboardedDiscoveredRepos: jest.fn(),
  insertDiscoveredRepo: jest.fn(),
  markDiscoveredRepoOnboarded: jest.fn(),
}));
jest.mock('../src/repoOnboarder', () => ({ getWatchedRepos: () => [], onboardRepo: jest.fn() }));
jest.mock('../src/repoResolver', () => ({ getGithubOrg: () => 'test-org' }));

import axios from 'axios';
jest.mock('axios');

import { getDefaultBranch } from '../src/repoDiscovery';

/**
 * Regression guard: the manual-audit routes used to hardcode branchName:
 * 'main', which broke on any repo whose default branch isn't main (found
 * live via a failed audit on a repo using a different default branch).
 */
describe('repoDiscovery.getDefaultBranch', () => {
  const originalGithubToken = process.env['GITHUB_TOKEN'];

  beforeEach(() => {
    jest.clearAllMocks();
    process.env['GITHUB_TOKEN'] = 'tok';
  });

  afterEach(() => {
    if (originalGithubToken === undefined) {
      delete process.env['GITHUB_TOKEN'];
    } else {
      process.env['GITHUB_TOKEN'] = originalGithubToken;
    }
  });

  it('returns the repo\'s actual default branch on success', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { default_branch: 'develop' } });

    const branch = await getDefaultBranch('org/repo');

    expect(branch).toBe('develop');
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.github.com/repos/org/repo',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) })
    );
  });

  it('falls back to main without making a request when GITHUB_TOKEN is unset', async () => {
    delete process.env['GITHUB_TOKEN'];

    const branch = await getDefaultBranch('org/repo');

    expect(branch).toBe('main');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('falls back to main when the GitHub API request fails', async () => {
    (axios.get as jest.Mock).mockRejectedValue(new Error('timeout'));

    const branch = await getDefaultBranch('org/repo');

    expect(branch).toBe('main');
  });

  it('falls back to main when the response has no default_branch', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: {} });

    const branch = await getDefaultBranch('org/repo');

    expect(branch).toBe('main');
  });
});
