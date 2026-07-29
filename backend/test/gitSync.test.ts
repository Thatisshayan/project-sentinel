/**
 * Real-git integration test (not mocked) — rebase behavior is exactly the
 * kind of thing that's easy to get subtly wrong with a mock and have it
 * look right. Uses actual temp repos and real `git` operations.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import simpleGit from 'simple-git';
import gitSync from '../src/utils/gitSync';

const { rebaseOntoBase } = gitSync;

async function makeTempRepo(): Promise<{ dir: string; git: ReturnType<typeof simpleGit> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitsync-test-'));
  const git = simpleGit(dir);
  await git.init(['--initial-branch=main']);
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('user.name', 'Test');
  // Avoid platform-dependent CRLF<->LF conversion on checkout so file
  // content assertions below are consistent on Windows and Linux alike.
  await git.addConfig('core.autocrlf', 'false');
  return { dir, git };
}

function readNormalized(file: string): string {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim();
}

function cleanup(dirs: string[]): void {
  for (const d of dirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

describe('rebaseOntoBase', () => {
  it('rebases cleanly onto a moved base when there is no real conflict', async () => {
    const remote = await makeTempRepo();
    await remote.git.raw(['config', 'receive.denyCurrentBranch', 'ignore']);
    fs.writeFileSync(path.join(remote.dir, 'a.txt'), 'line1\n');
    fs.writeFileSync(path.join(remote.dir, 'b.txt'), 'original\n');
    await remote.git.add('.');
    await remote.git.commit('base commit');

    const clone = await makeTempRepo();
    await clone.git.raw(['remote', 'add', 'origin', remote.dir]);
    await clone.git.fetch('origin', 'main');
    await clone.git.checkout(['-b', 'main', 'origin/main']);
    await clone.git.checkoutLocalBranch('task-branch');
    fs.writeFileSync(path.join(clone.dir, 'a.txt'), 'line1\nline-from-task\n');
    await clone.git.add('.');
    await clone.git.commit('task commit');

    // Simulate the base moving on the remote in the meantime, touching an
    // unrelated file so there's no real conflict with the task branch's edit.
    fs.writeFileSync(path.join(remote.dir, 'b.txt'), 'changed-by-someone-else\n');
    await remote.git.add('.');
    await remote.git.commit('unrelated base commit');

    await clone.git.fetch('origin', 'main');
    const result = await rebaseOntoBase(clone.git, 'main');

    expect(result.rebased).toBe(true);
    expect(result.conflicted).toBe(false);

    const log = await clone.git.log({ maxCount: 1 });
    expect(log.latest?.message).toBe('task commit');
    expect(readNormalized(path.join(clone.dir, 'b.txt'))).toBe('changed-by-someone-else');
    expect(readNormalized(path.join(clone.dir, 'a.txt'))).toBe('line1\nline-from-task');

    cleanup([remote.dir, clone.dir]);
  });

  it('aborts cleanly (branch left untouched) on a real conflict', async () => {
    const remote = await makeTempRepo();
    await remote.git.raw(['config', 'receive.denyCurrentBranch', 'ignore']);
    fs.writeFileSync(path.join(remote.dir, 'a.txt'), 'line1\n');
    await remote.git.add('.');
    await remote.git.commit('base commit');

    const clone = await makeTempRepo();
    await clone.git.raw(['remote', 'add', 'origin', remote.dir]);
    await clone.git.fetch('origin', 'main');
    await clone.git.checkout(['-b', 'main', 'origin/main']);
    await clone.git.checkoutLocalBranch('task-branch');
    fs.writeFileSync(path.join(clone.dir, 'a.txt'), 'line1\nline-from-task\n');
    await clone.git.add('.');
    await clone.git.commit('task commit');
    const preRebaseSha = (await clone.git.log({ maxCount: 1 })).latest?.hash;

    // Same file, same line region, on the remote — a genuine conflict.
    fs.writeFileSync(path.join(remote.dir, 'a.txt'), 'line1\nline-from-someone-else\n');
    await remote.git.add('.');
    await remote.git.commit('conflicting base commit');

    await clone.git.fetch('origin', 'main');
    const result = await rebaseOntoBase(clone.git, 'main');

    expect(result.rebased).toBe(false);
    expect(result.conflicted).toBe(true);

    // Branch must be left exactly where it was — no half-finished rebase.
    const status = await clone.git.status();
    expect(status.conflicted.length).toBe(0);
    const postRebaseSha = (await clone.git.log({ maxCount: 1 })).latest?.hash;
    expect(postRebaseSha).toBe(preRebaseSha);

    cleanup([remote.dir, clone.dir]);
  });
});
