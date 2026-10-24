import { Global, Module } from '@nestjs/common';
import { RUNTIME_CONFIG, type RuntimeConfig } from '../../core/config/index.js';
import { SettingsService } from '../../services/settings-service.js';
import { TerminalService } from '../../services/terminal-service.js';

@Global()
@Module({
  providers: [
    {
      provide: TerminalService,
      inject: [SettingsService, RUNTIME_CONFIG],
      useFactory: (settings: SettingsService, config: RuntimeConfig) =>
        new TerminalService(settings, config.terminal.maxSessions),
    },
  ],
  exports: [TerminalService],
})
export class TerminalRuntimeModule {}
