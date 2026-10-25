import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LegacyCredentialImport } from '@/components/shared/legacy-credential-import';
import { setUiLocale } from '@/lib/i18n';
const api = vi.hoisted(() => ({ read: vi.fn(), store: vi.fn() }));
vi.mock('@/lib/storage', () => ({ getItem: api.read }));
vi.mock('@/lib/http-api-client', () => ({
  getHttpApiClient: () => ({ setup: { storeApiKey: api.store } }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  setUiLocale('en');
  api.read.mockReturnValue(
    JSON.stringify({ state: { apiKeys: { google: 'opaque-private-legacy-fixture-12345' } } })
  );
});
afterEach(cleanup);
it('does not inspect or mutate credentials on mount', () => {
  render(<LegacyCredentialImport />);
  expect(api.read).not.toHaveBeenCalled();
  expect(api.store).not.toHaveBeenCalled();
});
it('does not expose key values and only imports an explicitly selected provider', async () => {
  const refreshed = vi.fn();
  api.store.mockResolvedValue({ success: true });
  render(<LegacyCredentialImport onImported={refreshed} />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect legacy browser keys' }));
  expect(document.body.textContent).not.toContain('opaque-private-legacy');
  expect(api.store).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Import legacy google key' }));
  await screen.findByText('Imported; authentication not checked');
  expect(api.store).toHaveBeenCalledExactlyOnceWith(
    'google',
    'opaque-private-legacy-fixture-12345'
  );
  expect(refreshed).toHaveBeenCalledOnce();
});
it('keeps the candidate available after native cancellation without a false import result', async () => {
  api.store.mockResolvedValue({ success: false });
  const refreshed = vi.fn();
  render(<LegacyCredentialImport onImported={refreshed} />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect legacy browser keys' }));
  const button = screen.getByRole('button', { name: 'Import legacy google key' });
  fireEvent.click(button);
  await waitFor(() => expect(button).toBeEnabled());
  expect(screen.queryByText('Imported; authentication not checked')).not.toBeInTheDocument();
  expect(refreshed).not.toHaveBeenCalled();
});
