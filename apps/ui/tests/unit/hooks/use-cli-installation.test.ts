import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { useCliInstallation } from '@/components/views/setup-view/hooks/use-cli-installation';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
afterEach(cleanup);
const guidance = {
  success: true,
  requiresManualInstall: true,
  installationPerformed: false,
  installCommand: 'npm install -g @openai/codex',
  target: {
    kind: 'host-application',
    provider: 'codex',
    workingDirectory: '/backend',
    instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  },
} as const;

it.each([true, false])(
  'shows persistent manual instructions for success=%s without claiming installation',
  async (success) => {
    const onSuccess = vi.fn();
    const unsubscribe = vi.fn();
    const { result } = renderHook(() =>
      useCliInstallation({
        cliType: 'codex',
        installApi: vi.fn().mockResolvedValue({ ...guidance, success }),
        onSuccess,
        onProgressEvent: () => unsubscribe,
      })
    );
    await act(() => result.current.install());
    expect(result.current.isInstalling).toBe(false);
    expect(result.current.installProgress.output).toContain(guidance.installCommand);
    expect(result.current.installProgress.output.join('\n')).toContain('/backend');
    expect(toast.info).toHaveBeenCalledWith('Manual CLI installation required', expect.anything());
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  }
);

it('cleans subscriptions on request rejection and allows a retry', async () => {
  const unsubscribe = vi.fn();
  const installApi = vi
    .fn()
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValue(guidance);
  const { result } = renderHook(() =>
    useCliInstallation({ cliType: 'codex', installApi, onProgressEvent: () => unsubscribe })
  );
  await act(() => result.current.install());
  expect(toast.error).toHaveBeenCalledOnce();
  expect(result.current.isInstalling).toBe(false);
  await act(() => result.current.install());
  expect(installApi).toHaveBeenCalledTimes(2);
  expect(unsubscribe).toHaveBeenCalledTimes(2);
});

it('guards duplicate calls, aborts on unmount and ignores late results/events', async () => {
  let finish!: (value: typeof guidance) => void;
  let progress!: (value: { cli: string; data: string }) => void;
  const installApi = vi.fn(
    (_signal?: AbortSignal) =>
      new Promise<typeof guidance>((resolve) => {
        finish = resolve;
      })
  );
  const unsubscribe = vi.fn();
  const { result, unmount } = renderHook(() =>
    useCliInstallation({
      cliType: 'codex',
      installApi,
      onProgressEvent: (callback) => {
        progress = callback;
        return unsubscribe;
      },
    })
  );
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.install();
    void result.current.install();
  });
  expect(installApi).toHaveBeenCalledOnce();
  const signal = installApi.mock.calls[0][0]!;
  expect(signal.aborted).toBe(false);
  unmount();
  expect(signal.aborted).toBe(true);
  expect(unsubscribe).toHaveBeenCalledOnce();
  await act(async () => {
    progress({ cli: 'codex', data: 'late' });
    finish(guidance);
    await pending;
  });
  expect(toast.info).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it('ignores a previous request subscription while a new request is pending', async () => {
  const callbacks: Array<(value: { cli: string; data: string }) => void> = [];
  let finish!: (value: typeof guidance) => void;
  const installApi = vi
    .fn()
    .mockResolvedValueOnce(guidance)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
  const { result } = renderHook(() =>
    useCliInstallation({
      cliType: 'codex',
      installApi,
      onProgressEvent: (callback) => {
        callbacks.push(callback);
        return vi.fn();
      },
    })
  );
  await act(() => result.current.install());
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.install();
  });
  act(() => {
    callbacks[0]({ cli: 'codex', data: 'stale' });
    callbacks[1]({ cli: 'claude', data: 'other provider' });
    callbacks[1]({ cli: 'codex', data: 'current' });
  });
  expect(result.current.installProgress.output).toEqual(['current']);
  await act(async () => {
    finish(guidance);
    await pending;
  });
});

it.each([
  { performed: undefined, detected: true, confirmed: false },
  { performed: true, detected: false, confirmed: false },
  { performed: true, detected: true, confirmed: true },
])(
  'requires both an explicit performed result and refreshed detection: %s',
  async ({ performed, detected, confirmed }) => {
    let installed = false;
    const onSuccess = vi.fn(async () => {
      installed = detected;
    });
    const { result } = renderHook(() =>
      useCliInstallation({
        cliType: 'codex',
        installApi: vi.fn().mockResolvedValue({ success: true, installationPerformed: performed }),
        onSuccess,
        getStoreState: () => ({ installed }) as never,
      })
    );
    await act(() => result.current.install());
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledTimes(confirmed ? 1 : 0);
    expect(toast.info).toHaveBeenCalledTimes(confirmed ? 0 : 1);
  }
);
