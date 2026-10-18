import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  diagnoseDockerConnection,
  type DockerCommandResult,
} from '@/services/execution-environment/docker-diagnostics.js';

describe('read-only Docker connection diagnostics', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });
  const good: DockerCommandResult = { code: 0, stdout: '"28.0.0"\n', stderr: '' };
  it('uses a bounded info call and never claims lifecycle/storage are ready', async () => {
    const runner = vi.fn().mockResolvedValue(good);
    const result = await diagnoseDockerConnection('desktop-linux', undefined, runner);
    expect(runner).toHaveBeenCalledWith(
      ['--context', 'desktop-linux', 'info', '--format', '{{json .ServerVersion}}'],
      expect.any(AbortSignal)
    );
    expect(result).toMatchObject({
      status: 'available',
      scope: 'connection-only',
      containerLifecycle: 'not-tested',
      projectStorage: 'not-tested',
    });
  });
  it('uses configured server CLI context by default rather than hardcoding a root socket', async () => {
    const runner = vi.fn().mockResolvedValue(good);
    await diagnoseDockerConnection(undefined, undefined, runner);
    expect(runner.mock.calls[0][0]).toEqual(['info', '--format', '{{json .ServerVersion}}']);
  });
  it.each([
    [{ ...good, code: null, errorCode: 'ENOENT' }, 'client-missing'],
    [{ ...good, code: null, errorCode: 'EACCES' }, 'permission-denied'],
    [
      { ...good, code: 1, stderr: 'permission denied while trying to connect' },
      'permission-denied',
    ],
    [
      { ...good, code: 1, stderr: 'authorization denied by plugin: forbidden' },
      'permission-denied',
    ],
    [{ ...good, code: 1, stderr: 'Cannot connect to the Docker daemon' }, 'unreachable'],
    [{ ...good, code: 1, stderr: 'context "gone": context not found' }, 'context-unavailable'],
    [{ ...good, stdout: 'not-json' }, 'invalid-response'],
    [{ ...good, stdout: 'null' }, 'invalid-response'],
    [{ ...good, stdout: '""' }, 'invalid-response'],
    [{ ...good, truncated: true }, 'invalid-response'],
    [{ ...good, code: 1, stderr: 'private-token-unknown-error' }, 'unavailable'],
  ] as const)('classifies failures without echoing raw output (%s)', async (output, status) => {
    const result = await diagnoseDockerConnection(undefined, undefined, async () => output);
    expect(result.status).toBe(status);
    expect(JSON.stringify(result)).not.toContain('private-token-unknown-error');
  });
  it('supplies the caller cancellation signal to the runner', async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = vi.fn(async (_args, signal: AbortSignal) => {
      expect(signal.aborted).toBe(true);
      return good;
    });
    expect((await diagnoseDockerConnection(undefined, controller.signal, runner)).status).toBe(
      'cancelled'
    );
  });
  it('classifies deadline expiry separately from user cancellation', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const result = await diagnoseDockerConnection(undefined, undefined, async (_args, signal) => {
      deadline.abort();
      expect(signal.aborted).toBe(true);
      return good;
    });
    expect(result.status).toBe('timeout');
  });
  it('provides container-specific instructions but no blanket permission workaround', async () => {
    vi.stubEnv('IS_CONTAINERIZED', 'true');
    const result = await diagnoseDockerConnection(undefined, undefined, async () => ({
      ...good,
      code: 1,
    }));
    expect(result.serverContainerized).toBe(true);
    expect(result.remediation.join(' ')).toContain('group_add');
    expect(result.remediation.join(' ')).toContain('Do not use chmod 666');
    expect(result.remediation.join(' ')).toContain('IS_CONTAINERIZED=true does not grant access');
  });
  it('rejects untrusted CLI options before starting a process', async () => {
    const runner = vi.fn();
    await expect(diagnoseDockerConnection('--host=evil', undefined, runner)).rejects.toThrow();
    expect(runner).not.toHaveBeenCalled();
  });
  it('sanitizes unexpected runner errors', async () => {
    const result = await diagnoseDockerConnection(undefined, undefined, async () => {
      throw new Error('private-key-material');
    });
    expect(result.status).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('private-key-material');
  });
});
