import { Global, Module } from '@nestjs/common';
import { AutoModeController } from './auto-mode.controller.js';
import { AutoModeHandlersService } from './auto-mode-handlers.service.js';
import { autoModeProvider } from './auto-mode.provider.js';
import { AutoModeServiceCompat } from '../../services/auto-mode/index.js';

@Global()
@Module({
  controllers: [AutoModeController],
  providers: [autoModeProvider, AutoModeHandlersService],
  exports: [AutoModeServiceCompat],
})
export class AutoModeModule {}
