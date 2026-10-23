import { Inject, Injectable } from '@nestjs/common';
import { mapInfrastructureError } from '../../core/errors/index.js';
import { PROJECT_FILE_PORT, type ProjectFilePort } from './project-file.port.js';

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

  private async serialize(work: () => Promise<void>): Promise<Record<string, unknown>> {
    const operation = this.writes.then(work);
    this.writes = operation.catch(() => {});
    try {
      await operation;
      return { success: true };
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error;
      throw mapInfrastructureError(error);
    }
  }
}
