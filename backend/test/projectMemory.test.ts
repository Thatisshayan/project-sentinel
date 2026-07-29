jest.mock('../src/dbClient', () => ({
  query: jest.fn(),
}));

import projectMemory from '../src/projectMemory';
import { query } from '../src/dbClient';

const { addMemoryEntry, getMemoryEntries, deleteMemoryEntry, getMemoryForPrompt } = projectMemory;

describe('projectMemory (D-027 item 6: repo-scoped memory for agents)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('addMemoryEntry inserts with the given type/content/addedBy', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [{ id: 1, repo_full_name: 'org/tapcash', type: 'note', content: 'x' }] });
    const result = await addMemoryEntry('org/tapcash', 'note', 'x', 'human');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO project_memory'),
      ['org/tapcash', 'note', 'x', 'human']
    );
    expect(result).toEqual(expect.objectContaining({ id: 1 }));
  });

  test('getMemoryEntries returns rows ordered by most recent, scoped to the repo', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [{ id: 2 }, { id: 1 }] });
    const entries = await getMemoryEntries('org/tapcash');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), ['org/tapcash', 20]);
    expect(entries).toHaveLength(2);
  });

  test('deleteMemoryEntry scopes the DELETE to both id AND repo_full_name (cannot delete another repo\'s entry)', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [{ id: 5 }] });
    const deleted = await deleteMemoryEntry('org/tapcash', 5);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1 AND repo_full_name = $2'), [5, 'org/tapcash']);
    expect(deleted).toBe(true);
  });

  test('deleteMemoryEntry returns false when nothing matched', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [] });
    const deleted = await deleteMemoryEntry('org/tapcash', 999);
    expect(deleted).toBe(false);
  });

  test('getMemoryForPrompt returns an empty string when there is no memory yet', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [] });
    const text = await getMemoryForPrompt('org/tapcash');
    expect(text).toBe('');
  });

  test('getMemoryForPrompt formats entries with a human-readable type label', async () => {
    (query as jest.Mock).mockResolvedValue({
      rows: [
        { id: 1, type: 'dismissed_finding', content: 'the double openai/ prefix is correct, do not re-flag it' },
        { id: 2, type: 'convention', content: 'always use safeFire for Telegram sends' },
      ],
    });
    const text = await getMemoryForPrompt('org/tapcash');
    expect(text).toContain('PROJECT MEMORY');
    expect(text).toContain('[Known false positive (do NOT re-flag)] the double openai/ prefix is correct');
    expect(text).toContain('[Project convention] always use safeFire for Telegram sends');
  });

  test('getMemoryForPrompt fails closed (empty string, not a throw) if the DB query errors', async () => {
    (query as jest.Mock).mockRejectedValue(new Error('db down'));
    const text = await getMemoryForPrompt('org/tapcash');
    expect(text).toBe('');
  });
});
