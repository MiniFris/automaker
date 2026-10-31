import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentConversationEntry } from '@automaker/types';
import { getElectronAPI } from '@/lib/electron';
import { queryKeys } from '@/lib/query-keys';
import { mergeAgentConversation } from '@/lib/agent-conversation';

interface ConversationSnapshot {
  content: string;
  conversation: AgentConversationEntry[];
}

export function useAgentConversation(
  projectPath: string | undefined,
  featureId: string,
  enabled: boolean
) {
  const client = useQueryClient();
  const key = useMemo(
    () => [...queryKeys.features.agentOutput(projectPath ?? '', featureId), 'conversation'],
    [projectPath, featureId]
  );
  const query = useQuery({
    queryKey: key,
    enabled: enabled && !!projectPath,
    queryFn: async (): Promise<ConversationSnapshot> => {
      const result = await getElectronAPI().features?.getAgentOutput(projectPath!, featureId);
      if (!result?.success) throw new Error(result?.error || 'Failed to load agent conversation');
      // Preserve events received while this HTTP snapshot was in flight.
      const live = client.getQueryData<ConversationSnapshot>(key)?.conversation ?? [];
      return {
        content: result.content ?? '',
        conversation: mergeAgentConversation(result.conversation ?? [], live),
      };
    },
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: 'always',
    staleTime: 0,
  });
  useEffect(() => {
    if (!enabled || !projectPath) return;
    return getElectronAPI().autoMode?.onEvent((event) => {
      if (
        event.type !== 'auto_mode_conversation' ||
        event.featureId !== featureId ||
        event.projectPath !== projectPath
      )
        return;
      client.setQueryData<ConversationSnapshot>(key, (previous) => ({
        content: previous?.content ?? '',
        conversation: mergeAgentConversation(previous?.conversation ?? [], [event.entry]),
      }));
    });
  }, [client, key, projectPath, featureId, enabled]);
  return query;
}
