import { Module } from '@nestjs/common';
import { TerminalAccessGuard, TerminalAccessService } from './terminal-access.service.js';
import { TerminalController } from './terminal.controller.js';
import { WebSocketTransportService } from './websocket-transport.service.js';
import { TerminalRuntimeModule } from './terminal-runtime.module.js';

@Module({
  imports: [TerminalRuntimeModule],
  controllers: [TerminalController],
  providers: [TerminalAccessService, TerminalAccessGuard, WebSocketTransportService],
  exports: [TerminalAccessService],
})
export class TerminalModule {}
