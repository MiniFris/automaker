import { it, expect, vi } from 'vitest';
import { executeRemoteSdk } from '@/providers/remote-sdk.js';
import {
  ExecutionEnvironmentError,
  issueEnvironment,
  type ExecutionEnvironment,
} from '@/services/execution-environment/runtime.js';
import type { ExecuteOptions } from '@automaker/types';

const result = { type: 'result', subtype: 'success', session_id: 'session' };
function options(run: NonNullable<ExecutionEnvironment['runProcess']>): ExecuteOptions {
  const runtime = issueEnvironment({
    type: 'ssh',
    cwd: '/target',
    runProcess: vi.fn(run),
  } as unknown as ExecutionEnvironment);
  return {
    cwd: '/controller',
    model: 'sonnet',
    prompt: 'Work',
    executionEnvironmentRuntime: runtime,
  };
}
it('withholds a successful result until SDK completion and remote process cleanup are confirmed', async () => {
  let release!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  const query = executeRemoteSdk(
    'claude',
    options(async (_request, _signal, output) => {
      output('stdout', Buffer.from(JSON.stringify({ kind: 'event', event: result }) + '\n'));
      await cleanup;
      output('stdout', Buffer.from('{"kind":"complete"}\n'));
      return { exitCode: 0 };
    })
  );
  let returned = false;
  const pending = query.next().then((value) => {
    returned = true;
    return value;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(returned).toBe(false);
  release();
  expect((await pending).value).toMatchObject(result);
  expect((await query.next()).done).toBe(true);
});
it('never reports success after a cleanup failure', async () => {
  const query = executeRemoteSdk(
    'claude',
    options(async (_request, _signal, output) => {
      output(
        'stdout',
        Buffer.from(JSON.stringify({ kind: 'event', event: result }) + '\n{"kind":"complete"}\n')
      );
      throw new ExecutionEnvironmentError('PROCESS_CLEANUP_FAILED', 'cleanup failed');
    })
  );
  await expect(query.next()).rejects.toMatchObject({ code: 'PROCESS_CLEANUP_FAILED' });
});
it.each([
  [{ kind: 'event', event: result }],
  [{ kind: 'complete' }],
  [
    { kind: 'event', event: { type: 'result', subtype: 'error_during_execution', is_error: true } },
    { kind: 'complete' },
  ],
])('refuses incomplete or unsuccessful SDK turns', async (frames) => {
  const query = executeRemoteSdk(
    'claude',
    options(async (_request, _signal, output) => {
      output('stdout', Buffer.from(frames.map((frame) => JSON.stringify(frame)).join('\n') + '\n'));
      return { exitCode: 0 };
    })
  );
  await expect(query.next()).rejects.toThrow();
});
it('serializes only target SDK controls, never controller credentials or runtime descriptors', async () => {
  const run = vi.fn<NonNullable<ExecutionEnvironment['runProcess']>>(
    async (request, _signal, output) => {
      expect(request.stdin).not.toContain('controller-secret');
      const payload = JSON.parse(request.stdin!);
      expect(payload.options).not.toHaveProperty('credentials');
      expect(payload.options).not.toHaveProperty('executionEnvironmentRuntime');
      expect(payload.options).toMatchObject({ prompt: 'Work', model: 'sonnet', sandboxed: false });
      output(
        'stdout',
        Buffer.from(JSON.stringify({ kind: 'event', event: result }) + '\n{"kind":"complete"}\n')
      );
      return { exitCode: 0 };
    }
  );
  const opts = options(run);
  opts.credentials = { anthropicApiKey: 'controller-secret' };
  const query = executeRemoteSdk('claude', opts);
  expect((await query.next()).value?.type).toBe('result');
  await query.return(undefined);
});
it('rejects unsupported Copilot read-only controls before spawning anything', async () => {
  const run = vi.fn();
  const opts = { ...options(run), readOnly: true };
  await expect(executeRemoteSdk('copilot', opts).next()).rejects.toMatchObject({
    code: 'REMOTE_PROVIDER_READ_ONLY_UNSUPPORTED',
  });
  expect(run).not.toHaveBeenCalled();
});
