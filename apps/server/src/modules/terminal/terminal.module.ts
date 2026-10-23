import { Module } from '@nestjs/common';
import { TerminalAccessGuard, TerminalAccessService } from './terminal-access.service.js';
import { TerminalController } from './terminal.controller.js';
import { WebSocketTransportService } from './websocket-transport.service.js';

@Module({
  controllers: [TerminalController],
  providers: [TerminalAccessService, TerminalAccessGuard, WebSocketTransportService],
  exports: [TerminalAccessService],
})
export class TerminalModule {}
