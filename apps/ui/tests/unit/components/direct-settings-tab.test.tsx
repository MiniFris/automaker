import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenAICompatibleEndpoint } from '@automaker/types';
import { DirectSettingsTab } from '@/components/views/settings-view/providers/direct-settings-tab';
import { DIRECT_ENDPOINTS_QUERY_KEY } from '@/hooks/queries/use-direct-endpoints';

const api = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), remove: vi.fn(), models: vi.fn(), test: vi.fn(), saveAgent: vi.fn() }));
vi.mock('@/lib/http-api-client', () => ({ getHttpApiClient: () => ({ directEndpoints: api }) }));

describe('direct provider settings UI / write-only secrets', () => {
  let client: QueryClient;
  let endpoint: OpenAICompatibleEndpoint;
  const dto = () => ({ success: true, endpoints: [{ endpoint, keyConfigured: true }], agentSettings: { access: 'read-only' as const } });
  beforeEach(() => {
    endpoint = { id: 'local', name: 'Local endpoint', enabled: true, baseUrl: 'http://localhost:1234/v1/', protocol: 'chat-completions', auth: { type: 'credentials', credentialId: 'local' }, models: [] };
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    api.list.mockResolvedValue(dto()); api.save.mockImplementation(async (saved) => { endpoint = saved; return dto(); });
    api.remove.mockResolvedValue({ ...dto(), endpoints: [] });
    api.models.mockResolvedValue({ success: true, models: ['Vendor/Case:Tag', 'direct-Exact/ID'] });
    api.test.mockResolvedValue({ success: true, verified: true });
    api.saveAgent.mockImplementation(async (settings) => ({ ...dto(), agentSettings: settings }));
  });
  afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });
  async function open() {
    render(<QueryClientProvider client={client}><DirectSettingsTab /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await screen.findByTestId('direct-endpoint-editor');
  }

  it('does not populate the key field, and metadata edits do not send a masked key', async () => {
    await open();
    expect(screen.getByLabelText(/New API key/)).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save endpoint' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Renamed' }), undefined, undefined));
  });

  it('sends a newly typed key once, then clears it without caching or localStorage', async () => {
    await open();
    fireEvent.change(screen.getByLabelText(/New API key/), { target: { value: 'ui-private-test-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save endpoint' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.any(Object), 'ui-private-test-key', undefined));
    await waitFor(() => expect(screen.getByLabelText(/New API key/)).toHaveValue(''));
    expect(JSON.stringify(client.getQueryData(DIRECT_ENDPOINTS_QUERY_KEY))).not.toContain('ui-private-test-key');
    expect(JSON.stringify(vi.mocked(localStorage.setItem).mock.calls)).not.toContain('ui-private-test-key');
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
    fireEvent.change(await screen.findByLabelText('Discovered models'), { target: { value: 'direct-Exact/ID' } });
    expect(screen.getByLabelText('Model ID')).toHaveValue('direct-Exact/ID');
    expect(screen.getByLabelText('tools')).not.toBeChecked(); expect(screen.getByLabelText('streaming')).not.toBeChecked();
    expect(api.models).toHaveBeenCalledWith('local');
    fireEvent.click(screen.getByRole('button', { name: 'Save endpoint' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ models: [expect.objectContaining({ id: 'direct-Exact/ID', capabilities: { tools: false, streaming: false } })] }), undefined, undefined));
  });

  it('does not remove an endpoint when the user cancels confirmation', async () => {
    await open(); vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove', exact: true }));
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('saves explicitly selected agent permissions through a separate API', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Access profile'), { target: { value: 'workspace-write' } });
    fireEvent.change(screen.getByLabelText(/Docker image ID/), { target: { value: `sha256:${'a'.repeat(64)}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Save agent permissions' }));
    await waitFor(() => expect(api.saveAgent).toHaveBeenCalledWith({ access: 'workspace-write', limits: { toolTimeoutMs: 10000 }, shell: { backend: 'docker', image: `sha256:${'a'.repeat(64)}`, executable: 'sh' } }));
  });

  it('shows a server failure without claiming the endpoint was saved', async () => {
    api.save.mockResolvedValue({ success: false, error: 'Invalid endpoint configuration.' });
    await open(); fireEvent.click(screen.getByRole('button', { name: 'Save endpoint' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Invalid endpoint configuration.');
    expect(screen.queryByText('Endpoint saved. Key values are never returned.')).not.toBeInTheDocument();
  });
});
