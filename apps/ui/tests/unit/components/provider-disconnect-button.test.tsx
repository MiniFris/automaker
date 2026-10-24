import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProviderDisconnectButton } from '@/components/views/settings-view/cli-status/provider-disconnect-button';
import { setUiLocale } from '@/lib/i18n';

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  disconnect: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/lib/http-api-client', () => ({
  getHttpApiClient: () => ({
    setup: {
      getProviderConnectionTarget: mocks.inspect,
      disconnectProvider: mocks.disconnect,
    },
  }),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
const target = {
  kind: 'host-application',
  provider: 'claude',
  workingDirectory: '/backend/profile',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
};
const refresh = vi.fn();
beforeEach(() => {
  setUiLocale('en');
  vi.clearAllMocks();
  mocks.inspect.mockResolvedValue({ success: true, target });
  mocks.disconnect.mockResolvedValue({ success: true, connected: false, target });
});
afterEach(() => {
  cleanup();
  setUiLocale('en');
});
const open = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect from Automaker' }));
  return screen.findByRole('dialog');
};

it('only inspects the target until the user explicitly confirms', async () => {
  render(<ProviderDisconnectButton provider="claude" onRefresh={refresh} />);
  expect(mocks.inspect).not.toHaveBeenCalled();
  await open();
  expect(mocks.inspect).toHaveBeenCalledExactlyOnceWith('claude');
  expect(screen.getByTestId('provider-disconnect-target')).toHaveTextContent('/backend/profile');
  expect(screen.getByTestId('provider-disconnect-target')).toHaveTextContent(target.instanceId);
  expect(mocks.disconnect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mocks.disconnect).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

it('localizes the confirmation and explains that CLI credentials and active runs are retained', async () => {
  setUiLocale('ru');
  render(<ProviderDisconnectButton provider="claude" onRefresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Отключить от Automaker' }));
  expect(await screen.findByRole('dialog', { name: 'Отключить провайдера?' })).toBeVisible();
  expect(screen.getByText(/Учётные данные CLI не удаляются/)).toBeVisible();
  expect(mocks.disconnect).not.toHaveBeenCalled();
});

it('submits exactly the displayed target and waits for completion before refresh', async () => {
  let resolve!: (value: unknown) => void;
  mocks.disconnect.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  render(<ProviderDisconnectButton provider="claude" onRefresh={refresh} />);
  await open();
  const confirm = screen.getByRole('button', { name: /^Disconnect/ });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(mocks.disconnect).toHaveBeenCalledExactlyOnceWith('claude', { confirmed: true, target });
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Disconnecting...' })).toBeDisabled();
  resolve({ success: true, connected: false, target });
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
});

it('re-inspects after cancellation instead of silently reusing an old target', async () => {
  render(<ProviderDisconnectButton provider="claude" onRefresh={refresh} />);
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  mocks.inspect.mockResolvedValueOnce({
    success: true,
    target: { ...target, workingDirectory: '/new/backend' },
  });
  await open();
  expect(mocks.inspect).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('provider-disconnect-target')).toHaveTextContent('/new/backend');
  fireEvent.click(screen.getByRole('button', { name: /^Disconnect/ }));
  await waitFor(() =>
    expect(mocks.disconnect).toHaveBeenCalledWith('claude', {
      confirmed: true,
      target: { ...target, workingDirectory: '/new/backend' },
    })
  );
});

it('does not allow confirmation of a target for a different provider after a prop change', async () => {
  const view = render(<ProviderDisconnectButton provider="claude" onRefresh={refresh} />);
  await open();
  view.rerender(<ProviderDisconnectButton provider="codex" onRefresh={refresh} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mocks.disconnect).not.toHaveBeenCalled();
});

it('does not mutate after inspection fails', async () => {
  mocks.inspect.mockRejectedValueOnce(new Error('Backend unavailable'));
  render(<ProviderDisconnectButton provider="claude" onRefresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect from Automaker' }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mocks.disconnect).not.toHaveBeenCalled();
});

it('reports a rejected disconnect without showing success or refreshing', async () => {
  mocks.disconnect.mockRejectedValueOnce(new Error('Target changed'));
  render(<ProviderDisconnectButton provider="claude" onRefresh={refresh} />);
  await open();
  fireEvent.click(screen.getByRole('button', { name: /^Disconnect/ }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(mocks.success).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
