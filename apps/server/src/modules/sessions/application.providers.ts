import type { FactoryProvider } from '@nestjs/common';
import { SessionApplicationService } from './session-application.service.js';
import {
  SESSION_METADATA_REPOSITORY,
  ACTIVE_SESSION_COORDINATOR,
} from './session-metadata.repository.js';
import { SecurityService } from '../../core/security/index.js';
import { RuntimePathsService } from '../../core/config/index.js';

export const sessionApplicationServiceProvider: FactoryProvider<SessionApplicationService> = {
  provide: SessionApplicationService,
  inject: [
    SESSION_METADATA_REPOSITORY,
    ACTIVE_SESSION_COORDINATOR,
    SecurityService,
    RuntimePathsService,
  ],
  useFactory: (
    sessions: ConstructorParameters<typeof SessionApplicationService>[0],
    active: ConstructorParameters<typeof SessionApplicationService>[1],
    security: ConstructorParameters<typeof SessionApplicationService>[2],
    paths: ConstructorParameters<typeof SessionApplicationService>[3]
  ) => new SessionApplicationService(sessions, active, security, paths),
};
