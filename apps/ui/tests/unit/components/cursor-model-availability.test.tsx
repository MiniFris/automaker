import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelSelector } from '@/components/views/board-view/shared/model-selector';
const fixture = vi.hoisted(() => ({
  status: {
    installed: true,
    connected: true as boolean | undefined,
    auth: { authenticated: false },
  },
}));
vi.mock('@/store/setup-store', () => ({
  useSetupStore: () => ({ cursorCliStatus: fixture.status, codexCliStatus: null }),
}));
vi.mock('@/store/app-store', () => ({
  useAppStore: () => ({
    enabledCursorModels: ['auto'],
    cursorDefaultModel: 'cursor-auto',
    codexModels: [],
    codexModelsLoading: false,
    disabledProviders: ['opencode', 'codex'],
    enabledOpencodeModels: [],
    enabledDynamicModelIds: [],
    opencodeModelsLoading: false,
    fetchOpencodeModels: vi.fn(),
    fetchCodexModels: vi.fn(),
  }),
}));
vi.mock('@/hooks/queries', () => ({
  useOpencodeModels: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
}));
afterEach(cleanup);
it.each([
  [true, true, false],
  [true, false, true],
  [true, undefined, true],
  [false, true, true],
] as const)(
  'uses installation/connection, not authentication, for the Cursor availability notice (%s/%s)',
  (installed, connected, warn) => {
    fixture.status = { installed, connected, auth: { authenticated: false } };
    render(<ModelSelector selectedModel="cursor-auto" onModelSelect={vi.fn()} />);
    expect(
      !!screen.queryByText(/Cursor CLI installation or Automaker connection is unavailable/)
    ).toBe(warn);
    expect(screen.queryByText('Authenticated')).not.toBeInTheDocument();
  }
);
