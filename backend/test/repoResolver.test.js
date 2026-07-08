describe('repoResolver', () => {
  afterEach(() => {
    delete process.env.GITHUB_ORG;
    jest.resetModules();
  });

  it('getGithubOrg returns the env var value', () => {
    process.env.GITHUB_ORG = 'MyOrg';
    const { getGithubOrg } = require('../src/repoResolver');
    expect(getGithubOrg()).toBe('MyOrg');
  });

  it('getGithubOrg throws when GITHUB_ORG is not set', () => {
    const { getGithubOrg } = require('../src/repoResolver');
    expect(() => getGithubOrg()).toThrow('GITHUB_ORG');
  });

  it('repoFullName builds org/repo string', () => {
    process.env.GITHUB_ORG = 'Acme';
    const { repoFullName } = require('../src/repoResolver');
    expect(repoFullName('myapp')).toBe('Acme/myapp');
  });

  it('repoFullName throws when GITHUB_ORG is not set', () => {
    const { repoFullName } = require('../src/repoResolver');
    expect(() => repoFullName('myapp')).toThrow('GITHUB_ORG');
  });
});
