import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runDockerDiagnostic } from '@/services/execution-environment/docker-diagnostics.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));

describe('Docker diagnostic subprocess boundary', () => {
  let child: EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  const args = ['info', '--format', '{{json .ServerVersion}}'];
  beforeEach(() => {
    child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => {
        queueMicrotask(() => child.emit('close', null));
        return true;
      }),
    });
    mocks.spawn.mockReturnValue(child);
  });
  it('spawns only the Docker CLI without shell or stdin', async () => {
    const promise = runDockerDiagnostic(args, new AbortController().signal);
    child.stdout.write('"28.0.0"');
    child.emit('close', 0);
    expect(await promise).toMatchObject({
      code: 0,
      stdout: '"28.0.0"',
      stderr: '',
      truncated: false,
    });
    expect(mocks.spawn).toHaveBeenCalledWith(
      'docker',
      args,
      expect.objectContaining({
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    );
  });
  it('does not spawn after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await runDockerDiagnostic(args, controller.signal)).code).toBeNull();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it('kills a cancelled probe and waits for process close', async () => {
    const controller = new AbortController();
    const promise = runDockerDiagnostic(args, controller.signal);
    controller.abort();
    await promise;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
  it('bounds combined output and stops an oversized probe', async () => {
    const promise = runDockerDiagnostic(args, new AbortController().signal);
    child.stderr.write(Buffer.alloc(40_000, 'x'));
    const result = await promise;
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdout + result.stderr)).toBeLessThanOrEqual(32_768);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
  it('reports missing CLI without exposing an exception message', async () => {
    const promise = runDockerDiagnostic(args, new AbortController().signal);
    child.emit('error', Object.assign(new Error('private-path'), { code: 'ENOENT' }));
    child.emit('close', -2);
    const result = await promise;
    expect(result.errorCode).toBe('ENOENT');
    expect(JSON.stringify(result)).not.toContain('private-path');
  });
});
