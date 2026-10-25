import type { FactoryProvider } from '@nestjs/common';
import { FilesQueryService } from './files-query.service.js';
import { FilesCommandService } from './files-command.service.js';
import { ImageQueryService } from './image-query.service.js';
import { PROJECT_FILE_PORT } from './project-file.port.js';
import { SecurityService } from '../../core/security/security.service.js';
import { RuntimePathsService } from '../../core/config/index.js';

export const filesQueryServiceProvider: FactoryProvider<FilesQueryService> = {
  provide: FilesQueryService,
  inject: [PROJECT_FILE_PORT, SecurityService, RuntimePathsService],
  useFactory: (
    files: ConstructorParameters<typeof FilesQueryService>[0],
    security: ConstructorParameters<typeof FilesQueryService>[1],
    paths: ConstructorParameters<typeof FilesQueryService>[2]
  ) => new FilesQueryService(files, security, paths),
};

export const filesCommandServiceProvider: FactoryProvider<FilesCommandService> = {
  provide: FilesCommandService,
  inject: [PROJECT_FILE_PORT],
  useFactory: (files: ConstructorParameters<typeof FilesCommandService>[0]) =>
    new FilesCommandService(files),
};

export const imageQueryServiceProvider: FactoryProvider<ImageQueryService> = {
  provide: ImageQueryService,
  inject: [PROJECT_FILE_PORT, SecurityService],
  useFactory: (
    files: ConstructorParameters<typeof ImageQueryService>[0],
    security: ConstructorParameters<typeof ImageQueryService>[1]
  ) => new ImageQueryService(files, security),
};
