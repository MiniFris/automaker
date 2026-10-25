import { HOST_ENVIRONMENT } from '../../core/config/index.js';
import { Module } from '@nestjs/common';
import { ProviderRegistry } from '../providers/provider-registry.service.js';
import { simpleQuery } from '../../providers/simple-query-service.js';
import { PROMPT_QUERY } from './prompt-query.port.js';
import { PromptEnhancementController } from './prompt-enhancement.controller.js';
import { PromptEnhancementService } from './prompt-enhancement.service.js';

@Module({
  controllers: [PromptEnhancementController],
  providers: [
    {
      provide: PROMPT_QUERY,
      inject: [ProviderRegistry, HOST_ENVIRONMENT],
      useFactory:
        (registry: ProviderRegistry, hostEnvironment: Readonly<NodeJS.ProcessEnv>) =>
        (options: Parameters<typeof simpleQuery>[0]) =>
          simpleQuery(options, registry, hostEnvironment),
    },
    PromptEnhancementService,
  ],
})
export class PromptEnhancementModule {}
