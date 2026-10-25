import { cleanup, render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CursorCliStatus } from '@/components/views/settings-view/cli-status/cursor-cli-status';
import { CursorSetupPanel } from '@/components/shared/cursor-setup-panel';
import { setUiLocale } from '@/lib/i18n';

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), refresh: vi.fn(), write: vi.fn() }));
vi.mock('@/lib/electron', () => ({
  getElectronAPI: () => ({ setup: { getProviderConnectionTarget: mocks.inspect } }),
}));
vi.mock('@/components/views/settings-view/hooks/use-cursor-status', () => ({
  useCursorStatus: () => ({
    status: {
      installed: true,
      authenticated: false,
      connected: true,
      hasEnvApiKey: true,
      hasCredentialsFile: true,
    },
    isLoading: false,
    loadData: mocks.refresh,
  }),
}));
beforeEach(() => {
  setUiLocale('en');
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.write.mockResolvedValue(undefined) },
  });
});
afterEach(cleanup);

it.each([false, true])(
  'never promotes legacy authenticated prop or local hints to verified status (legacy=%s)',
  (legacy) => {
    render(
      <CursorCliStatus
        status={{
          installed: true,
          authenticated: legacy,
          connected: true,
          hasEnvApiKey: true,
          hasCredentialsFile: true,
        }}
        isChecking={false}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByText('Authentication not checked')).toBeInTheDocument();
    expect(screen.queryByText('Authenticated')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect from Automaker' })).toBeInTheDocument();
    expect(mocks.inspect).not.toHaveBeenCalled();
  }
);
it('uses the application connection marker for reconnect, not an authentication claim', () => {
  render(
    <CursorCliStatus
      status={{ installed: true, authenticated: false, connected: false }}
      isChecking={false}
      onRefresh={vi.fn()}
    />
  );
  expect(screen.getByRole('button', { name: 'Reconnect to Automaker' })).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Disconnect from Automaker' })
  ).not.toBeInTheDocument();
});
it('copies a manual login command without polling or starting an authentication operation', async () => {
  render(<CursorSetupPanel />);
  expect(screen.getByText('Authentication not checked')).toBeInTheDocument();
  const intervals = vi.spyOn(globalThis, 'setInterval');
  try {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy login command' }));
    });
    expect(mocks.write).toHaveBeenCalledWith('cursor-agent login');
    expect(intervals).not.toHaveBeenCalled();
  } finally {
    intervals.mockRestore();
  }
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(screen.queryByText('Authenticated')).not.toBeInTheDocument();
});
