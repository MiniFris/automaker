import { Module } from '@nestjs/common';
import { FilesController } from './files.controller.js';
import { FilesQueryService } from './files-query.service.js';
import { LocalProjectFileAdapter } from './local-project-file.adapter.js';
import { PROJECT_FILE_PORT } from './project-file.port.js';
import { FilesCommandService } from './files-command.service.js';
import { ImageQueryService } from './image-query.service.js';
import { LocalDownloadService } from './local-download.service.js';

@Module({
  controllers: [FilesController],
  providers: [
    LocalProjectFileAdapter,
    { provide: PROJECT_FILE_PORT, useExisting: LocalProjectFileAdapter },
    FilesQueryService,
    FilesCommandService,
    ImageQueryService,
    LocalDownloadService,
  ],
  exports: [PROJECT_FILE_PORT],
})
export class FilesModule {}
