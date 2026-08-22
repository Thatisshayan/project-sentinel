const axiosGetMock = jest.fn();

jest.mock('axios', () => ({
  get: (...args: unknown[]) => axiosGetMock(...args),
}));

const getDefaultBranchMock = jest.fn();
jest.mock('../src/repoDiscovery', () => ({
  getDefaultBranch: (...args: unknown[]) => getDefaultBranchMock(...args),
}));

jest.mock('../src/repoResolver', () => ({
  repoFullName: (name: string) => `your-org/${name}`,
}));

import governanceStatus from '../src/governanceStatus';

describe('governanceStatus.getGovernanceStatus', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, GITHUB_TOKEN: 'gh-test-token' };
    getDefaultBranchMock.mockResolvedValue('main');
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('reports healthy when branch protection matches the documented policy', async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        required_status_checks: {
          strict: true,
          contexts: ['gate'],
        },
        enforce_admins: { enabled: true },
        required_pull_request_reviews: { dismiss_stale_reviews: true },
        allow_force_pushes: { enabled: false },
        allow_deletions: { enabled: false },
      },
    });

    const result = await governanceStatus.getGovernanceStatus();

    expect(result.status).toBe('healthy');
    expect(result.repoFullName).toBe('your-org/project-sentinel');
    expect(result.requiredStatusChecks).toEqual(['gate']);
    expect(result.drift).toEqual([]);
  });

  it('reports drift when GitHub returns 404 for branch protection', async () => {
    axiosGetMock.mockRejectedValue({ response: { status: 404 } });

    const result = await governanceStatus.getGovernanceStatus();

    expect(result.status).toBe('drift');
    expect(result.branchProtectionConfigured).toBe(false);
    expect(result.drift).toContain('Branch protection is not configured on main.');
    expect(result.missingRequiredChecks).toEqual(['gate']);
  });

  it('reports unconfigured when GITHUB_TOKEN is missing', async () => {
    delete process.env['GITHUB_TOKEN'];

    const result = await governanceStatus.getGovernanceStatus();

    expect(result.status).toBe('unconfigured');
    expect(result.drift[0]).toContain('GITHUB_TOKEN is not configured');
    expect(axiosGetMock).not.toHaveBeenCalled();
  });
});
