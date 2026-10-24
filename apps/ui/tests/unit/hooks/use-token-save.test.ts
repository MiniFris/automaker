import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useTokenSave } from '@/components/views/setup-view/hooks/use-token-save';
const mocks = vi.hoisted(() => ({ api: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/electron', () => ({ getElectronAPI: mocks.api }));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
it('does not report success or activate local state when credential persistence is unavailable', async () => {
  mocks.api.mockReturnValue({ setup: {} });
  const onSuccess = vi.fn();
  const { result } = renderHook(() => useTokenSave({ provider: 'openai', onSuccess }));
  let saved: boolean | undefined;
  await act(async () => {
    saved = await result.current.saveToken('sk-offline-private-123456');
  });
  expect(saved).toBe(false);
  expect(onSuccess).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
});
it('does not activate local state after a cancelled/failed native command', async () => {
  mocks.api.mockReturnValue({
    setup: { storeApiKey: async () => ({ success: false, error: 'cancelled' }) },
  });
  const onSuccess = vi.fn();
  const { result } = renderHook(() => useTokenSave({ provider: 'openai', onSuccess }));
  await act(async () => {
    expect(await result.current.saveToken('sk-offline-private-123456')).toBe(false);
  });
  expect(onSuccess).not.toHaveBeenCalled();
});
