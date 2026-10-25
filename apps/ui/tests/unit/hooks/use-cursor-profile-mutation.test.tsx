import { act, renderHook, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useApplyCursorProfile } from '@/hooks/mutations/use-cursor-permissions-mutations';

const apply = vi.hoisted(() => vi.fn());
vi.mock('@/lib/http-api-client', () => ({
  getHttpApiClient: () => ({ setup: { applyCursorPermissionProfile: apply } }),
}));
afterEach(cleanup);
const identity = {
  kind: 'host-cursor-permissions',
  provider: 'cursor',
  configPath: '/profile/cli-config.json',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  workingDirectory: '/backend',
} as const;
it.each(['global', 'project'] as const)(
  'invalidates %s permissions using the confirmed response target',
  async (scope) => {
    const target =
      scope === 'global'
        ? { ...identity, scope }
        : { ...identity, scope, projectPath: '/confirmed-project' };
    apply.mockResolvedValue({ success: true, target, message: 'saved' });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useApplyCursorProfile(), { wrapper });
    const request = { confirmed: true, profileId: 'strict', target } as const;
    await act(() => result.current.mutateAsync(request));
    expect(apply).toHaveBeenCalledWith(request);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey:
        scope === 'global' ? ['cursorPermissions'] : ['cursorPermissions', '/confirmed-project'],
    });
    unmount();
    client.clear();
  }
);
