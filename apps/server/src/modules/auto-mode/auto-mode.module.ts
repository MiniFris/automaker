import { Module } from '@nestjs/common';
import { AutoModeController } from './auto-mode.controller.js';
import { AutoModeHandlersService } from './auto-mode-handlers.service.js';

@Module({
  controllers: [AutoModeController],
  providers: [AutoModeHandlersService],
})
export class AutoModeModule {}
