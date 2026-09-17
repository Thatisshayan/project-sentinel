import axios from 'axios';
jest.mock('axios');

const { checkGitHubActions } = require('../src/buildPoller');

/**
 * Regression guard: 'action_required' (an approval-gated run — e.g. a
 * non-collaborator actor triggering a workflow, which is exactly what
 * Sentinel's own "agent/automation/*" branches hit) and other non-terminal
 * conclusions ('cancelled', 'skipped', 'neutral', 'stale') were previously
 * mapped to 'failed', which sent OBSIDIAN-TEAM-BOARDROOM's docs-only
 * ledger-check runs into orchestrateDebug()'s costly auto-repair loop for
 * 14+ hours even though nothing was actually broken.
 */
describe('buildPoller.checkGitHubActions', () => {
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

  const mockRun = (conclusion: string | null) => {
    (axios.get as jest.Mock).mockResolvedValue({
      data: {
        workflow_runs: [
          {
            id: 1,
            status: 'completed',
            conclusion,
            name: 'ledger-check',
            html_url: 'https://example.test/run/1',
            created_at: new Date().toISOString(),
          },
        ],
      },
    });
  };

  it('does not report failed for an action_required conclusion', async () => {
    mockRun('action_required');
    const result = await checkGitHubActions('Thatisshayan/OBSIDIAN-TEAM-BOARDROOM', 'abc123');
    expect(result.status).toBe('not_configured');
  });

  it.each(['cancelled', 'skipped', 'neutral', 'stale'])(
    'does not report failed for a %s conclusion',
    async (conclusion) => {
      mockRun(conclusion);
      const result = await checkGitHubActions('Thatisshayan/OBSIDIAN-TEAM-BOARDROOM', 'abc123');
      expect(result.status).toBe('not_configured');
    }
  );

  it('still reports failed for a real failure conclusion', async () => {
    mockRun('failure');
    const result = await checkGitHubActions('Thatisshayan/OBSIDIAN-TEAM-BOARDROOM', 'abc123');
    expect(result.status).toBe('failed');
  });

  it('still reports success for a success conclusion', async () => {
    mockRun('success');
    const result = await checkGitHubActions('Thatisshayan/OBSIDIAN-TEAM-BOARDROOM', 'abc123');
    expect(result.status).toBe('success');
  });
});
