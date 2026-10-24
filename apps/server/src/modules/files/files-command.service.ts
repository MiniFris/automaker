import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { mapInfrastructureError } from '../../core/errors/index.js';
import { PROJECT_FILE_PORT, type ProjectFilePort } from './project-file.port.js';
import { getBoardDir, getImagesDir } from '@automaker/platform';
import { sanitizeFilename } from '@automaker/utils';
import { UnavailableDomainError, ValidationDomainError } from '../../core/errors/index.js';
import path from 'node:path';
import type { SaveImageRequest } from './files.schemas.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

@Injectable()
export class FilesCommandService implements OnModuleDestroy {
  private writes: Promise<unknown> = Promise.resolve();
  private closing = false;
  private pending = 0;
  private shutdown?: Promise<void>;
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
    if (this.closing) throw new UnavailableDomainError('File commands are closing.');
    if (this.pending >= 256) throw new UnavailableDomainError('File command queue is full.');
    this.pending++;
    const operation = this.writes.then(work).finally(() => {
      this.pending--;
    });
    this.writes = operation.catch(() => {});
    try {
      const result = await operation;
      return { success: true, ...(includePath && { path: result }) };
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error;
      throw mapInfrastructureError(error);
    }
  }

  onModuleDestroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.closing = true;
    const deadline = performance.now() + 5000;
    const failure = () =>
      Object.assign(new Error('File command drain could not be confirmed.'), {
        code: 'FILE_COMMAND_DRAIN_UNCONFIRMED',
      });
    let timer: NodeJS.Timeout | undefined;
    this.shutdown = Promise.race([
      this.writes.then(() => {
        if (performance.now() >= deadline) throw failure();
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(failure()), 5000);
      }),
    ]).finally(() => clearTimeout(timer));
    return this.shutdown;
  }
}
