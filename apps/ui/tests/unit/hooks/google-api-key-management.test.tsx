import {
  act,
  cleanup,
  renderHook,
  waitFor,
  render,
  screen,
  fireEvent,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useApiKeyManagement } from '@/components/views/settings-view/api-keys/hooks/use-api-key-management';
import { setUiLocale } from '@/lib/i18n';
import { GeminiCredentialsForm } from '@/components/shared/gemini-credentials-form';

const state = vi.hoisted(() => ({
  keys: { anthropic: '', google: '', openai: '', zai: '' },
  store: vi.fn(),
  setKeys: vi.fn(),
  setZai: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('@/store/app-store', () => ({
  useAppStore: () => ({ apiKeys: state.keys, setApiKeys: state.setKeys }),
}));
vi.mock('@/store/setup-store', () => ({
  useSetupStore: () => ({ setZaiAuthStatus: state.setZai, zaiAuthStatus: null }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
}));
vi.mock('@/lib/http-api-client', () => ({
  getHttpApiClient: () => ({ setup: { storeApiKey: state.store } }),
}));
vi.mock('@/lib/electron', () => ({
  getElectronAPI: () => ({
    setup: {
      getApiKeys: async () => ({
        success: true,
        hasAnthropicKey: false,
        hasGoogleKey: false,
        hasOpenaiKey: false,
      }),
    },
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  setUiLocale('en');
  state.store.mockResolvedValue({ success: false });
});
afterEach(cleanup);

it('does not invoke a native Google-key command for a hidden legacy value during global Save', async () => {
  const { result } = renderHook(useApiKeyManagement);
  await waitFor(() => expect(result.current.apiKeyStatus).not.toBeNull());
  act(() => result.current.providerConfigParams.google.setValue('hidden-legacy-google-fixture'));
  vi.useFakeTimers();
  try {
    await act(async () => {
      await result.current.handleSave();
    });
    expect(state.store).not.toHaveBeenCalled();
    act(() => vi.runOnlyPendingTimers());
  } finally {
    vi.useRealTimers();
  }
});

it('never reports a successful Gemini connection test from key shape alone', async () => {
  const { result } = renderHook(useApiKeyManagement);
  await waitFor(() => expect(result.current.apiKeyStatus).not.toBeNull());
  act(() => result.current.providerConfigParams.google.setValue('opaque-google-fixture-123456'));
  await act(async () => {
    await result.current.providerConfigParams.google.onTest();
  });
  expect(result.current.providerConfigParams.google.result).toMatchObject({ success: false });
  expect(result.current.providerConfigParams.google.result?.message).toContain(
    'does not verify authentication'
  );
  expect(state.store).not.toHaveBeenCalled();
  expect(state.setKeys).not.toHaveBeenCalled();
});
it('requires native Google-key persistence and does not report cancellation as a saved browser update', async () => {
  const changed = vi.fn();
  render(<GeminiCredentialsForm configured={false} onChanged={changed} />);
  const input = screen.getByLabelText('Gemini API key');
  fireEvent.change(input, { target: { value: 'opaque-google-fixture-123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save API Key' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save API Key' })).toBeEnabled());
  expect(state.store).toHaveBeenCalledWith('google', 'opaque-google-fixture-123456');
  expect(state.setKeys).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  expect(input).toHaveValue('opaque-google-fixture-123456');
});
