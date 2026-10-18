import { describe, expect, it, vi } from 'vitest';
import { environmentJSONL } from '@/providers/environment-jsonl.js';
import { remoteCliRuntime } from '@/providers/environment-execution.js';
import { WorkerStream } from '@/services/execution-environment/worker-stream.js';
import {
  ExecutionEnvironmentError,
  type ExecutionEnvironment,
} from '@/services/execution-environment/runtime.js';

const options = {
  command: 'cursor-agent',
  args: ['-p'],
  cwd: '/remote',
  stdinData: '$(not-a-shell)',
};
const fake = (runProcess: NonNullable<ExecutionEnvironment['runProcess']>) =>
  ({ type: 'ssh', runProcess }) as ExecutionEnvironment;

describe('remote provider streaming protocol', () => {
  it('forwards configured process and idle budgets without a hidden ten-minute maximum', async () => {
    const run = vi.fn<NonNullable<ExecutionEnvironment['runProcess']>>(async () => ({
      exitCode: 0,
    }));
    const query = environmentJSONL(fake(run), { ...options, timeout: 900_000 }, 3_600_000);
    expect((await query.next()).done).toBe(true);
    expect(run.mock.calls[0][0]).toMatchObject({ timeoutMs: 3_600_000, idleTimeoutMs: 900_000 });
  });
  it('decodes fragmented worker frames and keeps CLI JSON separate from the worker result', () => {
    const output = vi.fn();
    const stream = new WorkerStream(output);
    const cli = Buffer.from('{"ok":false,"text":"Привет"}\n');
    const data = Buffer.from(
      JSON.stringify({ stream: 'stdout', data: cli.toString('base64') }) +
        '\n' +
        JSON.stringify({ ok: true, value: { exitCode: 0 } }) +
        '\n'
    );
    for (let index = 0; index < data.length; index++) stream.push(data.subarray(index, index + 1));
    expect(output).toHaveBeenCalledWith('stdout', cli);
    expect(JSON.parse(stream.finish())).toEqual({ ok: true, value: { exitCode: 0 } });
  });
  it('rejects malformed, oversized, incomplete and trailing worker frames', () => {
    for (const text of [
      'not-json\n',
      '{"stream":"stdout","data":"%%%"}\n',
      JSON.stringify({ ok: true }) + '\n{}\n',
      'x'.repeat(100001),
    ])
      expect(() => new WorkerStream(() => {}).push(Buffer.from(text))).toThrow();
    expect(() => new WorkerStream(() => {}).finish()).toThrow();
  });
  it('yields before process completion, handles split UTF-8 and uses argv/stdin only', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn<NonNullable<ExecutionEnvironment['runProcess']>>(
      async (request, _signal, output) => {
        expect(request).toMatchObject({
          command: options.command,
          args: options.args,
          stdin: options.stdinData,
        });
        expect(request).not.toHaveProperty('env');
        const data = Buffer.from('{"text":"Привет"}\n');
        const middle = data.indexOf(Buffer.from('П')) + 1;
        output('stdout', data.subarray(0, middle));
        output('stdout', data.subarray(middle));
        await held;
        output('stdout', Buffer.from('{"done":true}'));
        return { exitCode: 0 };
      }
    );
    const query = environmentJSONL(fake(run), options);
    expect(await query.next()).toEqual({ done: false, value: { text: 'Привет' } });
    release();
    expect(await query.next()).toEqual({ done: false, value: { done: true } });
    expect((await query.next()).done).toBe(true);
  });
  it('bounds stderr and reports nonzero exits without logging it', async () => {
    const query = environmentJSONL(
      fake(async (_request, _signal, output) => {
        output('stderr', Buffer.alloc(100000, 120));
        return { exitCode: 7 };
      }),
      options
    );
    await expect(query.next()).rejects.toMatchObject({ exitCode: 7, stderr: 'x'.repeat(65536) });
  });
  it('awaits remote cleanup when a consumer stops reading and propagates unknown outcomes', async () => {
    for (const code of ['PROCESS_INTERRUPTED', 'SSH_OUTCOME_UNKNOWN']) {
      let cleaned = false;
      const query = environmentJSONL(
        fake(async (_request, signal, output) => {
          output('stdout', Buffer.from('{"started":true}\n'));
          await new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => setTimeout(resolve, 15), { once: true })
          );
          cleaned = true;
          throw new ExecutionEnvironmentError(code, 'fixture cleanup');
        }),
        options
      );
      expect((await query.next()).value).toEqual({ started: true });
      if (code === 'SSH_OUTCOME_UNKNOWN')
        await expect(query.return(undefined)).rejects.toMatchObject({ code });
      else await query.return(undefined);
      expect(cleaned).toBe(true);
    }
  });
  it('rejects invalid JSONL and excessive buffering rather than dropping output', async () => {
    for (const text of ['not-json\n', JSON.stringify({ text: 'x'.repeat(1100000) }) + '\n']) {
      const query = environmentJSONL(
        fake(async (_request, _signal, output) => {
          output('stdout', Buffer.from(text));
          return { exitCode: 0 };
        }),
        options
      );
      await expect(query.next()).rejects.toMatchObject({ code: 'PROCESS_JSONL_INVALID' });
    }
  });
  it('refuses unissued runtime objects instead of falling back to host execution', () => {
    expect(() =>
      remoteCliRuntime({
        ...options,
        prompt: 'x',
        model: 'auto',
        executionEnvironmentRuntime: { type: 'ssh' },
      })
    ).toThrow('not issued');
    expect(() =>
      remoteCliRuntime({
        ...options,
        prompt: 'x',
        model: 'auto',
        executionEnvironmentBinding: { type: 'ssh' } as never,
      })
    ).toThrow('Host execution was refused');
  });
});
