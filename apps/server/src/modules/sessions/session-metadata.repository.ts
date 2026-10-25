import type { ExecutionEnvironmentBinding } from '@automaker/types';
import type { SessionCreateRequest, SessionUpdateRequest } from './session.schemas.js';

export interface PersistedSessionMetadata {
  executionEnvironment?: ExecutionEnvironmentBinding;
  id: string;
  name: string;
  projectPath?: string;
  workingDirectory: string;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
  tags?: string[];
  model?: string;
  providerId?: string;
}

export const SESSION_METADATA_REPOSITORY = Symbol('SESSION_METADATA_REPOSITORY');

export interface SessionMetadataRepository {
  list(includeArchived: boolean): Promise<PersistedSessionMetadata[]>;
  loadMessages(sessionId: string): Promise<Array<{ content?: string }>>;
  create(
    input: SessionCreateRequest & { workingDirectory: string }
  ): Promise<PersistedSessionMetadata>;
  update(
    sessionId: string,
    updates: SessionUpdateRequest
  ): Promise<PersistedSessionMetadata | null>;
  archive(sessionId: string, archived: boolean): Promise<boolean>;
}

export const ACTIVE_SESSION_COORDINATOR = Symbol('ACTIVE_SESSION_COORDINATOR');
export interface ActiveSessionCoordinator {
  deleteAndRelease(sessionId: string): Promise<boolean>;
}
