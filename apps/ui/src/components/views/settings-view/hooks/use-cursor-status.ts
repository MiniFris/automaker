import { useEffect, useMemo, useCallback } from 'react';
import { useCursorCliStatus } from '@/hooks/queries';
import { useSetupStore } from '@/store/setup-store';

export interface CursorStatus {
  installed: boolean;
  version?: string;
  authenticated: boolean;
  connected: boolean;
  hasEnvApiKey: boolean;
  hasCredentialsFile: boolean;
  method?: string;
}

/**
 * Custom hook for managing Cursor CLI status
 * Uses React Query for data fetching with automatic caching.
 */
export function useCursorStatus() {
  const { setCursorCliStatus } = useSetupStore();
  const { data: result, isLoading, refetch, error } = useCursorCliStatus();

  // Transform the API result into the local CursorStatus shape
  const status = useMemo((): CursorStatus | null => {
    if (!result) return null;
    return {
      installed: result.installed ?? false,
      version: result.version ?? undefined,
      authenticated: false,
      connected: result.connected,
      hasEnvApiKey: result.auth.hasEnvApiKey,
      hasCredentialsFile: result.auth.hasCredentialsFile,
      method: result.auth?.method,
    };
  }, [result]);

  // Keep the global setup store in sync with query data
  useEffect(() => {
    if (status) {
      setCursorCliStatus({
        installed: status.installed,
        connected: status.connected,
        version: status.version,
        auth: {
          authenticated: false,
          authenticationChecked: false,
          scope: 'host',
          method: status.method || 'none',
          hasEnvApiKey: status.hasEnvApiKey,
          hasCredentialsFile: status.hasCredentialsFile,
        },
      });
    }
  }, [status, setCursorCliStatus]);

  const loadData = useCallback(() => {
    refetch();
  }, [refetch]);

  return {
    status,
    isLoading,
    loadData,
    error,
  };
}
