import { spawn } from 'node:child_process';

const port = process.env.PORT || '3010';
const baseUrl = `http://127.0.0.1:${port}`;
// `shell: true` means server.pid is the shell's pid, not `next start`'s —
// killing only that leaves the actual server process (and its children)
// running as an orphan. An orphaned server holding stdout/stderr open is
// exactly what makes a CI step hang forever after this script has already
// exited. `detached: true` puts the whole tree in its own process group so
// `process.kill(-server.pid, ...)` (note the negative pid) can signal all
// of it at once.
const server = spawn('npm', ['--prefix', 'ui', 'run', 'start', '--', '--port', port], {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
  detached: true,
});

let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    if (!server.killed) server.kill();
  }
};

process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });
process.on('SIGTERM', () => { stop(); process.exit(143); });

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ready() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(baseUrl);
      if (res.ok) return;
    } catch {}
    await wait(1000);
  }
  throw new Error(`UI did not become ready at ${baseUrl}`);
}

async function check(path) {
  const res = await fetch(`${baseUrl}${path}`);
  if (!res.ok) {
    throw new Error(`${path} returned ${res.status}`);
  }
}

try {
  await ready();
  await check('/');
  await check('/repos');
  await check('/security');
  console.log('UI e2e smoke passed');
  stop();
} catch (err) {
  console.error(err);
  stop();
  process.exit(1);
}
