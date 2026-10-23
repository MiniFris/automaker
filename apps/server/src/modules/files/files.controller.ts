import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import {
  DirectoryPathRequestSchema,
  FilePathRequestSchema,
  type DirectoryPathRequest,
  type FilePathRequest,
} from './files.schemas.js';
import { FilesQueryService } from './files-query.service.js';

@Controller('fs')
@UseGuards(AllowedPathGuard)
export class FilesController {
  constructor(@Inject(FilesQueryService) private readonly files: FilesQueryService) {}

  @Post('read')
  @HttpCode(200)
  @AllowedPathFields('filePath')
  read(@Body(new ZodValidationPipe(FilePathRequestSchema)) input: FilePathRequest) {
    return this.files.read(input.filePath);
  }

  @Post('readdir')
  @HttpCode(200)
  @AllowedPathFields('dirPath')
  list(@Body(new ZodValidationPipe(DirectoryPathRequestSchema)) input: DirectoryPathRequest) {
    return this.files.list(input.dirPath);
  }

  @Post('stat')
  @HttpCode(200)
  @AllowedPathFields('filePath')
  stat(@Body(new ZodValidationPipe(FilePathRequestSchema)) input: FilePathRequest) {
    return this.files.stat(input.filePath);
  }

  @Post('exists')
  @HttpCode(200)
  @AllowedPathFields('filePath')
  exists(@Body(new ZodValidationPipe(FilePathRequestSchema)) input: FilePathRequest) {
    return this.files.exists(input.filePath);
  }
}
