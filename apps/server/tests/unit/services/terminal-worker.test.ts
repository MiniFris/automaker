import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TERMINAL_WORKER } from '@/services/execution-environment/terminal-worker.js';

describe.skipIf(process.platform !== 'linux')('real target-side interactive PTY supervisor', () => {
  let root: string;
  const children: ChildProcessWithoutNullStreams[] = [];
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "terminal-worker-'"));
  });
  afterEach(async () => {
    for (const child of children.splice(0)) {
      child.stdin.end();
      await vi.waitFor(() => expect(child.exitCode).not.toBeNull(), { timeout: 5000 });
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  const start = (options: object = {}) => {
    const child = spawn(
      'python3',
      ['-u', '-c', TERMINAL_WORKER, JSON.stringify({ cwd: root, cols: 80, rows: 24, ...options })],
      {
        env: { PATH: process.env.PATH, HOME: root, LANG: 'C.UTF-8' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    children.push(child);
    let pending = '',
      output = '';
    const frames: Array<{ type: string; exitCode?: number; message?: string }> = [];
    child.stdout.on('data', (data) => {
      pending += data.toString();
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const frame = JSON.parse(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        frames.push(frame);
        if (frame.type === 'data') output += Buffer.from(frame.data, 'base64').toString();
      }
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    const send = (value: object) => child.stdin.write(JSON.stringify(value) + '\n');
    return {
      child,
      frames,
      send,
      text: () => output,
      input: (value: string) =>
        send({ type: 'input', data: Buffer.from(value).toString('base64') }),
    };
  };
  const ready = async (worker: ReturnType<typeof start>) =>
    vi.waitFor(() => expect(worker.frames[0]?.type).toBe('ready'));
  const gone = async (pid: number) => {
    await vi.waitFor(async () => {
      await expect(fs.stat(`/proc/${pid}`)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  };
  it('executes a noninteractive supervised command with CI env and its exact exit status', async () => {
    const worker = start({
      shell: '/bin/sh',
      command: "printf '%s\\n' \"$CI\"; printf 'COMMAND_TAIL\\n'; exit 7",
    });
    await vi.waitFor(() =>
      expect(worker.frames.at(-1)).toMatchObject({ type: 'exit', exitCode: 7 })
    );
    expect(worker.text()).toContain('true');
    expect(worker.text()).toContain('COMMAND_TAIL');
  });
  it('keeps supervising a command that redirects/closes all stdio until its real exit', async () => {
    const worker = start({
      shell: '/bin/sh',
      command: 'exec 0>&- 1>&- 2>&-; sleep 0.3; printf finished > redirected-result; exit 7',
    });
    await vi.waitFor(() =>
      expect(worker.frames.at(-1)).toMatchObject({ type: 'exit', exitCode: 7 })
    );
    expect(await fs.readFile(path.join(root, 'redirected-result'), 'utf8')).toBe('finished');
  });
  it('provides a controlling TTY, correct cwd, terminal env and initial size', async () => {
    const worker = start();
    await ready(worker);
    worker.input(
      "test -t 0 && test -t 1 && printf 'PTY_OK\\n'; pwd; stty size; printf '%s\\n' \"$TERM\"\n"
    );
    await vi.waitFor(() => {
      expect(worker.text()).toContain('PTY_OK\r\n');
      expect(worker.text()).toContain('24 80');
      expect(worker.text()).toContain(root);
      expect(worker.text()).toContain('xterm-256color');
    });
    worker.send({ type: 'close' });
    await vi.waitFor(() => expect(worker.frames.at(-1)?.type).toBe('exit'));
  });
  it('resizes, handles Unicode input and preserves the shell exit status/final output', async () => {
    const worker = start();
    await ready(worker);
    worker.send({ type: 'resize', cols: 131, rows: 39 });
    worker.input("stty size; printf 'Готово\\n'; exit 7\n");
    await vi.waitFor(() =>
      expect(worker.frames.at(-1)).toMatchObject({ type: 'exit', exitCode: 7 })
    );
    expect(worker.text()).toContain('39 131');
    expect(worker.text()).toContain('Готово');
  });
  it('delivers Ctrl-C to a foreground job and leaves the shell usable', async () => {
    const worker = start();
    await ready(worker);
    worker.input("printf 'START_JOB\\n'; sleep 30\n");
    await vi.waitFor(() => expect(worker.text()).toContain('START_JOB\r\n'));
    worker.input('\x03');
    worker.input("printf 'INTERRUPTED_OK\\n'\n");
    await vi.waitFor(() => expect(worker.text()).toContain('INTERRUPTED_OK\r\n'));
  });
  it('confirms close only after cleaning up foreground/background session jobs', async () => {
    const worker = start();
    await ready(worker);
    worker.input('for i in {1..25}; do sleep 30 & echo $! >> background.pid; done\n');
    await vi.waitFor(async () =>
      expect(
        (await fs.readFile(path.join(root, 'background.pid'), 'utf8')).trim().split('\n')
      ).toHaveLength(25)
    );
    const pids = (await fs.readFile(path.join(root, 'background.pid'), 'utf8'))
      .trim()
      .split('\n')
      .map(Number);
    worker.send({ type: 'close' });
    await vi.waitFor(() => expect(worker.frames.at(-1)?.type).toBe('exit'));
    for (const pid of pids) await gone(pid);
  });
  it('cleans up when stdin disappears, without replaying input', async () => {
    const worker = start();
    await ready(worker);
    worker.input('echo once >> effects; sleep 30\n');
    await vi.waitFor(async () =>
      expect(await fs.readFile(path.join(root, 'effects'), 'utf8')).toBe('once\n')
    );
    worker.child.stdin.end();
    await vi.waitFor(() => expect(worker.child.exitCode).toBe(0));
    expect(await fs.readFile(path.join(root, 'effects'), 'utf8')).toBe('once\n');
  });
  it(
    'expires an open but abandoned transport and removes its activity lease',
    { timeout: 22000 },
    async () => {
      const jobs = path.join(root, 'jobs');
      const worker = start({ jobs, id: 'fixture' });
      await ready(worker);
      worker.input('sleep 60 & echo $! > background.pid\n');
      await vi.waitFor(async () =>
        expect(await fs.readFile(path.join(root, 'background.pid'), 'utf8')).toMatch(/\d+/)
      );
      const pid = Number(await fs.readFile(path.join(root, 'background.pid'), 'utf8'));
      await vi.waitFor(() => expect(worker.child.exitCode).toBe(0), { timeout: 18000 });
      expect(worker.frames.at(-1)).toMatchObject({
        type: 'failure',
        message: expect.stringContaining('heartbeat'),
      });
      await gone(pid);
      expect(await fs.readdir(jobs)).toEqual(['fixture.done']);
    }
  );
  it.each([{ shell: '/tmp/not-a-shell' }, { cols: 0 }, { rows: 501 }])(
    'rejects invalid requests without a successful terminal handshake (%j)',
    async (options) => {
      const worker = start(options);
      await vi.waitFor(() => expect(worker.frames.at(-1)?.type).toBe('failure'));
      expect(worker.frames.some((frame) => frame.type === 'ready')).toBe(false);
    }
  );
});
