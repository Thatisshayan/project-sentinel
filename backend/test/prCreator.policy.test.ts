const axiosGetMock = jest.fn();
const axiosPostMock = jest.fn();

jest.mock('axios', () => ({
  get: (...args: any[]) => axiosGetMock(...args),
  post: (...args: any[]) => axiosPostMock(...args),
}));

const getRepoAutomationPolicyMock = jest.fn();
jest.mock('../src/projectDb', () => ({
  getRepoAutomationPolicy: (...args: any[]) => getRepoAutomationPolicyMock(...args),
}));

const { createPullRequest } = require('../src/prCreator');

describe('prCreator policy enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['GITHUB_TOKEN'] = 'gh-test-token';
  });

  it('does not open a new PR when repo policy disables pr_open', async () => {
    getRepoAutomationPolicyMock.mockResolvedValue({
      preset: 'custom',
      policy: {
        allowTaskExecution: true,
        allowPrOpen: false,
        allowPrUpdate: true,
        allowAutoPush: true,
      },
    });
    axiosGetMock.mockResolvedValue({ data: [] });

    const result = await createPullRequest({
      repoFullName: 'your-org/tapcash',
      fixBranch: 'sentinel/work-123',
      baseBranch: 'main',
      context: { repoName: 'tapcash', kind: 'task' },
    });

    expect(result).toEqual({ prUrl: null, prNumber: null });
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it('does not treat an existing PR as usable when repo policy disables pr_update', async () => {
    getRepoAutomationPolicyMock.mockResolvedValue({
      preset: 'custom',
      policy: {
        allowTaskExecution: true,
        allowPrOpen: true,
        allowPrUpdate: false,
        allowAutoPush: true,
      },
    });
    axiosGetMock.mockResolvedValue({
      data: [{ html_url: 'https://github.com/your-org/tapcash/pull/12', number: 12 }],
    });

    const result = await createPullRequest({
      repoFullName: 'your-org/tapcash',
      fixBranch: 'sentinel/work-123',
      baseBranch: 'main',
      context: { repoName: 'tapcash', kind: 'task' },
    });

    expect(result).toEqual({ prUrl: null, prNumber: null });
    expect(axiosPostMock).not.toHaveBeenCalled();
  });
});
