import { Inject, Injectable } from '@nestjs/common';
import path from 'node:path';
import { NotFoundDomainError, ValidationDomainError } from '../../core/errors/index.js';
import { SecurityService } from '../../core/security/security.service.js';
import { PROJECT_FILE_PORT, type ProjectFilePort } from './project-file.port.js';
import type { ImageQuery } from './files.schemas.js';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

@Injectable()
export class ImageQueryService {
  constructor(
    @Inject(PROJECT_FILE_PORT) private readonly files: ProjectFilePort,
    @Inject(SecurityService) private readonly security: SecurityService
  ) {}

  async load(input: ImageQuery): Promise<{ content: Buffer; mimeType: string }> {
    const candidate = path.isAbsolute(input.path)
      ? input.path
      : input.projectPath
        ? path.join(input.projectPath, input.path)
        : input.path;
    const filePath = this.security.validateLocalPath(candidate, 'serve project image');
    const extension = path.extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES[extension];
    if (!mimeType) throw new ValidationDomainError('Unsupported image type.');
    if (!(await this.files.exists(filePath))) throw new NotFoundDomainError('Image not found');
    const stats = await this.files.stat(filePath);
    if (stats.size > 20 * 1024 * 1024) {
      throw new ValidationDomainError('Image exceeds the 20 MiB limit.');
    }
    return { content: await this.files.readBuffer(filePath), mimeType };
  }
}
