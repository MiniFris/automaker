import { Module } from '@nestjs/common';
import { FilesController } from './files.controller.js';
import { FilesQueryService } from './files-query.service.js';
import { LocalProjectFileAdapter } from './local-project-file.adapter.js';
import { PROJECT_FILE_PORT } from './project-file.port.js';

@Module({
  controllers: [FilesController],
  providers: [
    LocalProjectFileAdapter,
    { provide: PROJECT_FILE_PORT, useExisting: LocalProjectFileAdapter },
    FilesQueryService,
  ],
  exports: [PROJECT_FILE_PORT],
})
export class FilesModule {}
