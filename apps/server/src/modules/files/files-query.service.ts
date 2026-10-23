import { Inject, Injectable } from '@nestjs/common';
import { NotFoundDomainError, mapInfrastructureError } from '../../core/errors/index.js';
import { PROJECT_FILE_PORT, type ProjectFilePort } from './project-file.port.js';

@Injectable()
export class FilesQueryService {
  constructor(@Inject(PROJECT_FILE_PORT) private readonly files: ProjectFilePort) {}

  async read(filePath: string): Promise<Record<string, unknown>> {
    try {
      return { success: true, content: await this.files.read(filePath) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new NotFoundDomainError('File not found.');
      }
      throw mapInfrastructureError(error);
    }
  }

  async list(dirPath: string): Promise<Record<string, unknown>> {
    try {
      return { success: true, entries: await this.files.list(dirPath) };
    } catch (error) {
      throw mapInfrastructureError(error);
    }
  }

  async stat(filePath: string): Promise<Record<string, unknown>> {
    try {
      return { success: true, stats: await this.files.stat(filePath) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new NotFoundDomainError('File or directory not found');
      }
      throw mapInfrastructureError(error);
    }
  }

  async exists(filePath: string): Promise<Record<string, unknown>> {
    return { success: true, exists: await this.files.exists(filePath) };
  }
}
