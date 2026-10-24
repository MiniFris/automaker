/**
 * Running Agents Query Hook
 *
 * React Query hook for fetching currently running agents.
 * This data is invalidated by WebSocket events when agents start/stop.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getElectronAPI, type RunningAgent } from '@/lib/electron';
import { queryKeys } from '@/lib/query-keys';
import { STALE_TIMES } from '@/lib/query-client';

const RUNNING_AGENTS_REFETCH_ON_FOCUS = false;
const RUNNING_AGENTS_REFETCH_ON_RECONNECT = false;
const RUNNING_AGENTS_POLLING_INTERVAL = 5000;

interface RunningAgentsResult {
  agents: RunningAgent[];
  count: number;
}

/**
 * Fetch all currently running agents
 *
 * @returns Query result with running agents and total count
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useRunningAgents();
 * const { agents, count } = data ?? { agents: [], count: 0 };
 * ```
 */
export function useRunningAgents() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const api = getElectronAPI();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = api.agent?.onStream((event: unknown) => {
      const type = (event as { type?: string }).type;
      if (!['started', 'complete', 'error'].includes(type ?? '')) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.runningAgents.all() });
      }, 300);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [queryClient]);
  return useQuery({
    queryKey: queryKeys.runningAgents.all(),
    queryFn: async (): Promise<RunningAgentsResult> => {
      const api = getElectronAPI();
      if (!api.runningAgents) {
        throw new Error('Running agents API not available');
      }
      const result = await api.runningAgents.getAll();
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch running agents');
      }
      return {
        agents: result.runningAgents ?? [],
        count: result.totalCount ?? result.runningAgents?.length ?? 0,
      };
    },
    staleTime: STALE_TIMES.RUNNING_AGENTS,
    // Stop can finish without a terminal stream frame; unrelated WS activity must
    // not suppress the fallback that removes completed/cancelled chat leases.
    refetchInterval: RUNNING_AGENTS_POLLING_INTERVAL,
    refetchOnWindowFocus: RUNNING_AGENTS_REFETCH_ON_FOCUS,
    refetchOnReconnect: RUNNING_AGENTS_REFETCH_ON_RECONNECT,
  });
}

/**
 * Get running agents count
 * This is a selector that derives count from the main query
 *
 * @returns Query result with just the count
 */
export function useRunningAgentsCount() {
  const query = useRunningAgents();
  return {
    ...query,
    data: query.data?.count ?? 0,
  };
}
