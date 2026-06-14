const { extractPayload } = require('../src/extractPayload');

describe('Notion repo matching logic', () => {
  const notionRows = [
    { repoName: 'tapcash',    projectName: 'TapCash' },
    { repoName: 'costpilot',  projectName: 'CostPilot' },
    { repoName: 'shiporex',   projectName: 'Shiporex' },
  ];

  function findMatch(repoName) {
    const lower = repoName.toLowerCase();
    return notionRows.find(r => r.repoName.toLowerCase() === lower) || null;
  }

  test('matches exact case', () => {
    expect(findMatch('tapcash')).not.toBeNull();
  });

  test('matches different case — GitHub sends Tapcash, Notion has tapcash', () => {
    expect(findMatch('Tapcash')).not.toBeNull();
    expect(findMatch('TAPCASH')).not.toBeNull();
    expect(findMatch('TapCash')).not.toBeNull();
  });

  test('returns null for unknown repo', () => {
    expect(findMatch('unknownrepo')).toBeNull();
  });

  test('returns correct project name', () => {
    expect(findMatch('costpilot').projectName).toBe('CostPilot');
  });
});
