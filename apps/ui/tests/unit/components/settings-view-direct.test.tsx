import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from '@/components/views/settings-view';

const mocks = vi.hoisted(() => ({
  search: { view: 'api-keys' },
  list: vi.fn(),
  inspectEnvironment: vi.fn(),
  store: { disabledProviders: [] as string[], currentProject: null },
}));
vi.mock('@tanstack/react-router', () => ({ useSearch: () => mocks.search }));
vi.mock('@/store/app-store', () => ({
  useAppStore: (selector?: (state: typeof mocks.store) => unknown) =>
    selector ? selector(mocks.store) : mocks.store,
}));
vi.mock('@/lib/http-api-client', () => ({
  getHttpApiClient: () => ({
    directEndpoints: { list: mocks.list },
    modelTimeouts: { getProvider: async () => ({ success: true, timeouts: {} }) },
    executionEnvironments: { inspect: mocks.inspectEnvironment },
  }),
}));
vi.mock('@/components/views/settings-view/api-keys/api-keys-section', () => ({
  ApiKeysSection: () => <div>API keys section</div>,
}));
vi.mock('@/components/views/settings-view/components/import-export-dialog', () => ({
  ImportExportDialog: () => null,
}));
vi.mock('@/components/views/settings-view/components/keyboard-map-dialog', () => ({
  KeyboardMapDialog: () => null,
}));

describe('Direct API in the actual settings page', () => {
  let client: QueryClient;
  beforeEach(() => {
    mocks.search.view = 'api-keys';
    mocks.list.mockResolvedValue({
      success: true,
      endpoints: [],
      agentSettings: { access: 'read-only' },
    });
    mocks.inspectEnvironment.mockResolvedValue({
      success: true,
      settings: { default: { mode: 'local' }, profiles: [] },
      projectOverride: null,
      resolved: {
        selection: { mode: 'local' },
        type: 'local',
        source: 'global',
        runtimeIntegrated: false,
      },
    });
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(localStorage.getItem).mockReturnValue(null);
  });
  afterEach(() => {
    cleanup();
    client.clear();
  });

  function open() {
    render(
      <QueryClientProvider client={client}>
        <SettingsView />
      </QueryClientProvider>
    );
  }

  it('opens execution environment settings through the real global sidebar', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Execution Environment' }));
    expect(
      await screen.findByRole('combobox', { name: 'Default execution environment' })
    ).toHaveTextContent('Local — Automaker server environment');
    expect(mocks.inspectEnvironment).toHaveBeenCalledWith(undefined);
  });

  it('opens the endpoint editor from the AI Providers sidebar', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Direct API (OpenAI-compatible)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add direct endpoint' }));
    expect(screen.getByLabelText('API base URL')).toBeInTheDocument();
    expect(screen.getByLabelText(/New API key/)).toHaveValue('');
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it('opens the form via /settings?view=direct-provider', async () => {
    mocks.search.view = 'direct-provider';
    open();
    expect(await screen.findByRole('button', { name: 'Add direct endpoint' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Direct API (OpenAI-compatible)' })
    ).toBeInTheDocument();
  });

  it('keeps the provider accessible when the provider menu was previously collapsed', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue('false');
    open();
    expect(
      screen.queryByRole('button', { name: 'Direct API (OpenAI-compatible)' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'AI Providers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Direct API (OpenAI-compatible)' }));
    expect(await screen.findByRole('button', { name: 'Add direct endpoint' })).toBeInTheDocument();
  });
});
