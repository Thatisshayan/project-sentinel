import { spawn } from 'node:child_process';

const port = process.env.PORT || '3010';
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn('npm', ['--prefix', 'ui', 'run', 'start', '--', '--port', port], {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
});

const stop = () => {
  if (!server.killed) server.kill();
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
