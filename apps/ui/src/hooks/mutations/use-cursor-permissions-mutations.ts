import { translate } from '@/lib/i18n';
/**
 * Cursor Permissions Mutation Hooks
 *
 * React Query mutations for managing Cursor CLI permissions.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getHttpApiClient } from '@/lib/http-api-client';
import { queryKeys } from '@/lib/query-keys';
import { toast } from 'sonner';
import type { CursorProfileRequest } from '@automaker/contracts';

/**
 * Apply a Cursor permission profile
 *
 * @returns Mutation for applying permission profiles
 *
 * @example
 * ```tsx
 * const applyMutation = useApplyCursorProfile();
 * applyMutation.mutate({ profileId: 'development', confirmed: true, target });
 * ```
 */
export function useApplyCursorProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CursorProfileRequest) => {
      const api = getHttpApiClient();
      const result = await api.setup.applyCursorPermissionProfile(input);

      return result;
    },
    onSuccess: (result) => {
      // Invalidate permissions cache
      queryClient.invalidateQueries({
        queryKey:
          result.target.scope === 'global'
            ? queryKeys.cursorPermissions.all
            : queryKeys.cursorPermissions.permissions(result.target.projectPath),
      });
      toast.success(result.message || translate('Profile applied'));
    },
    onError: (error) => {
      toast.error(translate('Failed to apply profile'), {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });
}

/**
 * Copy Cursor example config to clipboard
 *
 * @returns Mutation for copying config
 *
 * @example
 * ```tsx
 * const copyMutation = useCopyCursorConfig();
 * copyMutation.mutate('development');
 * ```
 */
export function useCopyCursorConfig() {
  return useMutation({
    mutationFn: async (profileId: 'strict' | 'development') => {
      const api = getHttpApiClient();
      const result = await api.setup.getCursorExampleConfig(profileId);

      if (!result.success || !result.config) {
        throw new Error(result.error || 'Failed to get config');
      }

      await navigator.clipboard.writeText(result.config);
      return result;
    },
    onSuccess: () => {
      toast.success(translate('Config copied to clipboard'));
    },
    onError: (error) => {
      toast.error(translate('Failed to copy config'), {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });
}
