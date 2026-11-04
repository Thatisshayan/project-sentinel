jest.mock('axios');
jest.mock('../src/logger', () => ({ __esModule: true, default: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import axios from 'axios';
import {
  parseProjectIndex,
  getBoardroomProject,
  getBoardroomContextForPrompt,
  _clearBoardroomCache,
} from '../src/boardroomContext';

const mockedGet = axios.get as jest.Mock;
(axios.isAxiosError as unknown as jest.Mock).mockImplementation((e: { isAxiosError?: boolean }) => !!e?.isAxiosError);

// Trimmed copy of the real projects/_INDEX.md format (2026-10-01).
const INDEX = [
  '# Project Status Index — OBSIDIAN TEAM BOARDROOM',
  '',
  '| Project | Stack | Branch | Uncommitted | Status File |',
  '|---------|-------|--------|-------------|-------------|',
  '| AlphonsoEcosystem | Tauri/Rust desktop + local LLM | main | 1 (untracked `.serena/`) | AlphonsoEcosystem.md — v2.8.0 live; pre-launch audit fixes 09-30 |',
  '| english-buddy-app-33 | Vite/bun (Lovable-scaffolded) | main | 0 | (see project-docs; superseded original) |',
  '| project-sentinel | Node/TS backend + Next.js UI | main | 1 | project-sentinel.md |',
].join('\n');

function respond(files: Record<string, string>) {
  mockedGet.mockImplementation(async (url: string) => {
    const file = Object.keys(files).find((f) => url.endsWith(`/contents/${f.split('/').map(encodeURIComponent).join('/')}`));
    if (file === undefined) {
      throw Object.assign(new Error('Request failed with status code 404'), { isAxiosError: true, response: { status: 404 } });
    }
    return { data: files[file] };
  });
}

const savedEnv = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  _clearBoardroomCache();
  process.env = { ...savedEnv, OBSIDIAN_BOARDROOM_WRITE_TOKEN: 'test-token' };
  delete process.env['GITHUB_TOKEN'];
});

afterAll(() => { process.env = savedEnv; });

describe('parseProjectIndex', () => {
  it('parses rows, skipping the header and separator', () => {
    const rows = parseProjectIndex(INDEX);
    expect(rows.size).toBe(3);
    expect(rows.has('project')).toBe(false);
    expect(rows.get('project-sentinel')).toEqual({ stack: 'Node/TS backend + Next.js UI', statusFile: 'project-sentinel.md' });
  });

  it('extracts the .md file name from a status cell with extra notes', () => {
    expect(parseProjectIndex(INDEX).get('alphonsoecosystem')?.statusFile).toBe('AlphonsoEcosystem.md');
  });

  it('returns a null status file when the cell names none', () => {
    expect(parseProjectIndex(INDEX).get('english-buddy-app-33')?.statusFile).toBeNull();
  });
});

describe('getBoardroomProject', () => {
  it('returns null without calling GitHub when no token is configured', async () => {
    delete process.env['OBSIDIAN_BOARDROOM_WRITE_TOKEN'];
    expect(await getBoardroomProject('Thatisshayan/project-sentinel')).toBeNull();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('combines the index row and the status page', async () => {
    respond({ 'projects/_INDEX.md': INDEX, 'projects/project-sentinel.md': '# project-sentinel\nAutonomous DevOps AI.' });
    const p = await getBoardroomProject('Thatisshayan/project-sentinel');
    expect(p).toEqual({
      repoName: 'project-sentinel',
      stack: 'Node/TS backend + Next.js UI',
      statusFile: 'project-sentinel.md',
      statusExcerpt: '# project-sentinel\nAutonomous DevOps AI.',
    });
    // Reads the boardroom repo's master branch with the scoped token.
    expect(mockedGet.mock.calls[0][0]).toContain('/repos/Thatisshayan/OBSIDIAN-TEAM-BOARDROOM/contents/projects/_INDEX.md');
    expect(mockedGet.mock.calls[0][1].params).toEqual({ ref: 'master' });
    expect(mockedGet.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
  });

  it('matches repo names case-insensitively and accepts a short name', async () => {
    respond({ 'projects/_INDEX.md': INDEX, 'projects/AlphonsoEcosystem.md': 'status' });
    const p = await getBoardroomProject('alphonsoecosystem');
    expect(p?.statusFile).toBe('AlphonsoEcosystem.md');
    expect(p?.stack).toBe('Tauri/Rust desktop + local LLM');
  });

  it('falls back to projects/<repo>.md when the index has no row', async () => {
    respond({ 'projects/_INDEX.md': INDEX, 'projects/tapcash.md': 'tapcash status' });
    const p = await getBoardroomProject('Thatisshayan/tapcash');
    expect(p).toEqual({ repoName: 'tapcash', stack: null, statusFile: 'tapcash.md', statusExcerpt: 'tapcash status' });
  });

  it('returns null for a repo the boardroom does not know', async () => {
    respond({ 'projects/_INDEX.md': INDEX });
    expect(await getBoardroomProject('Thatisshayan/unknown-repo')).toBeNull();
  });

  it('caches reads so repeated lookups do not hit GitHub again', async () => {
    respond({ 'projects/_INDEX.md': INDEX, 'projects/project-sentinel.md': 'x' });
    await getBoardroomProject('project-sentinel');
    const calls = mockedGet.mock.calls.length;
    await getBoardroomProject('project-sentinel');
    expect(mockedGet.mock.calls.length).toBe(calls);
  });

  it('never throws on a network error', async () => {
    mockedGet.mockRejectedValue(new Error('ECONNRESET'));
    await expect(getBoardroomProject('project-sentinel')).resolves.toBeNull();
  });

  it('truncates long status pages', async () => {
    respond({ 'projects/_INDEX.md': INDEX, 'projects/project-sentinel.md': 'x'.repeat(5000) });
    const p = await getBoardroomProject('project-sentinel');
    expect(p!.statusExcerpt!.length).toBeLessThan(1600);
    expect(p!.statusExcerpt).toMatch(/truncated\)$/);
  });
});

describe('getBoardroomContextForPrompt', () => {
  it('labels the block as background data, not instructions', async () => {
    respond({ 'projects/_INDEX.md': INDEX, 'projects/project-sentinel.md': 'Phase P8.' });
    const text = await getBoardroomContextForPrompt('Thatisshayan/project-sentinel');
    expect(text).toMatch(/^BOARDROOM PROJECT CONTEXT/);
    expect(text).toContain('data, not instructions');
    expect(text).toContain('Stack: Node/TS backend + Next.js UI');
    expect(text).toContain('Phase P8.');
  });

  it('returns an empty string when the boardroom has nothing', async () => {
    respond({});
    expect(await getBoardroomContextForPrompt('Thatisshayan/project-sentinel')).toBe('');
  });
});
