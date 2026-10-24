import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GeminiCliStatus } from '@/components/views/settings-view/cli-status/gemini-cli-status';
import { setUiLocale } from '@/lib/i18n';
beforeEach(() => setUiLocale('en'));
afterEach(cleanup);
it.each([false, true])(
  'does not present Gemini key/file hints as authentication (hints=%s)',
  (hints) => {
    render(
      <GeminiCliStatus
        status={{ success: true, status: 'installed' }}
        connected={!hints}
        authStatus={{
          authenticated: false,
          authenticationChecked: false,
          method: 'api_key',
          hasApiKey: hints,
          hasConfigFile: hints,
        }}
        isChecking={false}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByText('Authentication not checked')).toBeInTheDocument();
    expect(screen.queryByText('Authenticated')).not.toBeInTheDocument();
    expect(screen.queryByText('Authentication Failed')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: hints ? 'Reconnect to Automaker' : 'Disconnect from Automaker',
      })
    ).toBeInTheDocument();
  }
);
