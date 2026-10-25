import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';

// Owned acceptance only: all paths/ports are supplied by the private parent fixture.
process.on('SIGTERM', () => {});
const child = spawn(
  process.execPath,
  ['-e', "process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],
  { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }
);
const ready = new Promise((resolve) => child.once('message', resolve));
if (process.argv[3] === 'server') {
  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Missing private port');
  const server = createServer((socket) => socket.end('owned-dev'));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`Local: http://127.0.0.1:${port}`);
}
await ready;
const identity = (pid) => {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = stat
    .slice(stat.lastIndexOf(')') + 1)
    .trim()
    .split(/\s+/);
  return { pid, start: fields[19], group: Number(fields[2]), session: Number(fields[3]) };
};
writeFileSync(
  process.argv[2],
  JSON.stringify({
    root: process.pid,
    child: child.pid,
    identities: [identity(process.pid), identity(child.pid)],
  }),
  {
    mode: 0o600,
  }
);
setInterval(() => {}, 1000);
