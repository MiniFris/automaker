import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CopilotCliStatus } from '@/components/views/settings-view/cli-status/copilot-cli-status';
import { setUiLocale } from '@/lib/i18n';

const inspect = vi.hoisted(() => vi.fn());
vi.mock('@/lib/electron', () => ({
  getElectronAPI: () => ({ setup: { getProviderConnectionTarget: inspect } }),
}));
beforeEach(() => {
  setUiLocale('en');
  inspect.mockReset();
});
afterEach(cleanup);

it('offers application reconnect without claiming to verify credentials', () => {
  render(
    <CopilotCliStatus
      status={{ success: true, status: 'installed' }}
      connected={false}
      authStatus={{ authenticated: false, authenticationChecked: false, method: 'none' }}
      isChecking={false}
      onRefresh={vi.fn()}
    />
  );
  expect(screen.getByRole('button', { name: 'Reconnect to Automaker' })).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Disconnect from Automaker' })
  ).not.toBeInTheDocument();
  expect(inspect).not.toHaveBeenCalled();
});

it.each([false, true])(
  'never labels local token/config hints as authenticated (hints=%s)',
  (hints) => {
    render(
      <CopilotCliStatus
        status={{ success: true, status: 'installed', version: 'fixture' }}
        authStatus={{
          authenticated: false,
          authenticationChecked: false,
          method: 'oauth',
          hasEnvToken: hints,
          hasConfigFile: hints,
        }}
        isChecking={false}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByText('Authentication not checked')).toBeInTheDocument();
    expect(screen.queryByText('Authenticated')).not.toBeInTheDocument();
    expect(
      screen.getByText(/Refreshing status does not run authentication commands/)
    ).toBeInTheDocument();
    expect(inspect).not.toHaveBeenCalled();
  }
);
