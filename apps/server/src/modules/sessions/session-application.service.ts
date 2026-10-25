import type { SessionCreateInput, SessionUpdateInput } from './application.inputs.js';

import { RuntimePathsService } from '../../core/config/index.js';
import { NotFoundDomainError } from '../../core/errors/domain-errors.js';
import { SecurityService } from '../../core/security/index.js';
import {
  type ActiveSessionCoordinator,
  type SessionMetadataRepository,
} from './session-metadata.repository.js';

export class SessionApplicationService {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly sessions: SessionMetadataRepository,
    private readonly active: ActiveSessionCoordinator,
    private readonly security: SecurityService,
    private readonly paths: RuntimePathsService
  ) {}

  async list(includeArchived: boolean) {
    const metadata = await this.sessions.list(includeArchived);
    const sessions = await Promise.all(
      metadata.map(async (session) => {
        const messages = await this.sessions.loadMessages(session.id);
        const lastMessage = messages.at(-1);
        return {
          id: session.id,
          name: session.name,
          projectPath: session.projectPath || session.workingDirectory,
          workingDirectory: session.workingDirectory,
          model: session.model,
          providerId: session.providerId,
          executionEnvironment: session.executionEnvironment,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          isArchived: session.archived || false,
          tags: session.tags || [],
          messageCount: messages.length,
          preview: lastMessage?.content?.slice(0, 100) || '',
        };
      })
    );
    return { success: true as const, sessions };
  }

  async get(sessionId: string) {
    const metadata = (await this.sessions.list(true)).find((session) => session.id === sessionId);
    if (!metadata) throw new NotFoundDomainError('Session not found');
    return {
      success: true as const,
      session: metadata,
      messages: await this.sessions.loadMessages(sessionId),
    };
  }

  create(input: SessionCreateInput) {
    return this.serialize(async () => {
      const projectPath = input.projectPath
        ? this.security.validateLocalPath(input.projectPath, 'create session project')
        : undefined;
      const workingDirectory = this.security.validateLocalPath(
        input.workingDirectory ?? input.projectPath ?? this.paths.workingDirectory,
        'create session working directory'
      );
      const session = await this.sessions.create({ ...input, projectPath, workingDirectory });
      return { success: true as const, session };
    });
  }

  update(sessionId: string, input: SessionUpdateInput) {
    return this.serialize(async () => {
      const session = await this.sessions.update(sessionId, input);
      if (!session) throw new NotFoundDomainError('Session not found');
      return { success: true as const, session };
    });
  }

  archive(sessionId: string, archived: boolean) {
    return this.serialize(async () => {
      if (!(await this.sessions.archive(sessionId, archived))) {
        throw new NotFoundDomainError('Session not found');
      }
      return { success: true as const };
    });
  }

  remove(sessionId: string) {
    return this.serialize(async () => {
      if (!(await this.active.deleteAndRelease(sessionId))) {
        throw new NotFoundDomainError('Session not found');
      }
      return { success: true as const };
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.catch(() => {}).then(operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
