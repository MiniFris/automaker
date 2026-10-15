import { useQuery } from '@tanstack/react-query';
import { getHttpApiClient } from '@/lib/http-api-client';

// One shared cache for settings and every model picker, in web and Electron modes.
export const DIRECT_ENDPOINTS_QUERY_KEY = ['settings', 'openai-compatible'] as const;
export function useDirectEndpoints() {
  return useQuery({
    queryKey: DIRECT_ENDPOINTS_QUERY_KEY,
    staleTime: 30_000,
    queryFn: async () => {
      const result = await getHttpApiClient().directEndpoints.list();
      if (!result.success) throw new Error(result.error || 'Unable to load direct endpoints');
      return result;
    },
  });
}
