import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
process.on('SIGHUP', () => {});
const child = spawn(
  process.execPath,
  [
    '-e',
    "process.on('SIGTERM',()=>{});process.on('SIGHUP',()=>{});process.send('ready');setInterval(()=>{},1000)",
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }
);
child.once('message', () =>
  writeFileSync(process.argv[2], JSON.stringify({ root: process.pid, child: child.pid }))
);
setInterval(() => {}, 1000);
