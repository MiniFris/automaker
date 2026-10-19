import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenAICompatibleEndpoint } from '@automaker/types';
import { DirectSettingsTab } from '@/components/views/settings-view/providers/direct-settings-tab';
import { DIRECT_ENDPOINTS_QUERY_KEY } from '@/hooks/queries/use-direct-endpoints';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  models: vi.fn(),
  test: vi.fn(),
  saveAgent: vi.fn(),
}));
const timeouts = vi.hoisted(() => ({
  getProvider: vi.fn().mockResolvedValue({ success: true, timeouts: {} }),
  saveProvider: vi.fn(),
}));
vi.mock('@/lib/http-api-client', () => ({
  getHttpApiClient: () => ({ directEndpoints: api, modelTimeouts: timeouts }),
}));

describe('direct provider settings UI / write-only secrets', () => {
  let client: QueryClient;
  let endpoint: OpenAICompatibleEndpoint;
  const dto = () => ({
    success: true,
    endpoints: [{ endpoint, keyConfigured: true }],
    agentSettings: { access: 'read-only' as const },
  });
  beforeEach(() => {
    timeouts.getProvider.mockResolvedValue({ success: true, timeouts: {} });
    endpoint = {
      id: 'local',
      name: 'Local endpoint',
      enabled: true,
      baseUrl: 'http://localhost:1234/v1/',
      protocol: 'chat-completions',
      auth: { type: 'credentials', credentialId: 'local' },
      models: [],
    };
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    api.list.mockResolvedValue(dto());
    api.save.mockImplementation(async (saved) => {
      endpoint = saved;
      return dto();
    });
    api.remove.mockResolvedValue({ ...dto(), endpoints: [] });
    api.models.mockResolvedValue({ success: true, models: ['Vendor/Case:Tag', 'direct-Exact/ID'] });
    api.test.mockResolvedValue({ success: true, verified: true });
    api.saveAgent.mockImplementation(async (settings) => ({ ...dto(), agentSettings: settings }));
  });
  afterEach(() => {
    cleanup();
    client.clear();
    vi.restoreAllMocks();
  });
  async function open() {
    render(
      <QueryClientProvider client={client}>
        <DirectSettingsTab />
      </QueryClientProvider>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await screen.findByTestId('direct-endpoint-editor');
  }

  it('does not populate the key field, and metadata edits do not send a masked key', async () => {
    await open();
    expect(screen.getByLabelText(/New API key/)).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save endpoint' }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Renamed' }),
        undefined,
        undefined
      )
    );
  });

  it('has no shared control and does not duplicate connection fields in Direct task settings', async () => {
    await open();
    expect(screen.queryByText(/Shared model timeouts/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Direct task timeouts'));
    await screen.findByLabelText('Verification command timeout (seconds)');
    expect(screen.getAllByLabelText('Request timeout (seconds)')).toHaveLength(1);
    expect(screen.getAllByLabelText('Response headers timeout (seconds)')).toHaveLength(1);
    expect(timeouts.getProvider).toHaveBeenCalledWith('openai-compatible');
  });

  it('edits endpoint timeout overrides in seconds while preserving the existing request field', async () => {
    endpoint.timeoutMs = 120_000;
    endpoint.timeouts = { responseHeadersTimeoutMs: 30_000 };
    api.list.mockResolvedValue(dto());
    await open();
    expect(screen.getByLabelText('Request timeout (seconds)')).toHaveValue(120);
    fireEvent.change(screen.getByLabelText('Request timeout (seconds)'), {
      target: { value: '600' },
    });
    fireEvent.change(screen.getByLabelText('Response headers timeout (seconds)'), {
      target: { value: '90' },
    });
    fireEvent.change(screen.getByLabelText('Agent duration timeout (seconds)'), {
      target: { value: '7200' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save endpoint' }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        expect.objectContaining({
          timeoutMs: 600_000,
          timeouts: { responseHeadersTimeoutMs: 90_000, agentTimeoutMs: 7_200_000 },
        }),
        undefined,
        undefined
      )
    );
  });

  it('clears endpoint overrides to inherit instead of saving zero or a copied default', async () => {
    endpoint.timeoutMs = 120_000;
    endpoint.timeouts = { responseHeadersTimeoutMs: 30_000 };
    api.list.mockResolvedValue(dto());
    await open();
    fireEvent.change(screen.getByLabelText('Request timeout (seconds)'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Response headers timeout (seconds)'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save endpoint' }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutMs: undefined, timeouts: undefined }),
        undefined,
        undefined
      )
    );
  });

  it('sends a newly typed key once, then clears it without caching or localStorage', async () => {
    await open();
    fireEvent.change(screen.getByLabelText(/New API key/), {
      target: { value: 'ui-private-test-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save endpoint' }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(expect.any(Object), 'ui-private-test-key', undefined)
    );
    await waitFor(() => expect(screen.getByLabelText(/New API key/)).toHaveValue(''));
    expect(JSON.stringify(client.getQueryData(DIRECT_ENDPOINTS_QUERY_KEY))).not.toContain(
      'ui-private-test-key'
    );
    expect(JSON.stringify(vi.mocked(localStorage.setItem).mock.calls)).not.toContain(
      'ui-private-test-key'
    );
  });

  it('requires a separate explicit action to clear the stored key', async () => {
    await open();
    fireEvent.click(screen.getByLabelText('Explicitly clear stored key'));
    fireEvent.click(screen.getByRole('button', { name: 'Save endpoint' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.any(Object), undefined, true));
  });

  it('discovers exact IDs but does not auto-enable capabilities or send a key', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Fetch /models' }));
    fireEvent.change(await screen.findByLabelText('Discovered models'), {
      target: { value: 'direct-Exact/ID' },
    });
    expect(screen.getByLabelText('Model ID')).toHaveValue('direct-Exact/ID');
    expect(screen.getByLabelText('tools')).not.toBeChecked();
    expect(screen.getByLabelText('streaming')).not.toBeChecked();
    expect(api.models).toHaveBeenCalledWith('local');
    fireEvent.click(screen.getByRole('button', { name: 'Save endpoint' }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        expect.objectContaining({
          models: [
            expect.objectContaining({
              id: 'direct-Exact/ID',
              capabilities: { tools: false, streaming: false },
            }),
          ],
        }),
        undefined,
        undefined
      )
    );
  });

  it('does not remove an endpoint when the user cancels confirmation', async () => {
    await open();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove', exact: true }));
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('links to shared execution settings without offering Direct-specific permission grants', async () => {
    await open();
    expect(screen.queryByLabelText('Access profile')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Execution Environment' })).toHaveAttribute(
      'href',
      '/settings?view=execution-environment'
    );
    expect(api.saveAgent).not.toHaveBeenCalled();
  });

  it('shows a server failure without claiming the endpoint was saved', async () => {
    api.save.mockResolvedValue({ success: false, error: 'Invalid endpoint configuration.' });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Save endpoint' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Invalid endpoint configuration.');
    expect(
      screen.queryByText('Endpoint saved. Key values are never returned.')
    ).not.toBeInTheDocument();
  });
});
