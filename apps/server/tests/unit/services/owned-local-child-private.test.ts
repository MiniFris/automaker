import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { createOwnedLocalChild } from '../../../src/services/owned-local-child.js';
import { parseLinuxProcessStat } from '../../../src/core/platform/linux-process-group.js';

// Every process here is a private fixture, without ports or external commands.
// Fixture self-expiry also bounds cleanup if the supervisor under test fails.
function launch(resistant: boolean) {
  const descendant = `process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),${resistant ? 4000 : 800});setInterval(()=>{},100);`;
  const script = `
    const {spawn}=require('node:child_process');
    const worker=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});
    worker.once('spawn',()=>setTimeout(()=>process.send({worker:worker.pid}),80));
    process.on('message',()=>process.exit(0));
    setTimeout(()=>process.exit(0),4500);
  `;
  const child = spawn(process.execPath, ['-e', script], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const message = new Promise<{ worker: number }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Private child startup timed out.')), 2000);
    child.once('message', (value) => {
      clearTimeout(timer);
      resolve(value as { worker: number });
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return { child, message };
}
async function terminated(pid: number) {
  await vi.waitFor(
    async () => {
      try {
        expect(['Z', 'X', 'x']).toContain(
          parseLinuxProcessStat(await readFile(`/proc/${pid}/stat`, 'utf8')).state
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },
    { timeout: 5000 }
  );
}
function traceOwnedSignals(child: ChildProcess) {
  const kill = process.kill.bind(process);
  const sent: (string | number | undefined)[] = [];
  const spy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (pid !== -child.pid!) throw new Error('Fixture refused an unowned signal target.');
    if (signal !== 0) sent.push(signal);
    return kill(pid, signal);
  });
  return { sent, spy };
}

it('confirms no resource after a real missing-executable spawn error without signalling', async () => {
  const child = spawn(path.join(os.tmpdir(), `automaker-private-missing-${randomUUID()}`), [], {
    detached: true,
    stdio: 'ignore',
  });
  const kill = vi.spyOn(child, 'kill');
  const signal = vi.spyOn(process, 'kill').mockImplementation(() => {
    throw new Error('No fixture child was created.');
  });
  try {
    const owner = createOwnedLocalChild(child, { cleanupTimeoutMs: 500 });
    await expect(owner.ready()).rejects.toMatchObject({ code: 'LOCAL_PROCESS_CLEANUP_FAILED' });
    const closed = owner.close();
    await closed;
    await owner.completion();
    expect(owner.close()).toBe(closed);
    expect(child.pid).toBeUndefined();
    expect(kill).not.toHaveBeenCalled();
    expect(signal).not.toHaveBeenCalled();
  } finally {
    signal.mockRestore();
    kill.mockRestore();
  }
});

it.skipIf(process.platform !== 'linux')(
  'captures a TERM-resistant descendant before signalling, then escalates after natural leader exit',
  async () => {
    const { child, message } = launch(true);
    const owner = createOwnedLocalChild(child, { cleanupTimeoutMs: 2000, termGraceMs: 60 });
    let worker: number | undefined;
    const trace = traceOwnedSignals(child);
    try {
      await owner.ready();
      worker = (await message).worker;
      await owner.close();
      await owner.completion();
      expect(trace.sent).toEqual(['SIGTERM', 'SIGKILL']);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      await terminated(worker);
    } finally {
      trace.spy.mockRestore();
      await owner.close().catch(() => {});
      if (worker) await terminated(worker);
      if (child.connected) child.disconnect();
    }
  }
);

it.skipIf(process.platform !== 'linux')(
  'retains unknown early-root cleanup without acquiring post-exit signal authority',
  async () => {
    const { child, message } = launch(false);
    const owner = createOwnedLocalChild(child, { cleanupTimeoutMs: 150, termGraceMs: 30 });
    let worker: number | undefined;
    const trace = traceOwnedSignals(child);
    try {
      await owner.ready();
      worker = (await message).worker;
      child.send('natural-exit');
      await expect(owner.completion()).rejects.toMatchObject({
        code: 'LOCAL_PROCESS_CLEANUP_FAILED',
      });
      expect(trace.sent).toEqual([]);
      await terminated(worker);
      await expect(owner.close()).rejects.toMatchObject({ code: 'LOCAL_PROCESS_CLEANUP_FAILED' });
    } finally {
      trace.spy.mockRestore();
      await owner.close().catch(() => {});
      if (worker) await terminated(worker);
      if (child.connected) child.disconnect();
    }
  }
);
