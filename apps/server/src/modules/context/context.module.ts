import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { ContextController } from './context.controller.js';
import { ContextDescriptionService } from './context-description.service.js';
import { CONTEXT_QUERY_PORT } from './context-query.port.js';
import { SimpleContextQueryAdapter } from './simple-context-query.adapter.js';

@Module({
  imports: [FilesModule],
  controllers: [ContextController],
  providers: [
    ContextDescriptionService,
    SimpleContextQueryAdapter,
    { provide: CONTEXT_QUERY_PORT, useExisting: SimpleContextQueryAdapter },
  ],
  exports: [CONTEXT_QUERY_PORT],
})
export class ContextModule {}
