import { Global, Module } from '@nestjs/common';
import {
  HOST_PROFILE_CONFIG,
  HOST_ENVIRONMENT,
  RUNTIME_CONFIG,
  RuntimePathsService,
  type HostProfileConfig,
  type RuntimeConfig,
} from '../../core/config/index.js';
import { SECURE_FILESYSTEM, SecurityService } from '../../core/security/index.js';
import type * as Filesystem from '../../lib/secure-fs.js';
import { SettingsService } from '../../services/settings-service.js';
import { TerminalService } from '../../services/terminal-service.js';
import { createTerminalHostPort } from '../../core/platform/terminal-host.runtime.js';
import { TerminalRcFilesAdapter } from '../../core/platform/terminal-rc-files.adapter.js';

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
        HOST_ENVIRONMENT,
      ],
      useFactory: (
        settings: SettingsService,
        config: RuntimeConfig,
        filesystem: typeof Filesystem,
        paths: RuntimePathsService,
        host: HostProfileConfig,
        security: SecurityService,
        environment: Readonly<NodeJS.ProcessEnv>
      ) =>
        new TerminalService(settings, config.terminal.maxSessions, {
          filesystem,
          host: createTerminalHostPort(environment, host.platform),
          rcFiles: new TerminalRcFilesAdapter(filesystem),
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
