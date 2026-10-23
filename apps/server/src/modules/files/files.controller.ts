import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import {
  DirectoryPathRequestSchema,
  FilePathRequestSchema,
  type DirectoryPathRequest,
  type FilePathRequest,
  TransferFileRequestSchema,
  WriteFileRequestSchema,
  type TransferFileRequest,
  type WriteFileRequest,
} from './files.schemas.js';
import { FilesQueryService } from './files-query.service.js';
import { FilesCommandService } from './files-command.service.js';

@Controller('fs')
@UseGuards(AllowedPathGuard)
export class FilesController {
  constructor(
    @Inject(FilesQueryService) private readonly files: FilesQueryService,
    @Inject(FilesCommandService) private readonly commands: FilesCommandService
  ) {}

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

  @Post('write')
  @HttpCode(200)
  @AllowedPathFields('filePath')
  write(@Body(new ZodValidationPipe(WriteFileRequestSchema)) input: WriteFileRequest) {
    return this.commands.write(input.filePath, input.content);
  }

  @Post('mkdir')
  @HttpCode(200)
  @AllowedPathFields('dirPath')
  mkdir(@Body(new ZodValidationPipe(DirectoryPathRequestSchema)) input: DirectoryPathRequest) {
    return this.commands.mkdir(input.dirPath);
  }

  @Post('delete')
  @HttpCode(200)
  @AllowedPathFields('filePath')
  remove(@Body(new ZodValidationPipe(FilePathRequestSchema)) input: FilePathRequest) {
    return this.commands.remove(input.filePath);
  }

  @Post('copy')
  @HttpCode(200)
  @AllowedPathFields('sourcePath', 'destinationPath')
  copy(@Body(new ZodValidationPipe(TransferFileRequestSchema)) input: TransferFileRequest) {
    return this.commands.copy(input.sourcePath, input.destinationPath, input.overwrite);
  }

  @Post('move')
  @HttpCode(200)
  @AllowedPathFields('sourcePath', 'destinationPath')
  move(@Body(new ZodValidationPipe(TransferFileRequestSchema)) input: TransferFileRequest) {
    return this.commands.move(input.sourcePath, input.destinationPath, input.overwrite);
  }
}
