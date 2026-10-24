import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClaudeCliStatus } from '@/components/views/settings-view/cli-status/claude-cli-status';
import { CodexCliStatus } from '@/components/views/settings-view/cli-status/codex-cli-status';
import { OpencodeCliStatus } from '@/components/views/settings-view/cli-status/opencode-cli-status';
import { setUiLocale } from '@/lib/i18n';
import { canAttemptCliProvider } from '@/lib/provider-readiness';

vi.mock('@/components/views/settings-view/cli-status/provider-connection-button', () => ({
  ProviderReconnectButton: () => <button>Reconnect to Automaker</button>,
  ProviderDisconnectButton: () => <button>Disconnect from Automaker</button>,
}));
beforeEach(() => setUiLocale('en'));
afterEach(cleanup);
const cards = [
  ['Claude', ClaudeCliStatus],
  ['Codex', CodexCliStatus],
  ['OpenCode', OpencodeCliStatus],
] as const;
it.each(cards)('%s distinguishes passive presence from authentication', (_name, Component) => {
  render(
    <Component
      status={{ success: true, status: 'installed' }}
      authStatus={{ authenticated: true, authenticationChecked: false, method: 'api_key' }}
      isChecking={false}
      onRefresh={vi.fn()}
    />
  );
  expect(screen.getByText('Authentication not checked')).toBeInTheDocument();
  expect(screen.queryByText('Authenticated')).not.toBeInTheDocument();
  expect(screen.queryByText('Not Authenticated')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reconnect to Automaker' })).toBeInTheDocument();
});
it.each(cards)('%s still renders an explicit successful verification', (_name, Component) => {
  render(
    <Component
      status={{ success: true, status: 'installed' }}
      authStatus={{ authenticated: true, authenticationChecked: true, method: 'api_key' }}
      isChecking={false}
      onRefresh={vi.fn()}
    />
  );
  expect(screen.getByText('Authenticated')).toBeInTheDocument();
  expect(screen.queryByText('Authentication not checked')).not.toBeInTheDocument();
});
it('keeps an installed CLI selectable when authentication is unknown without labelling it verified', () => {
  const auth = { authenticated: false, authenticationChecked: false };
  expect(canAttemptCliProvider({ installed: true }, auth)).toBe(true);
  expect(canAttemptCliProvider({ installed: false }, { ...auth, hasApiKey: true })).toBe(true);
  expect(canAttemptCliProvider({ installed: true, connected: false }, auth)).toBe(false);
  expect(canAttemptCliProvider({ installed: false }, auth)).toBe(false);
  expect(auth.authenticated).toBe(false);
});
