import { useState, useCallback, useEffect, useRef } from 'react';
import { createLogger } from '@automaker/utils/logger';
import type { PhaseModelEntry } from '@automaker/types';
import { useAppStore } from '@/store/app-store';
import { useShallow } from 'zustand/react/shallow';
import { getHttpApiClient } from '@/lib/http-api-client';

const logger = createLogger('AgentSession');

// Default model selection when none is persisted
const DEFAULT_MODEL_SELECTION: PhaseModelEntry = { model: 'claude-sonnet' };

interface UseAgentSessionOptions {
  projectPath: string | undefined;
  workingDirectory?: string; // Current worktree path for per-worktree session persistence
}

interface UseAgentSessionResult {
  currentSessionId: string | null;
  handleSelectSession: (sessionId: string | null) => void;
  // Model selection persistence
  modelSelection: PhaseModelEntry;
  modelSelectionReady: boolean;
  setModelSelection: (model: PhaseModelEntry) => void;
}

export function useAgentSession({
  projectPath,
  workingDirectory,
}: UseAgentSessionOptions): UseAgentSessionResult {
  const {
    setLastSelectedSession,
    getLastSelectedSession,
    setAgentModelForSession,
    getAgentModelForSession,
  } = useAppStore(
    useShallow((state) => ({
      setLastSelectedSession: state.setLastSelectedSession,
      getLastSelectedSession: state.getLastSelectedSession,
      setAgentModelForSession: state.setAgentModelForSession,
      getAgentModelForSession: state.getAgentModelForSession,
    }))
  );
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [modelSelection, setModelSelectionState] =
    useState<PhaseModelEntry>(DEFAULT_MODEL_SELECTION);
  const [modelSelectionReady, setModelSelectionReady] = useState(false);

  // Track if initial session has been loaded
  const initialSessionLoadedRef = useRef(false);
  const restoreVersion = useRef(0);

  // Use workingDirectory as the persistence key so sessions are scoped per worktree
  const persistenceKey = workingDirectory || projectPath;

  /**
   * Fetch persisted model for sessionId and update local state, or fall back to default.
   */
  const restoreModelForSession = useCallback(
    (sessionId: string) => {
      const version = ++restoreVersion.current;
      const persistedModel = getAgentModelForSession(sessionId);
      if (persistedModel) {
        logger.debug('Restoring model selection for session:', sessionId, persistedModel);
        setModelSelectionState(persistedModel);
        setModelSelectionReady(true);
      } else {
        setModelSelectionReady(false);
        setModelSelectionState(DEFAULT_MODEL_SELECTION);
        // A new browser/profile has no local selection; restore the server binding.
        void getHttpApiClient().sessions.list().then((result) => {
          if (version !== restoreVersion.current || !result.success) return;
          const session = result.sessions?.find((item) => item.id === sessionId);
          if (session?.model) setModelSelectionState({ model: session.model, providerId: session.providerId });
          if (session) setModelSelectionReady(true);
        }).catch(() => { /* Remain blocked until an explicit model choice or a successful restore. */ });
      }
    },
    [getAgentModelForSession]
  );

  // Handle session selection with persistence
  const handleSelectSession = useCallback(
    (sessionId: string | null) => {
      setCurrentSessionId(sessionId);
      restoreVersion.current++;
      setModelSelectionReady(false);
      // Persist the selection for this worktree/project
      if (persistenceKey) {
        setLastSelectedSession(persistenceKey, sessionId);
      }
      // Restore model selection for this session if available
      if (sessionId) {
        restoreModelForSession(sessionId);
      }
    },
    [persistenceKey, setLastSelectedSession, restoreModelForSession]
  );

  // Wrapper for setModelSelection that also persists
  const setModelSelection = useCallback(
    (model: PhaseModelEntry) => {
      restoreVersion.current++;
      setModelSelectionState(model);
      setModelSelectionReady(true);
      // Persist model selection for current session.
      // If currentSessionId is null (no active session), we only update local state
      // and skip persistence — this is intentional because the model picker should be
      // disabled (or hidden) in the UI whenever there is no active session, so this
      // path is only reached if the UI allows selection before a session is established.
      if (currentSessionId) {
        setAgentModelForSession(currentSessionId, model);
      }
    },
    [currentSessionId, setAgentModelForSession]
  );

  // Track the previous persistence key to detect actual changes
  const prevPersistenceKeyRef = useRef(persistenceKey);

  // Restore last selected session when switching to Agent view or when worktree changes
  useEffect(() => {
    // Detect if persistenceKey actually changed (worktree/project switch)
    const persistenceKeyChanged = prevPersistenceKeyRef.current !== persistenceKey;

    if (persistenceKeyChanged) {
      restoreVersion.current++;
      setModelSelectionReady(false);
      // Reset state when switching worktree/project
      prevPersistenceKeyRef.current = persistenceKey;
      initialSessionLoadedRef.current = false;
      setCurrentSessionId(null);
      setModelSelectionState(DEFAULT_MODEL_SELECTION);

      if (!persistenceKey) {
        // No project, nothing to restore
        return;
      }
    }

    if (!persistenceKey) {
      return;
    }

    // Only restore once per persistence key
    if (initialSessionLoadedRef.current) return;
    initialSessionLoadedRef.current = true;

    const lastSessionId = getLastSelectedSession(persistenceKey);
    if (lastSessionId) {
      logger.debug('Restoring last selected session:', lastSessionId);
      setCurrentSessionId(lastSessionId);
      // Also restore model selection for this session
      restoreModelForSession(lastSessionId);
    }
  }, [persistenceKey, getLastSelectedSession, restoreModelForSession]);

  return {
    currentSessionId,
    handleSelectSession,
    modelSelection,
    modelSelectionReady,
    setModelSelection,
  };
}
