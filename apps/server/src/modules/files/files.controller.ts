import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
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
  BrowseProjectRequestSchema,
  BrowseRequestSchema,
  ResolveDirectoryRequestSchema,
  type BrowseProjectRequest,
  type BrowseRequest,
  type ResolveDirectoryRequest,
  ImageQuerySchema,
  ProjectPathRequestSchema,
  SaveImageRequestSchema,
  type ImageQuery,
  type ProjectPathRequest,
  type SaveImageRequest,
} from './files.schemas.js';
import { FilesQueryService } from './files-query.service.js';
import { FilesCommandService } from './files-command.service.js';
import { ImageQueryService } from './image-query.service.js';
import { LocalDownloadService } from './local-download.service.js';

@Controller('fs')
@UseGuards(AllowedPathGuard)
export class FilesController {
  constructor(
    @Inject(FilesQueryService) private readonly files: FilesQueryService,
    @Inject(FilesCommandService) private readonly commands: FilesCommandService,
    @Inject(ImageQueryService) private readonly images: ImageQueryService,
    @Inject(LocalDownloadService) private readonly downloads: LocalDownloadService
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

  @Post('validate-path')
  @HttpCode(200)
  @AllowedPathFields('filePath')
  validatePath(@Body(new ZodValidationPipe(FilePathRequestSchema)) input: FilePathRequest) {
    return this.files.validatePath(input.filePath);
  }

  @Post('browse')
  @HttpCode(200)
  browse(@Body(new ZodValidationPipe(BrowseRequestSchema)) input: BrowseRequest) {
    return this.files.browse(input.dirPath);
  }

  @Post('browse-project-files')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  browseProject(
    @Body(new ZodValidationPipe(BrowseProjectRequestSchema)) input: BrowseProjectRequest
  ) {
    return this.files.browseProject(input);
  }

  @Post('resolve-directory')
  @HttpCode(200)
  resolveDirectory(
    @Body(new ZodValidationPipe(ResolveDirectoryRequestSchema)) input: ResolveDirectoryRequest
  ) {
    return this.files.resolveDirectory(input);
  }

  @Post('save-image')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  saveImage(@Body(new ZodValidationPipe(SaveImageRequestSchema)) input: SaveImageRequest) {
    return this.commands.saveImage(input);
  }

  @Post('save-board-background')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  saveBoardBackground(
    @Body(new ZodValidationPipe(SaveImageRequestSchema)) input: SaveImageRequest
  ) {
    return this.commands.saveImage(input, true);
  }

  @Post('delete-board-background')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  deleteBoardBackground(
    @Body(new ZodValidationPipe(ProjectPathRequestSchema)) input: ProjectPathRequest
  ) {
    return this.commands.deleteBoardBackground(input.projectPath);
  }

  @Get('image')
  async image(
    @Query(new ZodValidationPipe(ImageQuerySchema)) input: ImageQuery,
    @Res() response: Response
  ): Promise<void> {
    const image = await this.images.load(input);
    response.setHeader('Content-Type', image.mimeType);
    response.setHeader('Cache-Control', 'public, max-age=3600');
    response.send(image.content);
  }

  @Post('download')
  @HttpCode(200)
  @AllowedPathFields('filePath')
  download(
    @Body(new ZodValidationPipe(FilePathRequestSchema)) input: FilePathRequest,
    @Res() response: Response
  ): Promise<void> {
    return this.downloads.stream(input.filePath, response);
  }
}
