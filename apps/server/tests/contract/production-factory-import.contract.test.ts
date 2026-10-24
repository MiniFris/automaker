import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

it('imports the factory in a production process without bootstrapping or loading .env', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-production-import-'));
  await writeFile(path.join(directory, '.env'), 'AUTOMAKER_IMPORT_SIDE_EFFECT=must-not-load\n');
  const source = pathToFileURL(path.resolve(import.meta.dirname, '../../src/main.ts')).href;
  const loader = import.meta.resolve('tsx');
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    DATA_DIR: directory,
    PORT: '0',
    TSX_TSCONFIG_PATH: path.resolve(import.meta.dirname, '../../tsconfig.json'),
  };
  for (const name of Object.keys(environment))
    if (name.startsWith('VITEST')) delete environment[name];
  delete environment.AUTOMAKER_RUN_MAIN;
  delete environment.AUTOMAKER_IMPORT_SIDE_EFFECT;
  const child = spawn(
    process.execPath,
    [
      '--import',
      loader,
      '--input-type=module',
      '--eval',
      `
    const before = { ...process.env };
    const rejection = process.listeners('unhandledRejection');
    const exception = process.listeners('uncaughtException');
    const signals = process.listeners('SIGTERM');
    const imported = await import(${JSON.stringify(source)});
    const unchanged = JSON.stringify(before) === JSON.stringify(process.env);
    const same = (a,b) => a.length === b.length && a.every((item,index) => item === b[index]);
    console.log(JSON.stringify({ factory: typeof imported.createNestApplication,
      unchanged, rejection: same(rejection, process.listeners('unhandledRejection')),
      exception: same(exception, process.listeners('uncaughtException')),
      signals: same(signals, process.listeners('SIGTERM')) }));
  `,
    ],
    { cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let output = '',
    stderr = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 6000);
  try {
    expect(await exited, stderr).toBe(0);
    expect(JSON.parse(output.trim())).toEqual({
      factory: 'function',
      unchanged: true,
      rejection: true,
      exception: true,
      signals: true,
    });
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 10_000);
