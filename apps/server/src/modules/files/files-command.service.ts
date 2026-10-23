import { Inject, Injectable } from '@nestjs/common';
import { mapInfrastructureError } from '../../core/errors/index.js';
import { PROJECT_FILE_PORT, type ProjectFilePort } from './project-file.port.js';
import { getBoardDir, getImagesDir } from '@automaker/platform';
import { sanitizeFilename } from '@automaker/utils';
import { ValidationDomainError } from '../../core/errors/index.js';
import path from 'node:path';
import type { SaveImageRequest } from './files.schemas.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

@Injectable()
export class FilesCommandService {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(@Inject(PROJECT_FILE_PORT) private readonly files: ProjectFilePort) {}

  write(filePath: string, content: string) {
    return this.serialize(() => this.files.write(filePath, content));
  }
  mkdir(dirPath: string) {
    return this.serialize(() => this.files.mkdir(dirPath));
  }
  remove(filePath: string) {
    return this.serialize(() => this.files.remove(filePath));
  }
  copy(sourcePath: string, destinationPath: string, overwrite: boolean) {
    return this.serialize(() => this.files.copy(sourcePath, destinationPath, overwrite));
  }
  move(sourcePath: string, destinationPath: string, overwrite: boolean) {
    return this.serialize(() => this.files.move(sourcePath, destinationPath, overwrite));
  }

  saveImage(input: SaveImageRequest, boardBackground = false) {
    return this.serialize(async () => {
      const content = this.decodeImage(input.data);
      const extension = path.extname(input.filename).toLowerCase() || '.png';
      if (!IMAGE_EXTENSIONS.has(extension)) {
        throw new ValidationDomainError('Unsupported image type.');
      }
      const directory = boardBackground
        ? getBoardDir(input.projectPath)
        : getImagesDir(input.projectPath);
      const filename = boardBackground
        ? `background${extension}`
        : `${sanitizeFilename(path.basename(input.filename, extension), 'image')}-${Date.now()}${extension}`;
      const filePath = path.join(directory, filename);
      await this.files.writeBuffer(filePath, content);
      return filePath;
    }, true);
  }

  deleteBoardBackground(projectPath: string) {
    return this.serialize(async () => {
      try {
        const directory = getBoardDir(projectPath);
        for (const entry of await this.files.list(directory)) {
          if (entry.name.startsWith('background')) {
            await this.files.remove(path.join(directory, entry.name));
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
      }
    });
  }

  private decodeImage(data: string): Buffer {
    const encoded = data.replace(/^data:[^,]+,/, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw new ValidationDomainError('Invalid base64 image data.');
    }
    const content = Buffer.from(encoded, 'base64');
    if (!content.length || content.length > MAX_IMAGE_BYTES) {
      throw new ValidationDomainError('Image exceeds the 20 MiB limit.');
    }
    return content;
  }

  private async serialize(
    work: () => Promise<void | string>,
    includePath = false
  ): Promise<Record<string, unknown>> {
    const operation = this.writes.then(work);
    this.writes = operation.catch(() => {});
    try {
      const result = await operation;
      return { success: true, ...(includePath && { path: result }) };
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error;
      throw mapInfrastructureError(error);
    }
  }
}
