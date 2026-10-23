import { Inject, Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import type { Response } from 'express';

import { ValidationDomainError } from '../../core/errors/index.js';
import { SecurityService } from '../../core/security/security.service.js';
import * as secureFs from '../../lib/secure-fs.js';

const executeFile = promisify(execFile);
const MAX_DIRECTORY_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 500 * 1024 * 1024;

@Injectable()
export class LocalDownloadService {
  constructor(@Inject(SecurityService) private readonly security: SecurityService) {}

  async stream(candidate: string, response: Response): Promise<void> {
    const filePath = this.security.validateLocalPath(candidate, 'download local file');
    const stats = await secureFs.stat(filePath);
    if (!stats.isDirectory() && Number(stats.size) > MAX_FILE_BYTES) {
      throw new ValidationDomainError('File exceeds the 500 MiB download limit.');
    }
    if (!stats.isDirectory()) {
      response.setHeader('Content-Type', 'application/octet-stream');
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${path.basename(filePath).replace(/["\r\n]/g, '_')}"`
      );
      response.setHeader('Content-Length', String(stats.size));
      await this.pipe(createReadStream(filePath), response);
      return;
    }

    const size = await this.directorySize(filePath, MAX_DIRECTORY_BYTES);
    const archiveName = `${path.basename(filePath)}.zip`;
    const archivePath = path.join(
      os.tmpdir(),
      `automaker-download-${process.pid}-${Date.now()}-${archiveName}`
    );
    try {
      await executeFile('zip', ['-r', archivePath, path.basename(filePath)], {
        cwd: path.dirname(filePath),
        maxBuffer: 50 * 1024 * 1024,
      });
      const archive = await secureFs.stat(archivePath);
      response.setHeader('Content-Type', 'application/zip');
      response.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);
      response.setHeader('Content-Length', String(archive.size));
      response.setHeader('X-Directory-Size', String(size));
      await this.pipe(createReadStream(archivePath), response);
    } finally {
      await secureFs.rm(archivePath).catch(() => {});
    }
  }

  private async directorySize(directory: string, limit: number): Promise<number> {
    let total = 0;
    for (const entry of await secureFs.readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      total += entry.isDirectory()
        ? await this.directorySize(child, limit - total)
        : Number((await secureFs.stat(child)).size);
      if (total > limit) {
        throw new ValidationDomainError('Directory exceeds the 100 MiB download limit.');
      }
    }
    return total;
  }

  private pipe(stream: ReturnType<typeof createReadStream>, response: Response): Promise<void> {
    return new Promise((resolve, reject) => {
      stream.once('error', reject);
      response.once('error', reject);
      response.once('finish', resolve);
      stream.pipe(response);
    });
  }
}
