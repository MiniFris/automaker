import {
  filesQueryServiceProvider,
  filesCommandServiceProvider,
  imageQueryServiceProvider,
} from './application.providers.js';
import { Module } from '@nestjs/common';
import { FilesController } from './files.controller.js';

import { LocalProjectFileAdapter } from './local-project-file.adapter.js';
import { PROJECT_FILE_PORT } from './project-file.port.js';

import { LocalDownloadService } from './local-download.service.js';

@Module({
  controllers: [FilesController],
  providers: [
    LocalProjectFileAdapter,
    { provide: PROJECT_FILE_PORT, useExisting: LocalProjectFileAdapter },
    filesQueryServiceProvider,
    filesCommandServiceProvider,
    imageQueryServiceProvider,
    LocalDownloadService,
  ],
  exports: [PROJECT_FILE_PORT],
})
export class FilesModule {}
