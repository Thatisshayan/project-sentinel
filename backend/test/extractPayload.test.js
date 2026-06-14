const { extractPayload } = require('../src/extractPayload');

const base = {
  ref: 'refs/heads/main',
  repository: {
    name: 'tapcash',
    full_name: 'Thatisshayan/tapcash',
    html_url: 'https://github.com/Thatisshayan/tapcash',
  },
  head_commit: {
    id: 'abc123def456abc123def456abc123def456abcd',
    message: 'feat: add user dashboard',
    url: 'https://github.com/commit/abc123',
    author: { name: 'Shayan', email: 'shayan@test.com' },
    timestamp: '2026-06-10T09:00:00Z',
    added: ['src/dashboard.js'],
    modified: ['src/index.js'],
    removed: [],
  },
  pusher: { name: 'Shayan' },
  commits: [],
};

describe('extractPayload', () => {
  test('extracts repo name and lowercased version', () => {
    const r = extractPayload(base);
    expect(r.repoName).toBe('tapcash');
    expect(r.repoNameLower).toBe('tapcash');
  });

  test('strips refs/heads/ from branch name', () => {
    expect(extractPayload(base).branchName).toBe('main');
  });

  test('extracts commit fields correctly', () => {
    const r = extractPayload(base);
    expect(r.commitSha).toBe('abc123def456abc123def456abc123def456abcd');
    expect(r.commitMessage).toBe('feat: add user dashboard');
    expect(r.authorName).toBe('Shayan');
  });

  test('counts changed files across added + modified + removed', () => {
    const r = extractPayload(base);
    expect(r.filesChangedCount).toBe(2);
    expect(r.changedFiles).toContain('src/dashboard.js');
    expect(r.changedFiles).toContain('src/index.js');
  });

  test('detects marketing-only update', () => {
    const marketing = {
      ...base,
      head_commit: { ...base.head_commit, added: ['public/hero.png'], modified: [], removed: [] },
    };
    expect(extractPayload(marketing).isMarketingOnlyUpdate).toBe(true);
    expect(extractPayload(marketing).riskLevel).toBe('Low');
  });

  test('detects high risk for auth files', () => {
    const risky = {
      ...base,
      head_commit: { ...base.head_commit, modified: ['src/auth.js'] },
    };
    expect(extractPayload(risky).riskLevel).toBe('High');
  });

  test('falls back to last commit in commits[] when head_commit is null', () => {
    const fallback = { ...base, head_commit: null, commits: [base.head_commit] };
    expect(extractPayload(fallback).commitSha).toBe('abc123def456abc123def456abc123def456abcd');
  });

  test('throws when repository is missing', () => {
    expect(() => extractPayload({})).toThrow();
    expect(() => extractPayload({ repository: {} })).toThrow();
  });

  test('throws on null payload', () => {
    expect(() => extractPayload(null)).toThrow();
  });

  test('truncates commit messages over 200 chars', () => {
    const long = { ...base, head_commit: { ...base.head_commit, message: 'a'.repeat(300) } };
    expect(extractPayload(long).commitMessage.length).toBeLessThanOrEqual(200);
  });

  test('handles empty changed file arrays without crashing', () => {
    const empty = {
      ...base,
      head_commit: { ...base.head_commit, added: [], modified: [], removed: [] },
    };
    const r = extractPayload(empty);
    expect(r.filesChangedCount).toBe(0);
    expect(r.isMarketingOnlyUpdate).toBe(false);
  });
});
