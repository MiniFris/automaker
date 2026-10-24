import { Global, Module } from '@nestjs/common';
import {
  HOST_PROFILE_CONFIG,
  RUNTIME_CONFIG,
  RuntimePathsService,
  type HostProfileConfig,
  type RuntimeConfig,
} from '../../core/config/index.js';
import { SECURE_FILESYSTEM, SecurityService } from '../../core/security/index.js';
import type * as Filesystem from '../../lib/secure-fs.js';
import { SettingsService } from '../../services/settings-service.js';
import { TerminalService } from '../../services/terminal-service.js';

@Global()
@Module({
  providers: [
    {
      provide: TerminalService,
      inject: [
        SettingsService,
        RUNTIME_CONFIG,
        SECURE_FILESYSTEM,
        RuntimePathsService,
        HOST_PROFILE_CONFIG,
        SecurityService,
      ],
      useFactory: (
        settings: SettingsService,
        config: RuntimeConfig,
        filesystem: typeof Filesystem,
        paths: RuntimePathsService,
        host: HostProfileConfig,
        security: SecurityService
      ) =>
        new TerminalService(settings, config.terminal.maxSessions, {
          filesystem,
          resolvePath: (candidate) =>
            security.validateLocalPath(
              paths.resolveFromWorkingDirectory(candidate),
              'terminal working directory'
            ),
          homeDirectory: host.homeDirectory,
          fallbackDirectory: paths.allowedRootDirectory ?? paths.workingDirectory,
        }),
    },
  ],
  exports: [TerminalService],
})
export class TerminalRuntimeModule {}
