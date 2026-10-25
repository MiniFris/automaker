import type { ImageQueryInput } from './application.inputs.js';

import path from 'node:path';
import { NotFoundDomainError, ValidationDomainError } from '../../core/errors/domain-errors.js';
import { SecurityService } from '../../core/security/security.service.js';
import { type ProjectFilePort } from './project-file.port.js';

import {
  IMAGE_FILE_MIME_TYPES,
  IMAGE_MAX_BYTES,
} from '@automaker/contracts/domains/files-binary-responses';

export class ImageQueryService {
  constructor(
    private readonly files: ProjectFilePort,
    private readonly security: SecurityService
  ) {}

  async load(input: ImageQueryInput): Promise<{ content: Buffer; mimeType: string }> {
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
