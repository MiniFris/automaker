import { Inject, Injectable } from '@nestjs/common';
import path from 'node:path';
import { NotFoundDomainError, ValidationDomainError } from '../../core/errors/index.js';
import { SecurityService } from '../../core/security/security.service.js';
import { PROJECT_FILE_PORT, type ProjectFilePort } from './project-file.port.js';
import type { ImageQuery } from './files.schemas.js';
import {
  IMAGE_FILE_MIME_TYPES,
  IMAGE_MAX_BYTES,
} from '@automaker/contracts/domains/files-binary-responses';

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
    const mimeType = IMAGE_FILE_MIME_TYPES[extension];
    if (!mimeType) throw new ValidationDomainError('Unsupported image type.');
    if (!(await this.files.exists(filePath))) throw new NotFoundDomainError('Image not found');
    const stats = await this.files.stat(filePath);
    if (stats.size > IMAGE_MAX_BYTES) {
      throw new ValidationDomainError('Image exceeds the 20 MiB limit.');
    }
    return { content: await this.files.readBuffer(filePath), mimeType };
  }
}
