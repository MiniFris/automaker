import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runDocker } from '@/services/execution-environment/docker-command.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
describe('managed Docker CLI transport', () => {
  let child: EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => {
        queueMicrotask(() => child.emit('close', null));
        return true;
      }),
    });
    mocks.spawn.mockReturnValue(child);
  });
  it('uses argv/stdin without host shell, preserving split UTF-8 output', async () => {
    const promise = runDocker(['exec', '-i', 'owned-id', 'node'], {
      input: '{"command":"touch $HOME"}',
    });
    const data = Buffer.from('Привет');
    child.stdout.write(data.subarray(0, 3));
    child.stdout.write(data.subarray(3));
    child.emit('close', 0);
    expect(await promise).toEqual({ code: 0, stdout: 'Привет', stderr: '' });
    expect(mocks.spawn).toHaveBeenCalledWith(
      'docker',
      ['exec', '-i', 'owned-id', 'node'],
      expect.objectContaining({ shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    );
    expect(child.stdin.read().toString()).toBe('{"command":"touch $HOME"}');
  });
  it('rejects cancellation before spawning', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runDocker(['info'], { signal: controller.signal })).rejects.toThrow();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it('kills a cancelled client and waits for close without claiming remote cleanup', async () => {
    const controller = new AbortController();
    const promise = runDocker(['exec', 'owned-id'], { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'DOCKER_INTERRUPTED' });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
  it('bounds combined stdout/stderr and reports client-start errors without raw diagnostics', async () => {
    const promise = runDocker(['build'], { maximum: 10 });
    child.stderr.write(Buffer.alloc(20));
    await expect(promise).rejects.toMatchObject({ code: 'DOCKER_OUTPUT_LIMIT' });
    const missing = runDocker(['info']);
    child.emit('error', new Error('secret private path'));
    child.emit('close', 1);
    await expect(missing).rejects.toMatchObject({ code: 'DOCKER_CLIENT_FAILED' });
  });
});
