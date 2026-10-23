import { Module } from '@nestjs/common';
import { TerminalAccessGuard, TerminalAccessService } from './terminal-access.service.js';
import { TerminalController } from './terminal.controller.js';

@Module({
  controllers: [TerminalController],
  providers: [TerminalAccessService, TerminalAccessGuard],
  exports: [TerminalAccessService],
})
export class TerminalModule {}
