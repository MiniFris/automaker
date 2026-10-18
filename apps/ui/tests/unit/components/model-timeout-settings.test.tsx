import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ProviderModelTimeoutSettings,
  MODEL_TIMEOUTS_QUERY_KEY,
} from '@/components/shared/model-timeout-settings';

const api = vi.hoisted(() => ({ getProvider: vi.fn(), saveProvider: vi.fn() }));
vi.mock('@/lib/http-api-client', () => ({ getHttpApiClient: () => ({ modelTimeouts: api }) }));
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.getProvider.mockReset().mockResolvedValue({
    success: true,
    timeouts: { requestTimeoutMs: 120_000, toolTimeoutMs: 10_000 },
  });
  api.saveProvider
    .mockReset()
    .mockImplementation(async (_provider, timeouts) => ({ success: true, timeouts }));
});
afterEach(() => {
  cleanup();
  client.clear();
});
const toggle = () => fireEvent.click(screen.getByText('Provider timeouts', { exact: true }));
const open = () => {
  const result = render(
    <QueryClientProvider client={client}>
      <ProviderModelTimeoutSettings provider="openai-compatible" />
    </QueryClientProvider>
  );
  toggle();
  return result;
};

it('starts collapsed, toggles both ways and preserves an unsaved draft', async () => {
  render(
    <QueryClientProvider client={client}>
      <ProviderModelTimeoutSettings provider="openai-compatible" />
    </QueryClientProvider>
  );
  const details = screen.getByText('Provider timeouts', { exact: true }).closest('details');
  expect(details).not.toHaveAttribute('open');
  const request = await screen.findByLabelText('Request timeout (seconds)');
  expect(request).not.toBeVisible();
  expect(screen.getByRole('button', { name: 'Save model timeouts' })).not.toBeVisible();
  toggle();
  expect(details).toHaveAttribute('open');
  expect(request).toBeVisible();
  fireEvent.change(request, { target: { value: '777' } });
  toggle();
  expect(request).not.toBeVisible();
  toggle();
  expect(request).toHaveValue(777);
  expect(api.saveProvider).not.toHaveBeenCalled();
});
it('converts seconds to milliseconds and caches only the timeout DTO', async () => {
  open();
  const request = await screen.findByLabelText('Request timeout (seconds)');
  expect(request).toHaveValue(120);
  fireEvent.change(request, { target: { value: '600' } });
  fireEvent.change(screen.getByLabelText('Checkpoint save timeout (seconds)'), {
    target: { value: '2.5' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save model timeouts' }));
  await waitFor(() =>
    expect(api.saveProvider).toHaveBeenCalledWith('openai-compatible', {
      requestTimeoutMs: 600_000,
      toolTimeoutMs: 10_000,
      checkpointTimeoutMs: 2_500,
    })
  );
  await screen.findByText(/Applied to new requests/);
  expect(client.getQueryData([...MODEL_TIMEOUTS_QUERY_KEY, 'openai-compatible'])).toEqual({
    requestTimeoutMs: 600_000,
    toolTimeoutMs: 10_000,
    checkpointTimeoutMs: 2_500,
  });
});
it('clears individual overrides and can restore inherited behaviour explicitly', async () => {
  open();
  fireEvent.change(await screen.findByLabelText('Request timeout (seconds)'), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save model timeouts' }));
  await waitFor(() =>
    expect(api.saveProvider).toHaveBeenCalledWith('openai-compatible', { toolTimeoutMs: 10_000 })
  );
  await screen.findByText(/Applied to new requests/);
  fireEvent.click(screen.getByRole('button', { name: 'Clear overrides' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save model timeouts' }));
  await waitFor(() => expect(api.saveProvider).toHaveBeenLastCalledWith('openai-compatible', {}));
});
it('rejects zero rather than silently disabling model deadlines', async () => {
  open();
  fireEvent.change(await screen.findByLabelText('Request timeout (seconds)'), {
    target: { value: '0' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save model timeouts' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Invalid model timeout');
  expect(api.saveProvider).not.toHaveBeenCalled();
});

it('only shows the selected provider fields and keeps its cache isolated', async () => {
  api.getProvider.mockResolvedValue({ success: true, timeouts: { cliIdleTimeoutMs: 300_000 } });
  render(
    <QueryClientProvider client={client}>
      <ProviderModelTimeoutSettings provider="cursor" />
    </QueryClientProvider>
  );
  toggle();
  expect(await screen.findByLabelText('CLI/SDK idle timeout (seconds)')).toHaveValue(300);
  expect(screen.queryByLabelText('Request timeout (seconds)')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Codex extended idle timeout (seconds)')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('CLI/SDK idle timeout (seconds)'), {
    target: { value: '600' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save model timeouts' }));
  await waitFor(() =>
    expect(api.saveProvider).toHaveBeenCalledWith('cursor', { cliIdleTimeoutMs: 600_000 })
  );
  expect(client.getQueryData([...MODEL_TIMEOUTS_QUERY_KEY, 'openai-compatible'])).toBeUndefined();
});

it('does not carry an unsaved draft into another provider', async () => {
  api.getProvider.mockImplementation(async (provider) => ({
    success: true,
    timeouts: provider === 'cursor' ? { cliIdleTimeoutMs: 222_000 } : { requestTimeoutMs: 111_000 },
  }));
  const view = (provider: 'cursor' | 'claude') => (
    <QueryClientProvider client={client}>
      <ProviderModelTimeoutSettings provider={provider} />
    </QueryClientProvider>
  );
  const rendered = render(view('cursor'));
  toggle();
  fireEvent.change(await screen.findByLabelText('CLI/SDK idle timeout (seconds)'), {
    target: { value: '600' },
  });
  rendered.rerender(view('claude'));
  expect(
    screen.getByText('Provider timeouts', { exact: true }).closest('details')
  ).not.toHaveAttribute('open');
  toggle();
  expect(await screen.findByLabelText('Request timeout (seconds)')).toHaveValue(111);
  fireEvent.click(screen.getByRole('button', { name: 'Save model timeouts' }));
  await waitFor(() =>
    expect(api.saveProvider).toHaveBeenCalledWith('claude', { requestTimeoutMs: 111_000 })
  );
  expect(client.getQueryData([...MODEL_TIMEOUTS_QUERY_KEY, 'cursor'])).toEqual({
    cliIdleTimeoutMs: 222_000,
  });
});

it('clears only visible Direct workflow fields, preserving connection fallback values', async () => {
  api.getProvider.mockResolvedValue({
    success: true,
    timeouts: { requestTimeoutMs: 200_000, verificationTimeoutMs: 900_000 },
  });
  render(
    <QueryClientProvider client={client}>
      <ProviderModelTimeoutSettings provider="openai-compatible" keys={['verificationTimeoutMs']} />
    </QueryClientProvider>
  );
  toggle();
  await screen.findByLabelText('Verification command timeout (seconds)');
  fireEvent.click(screen.getByRole('button', { name: 'Clear overrides' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save model timeouts' }));
  await waitFor(() =>
    expect(api.saveProvider).toHaveBeenCalledWith('openai-compatible', {
      requestTimeoutMs: 200_000,
    })
  );
});
