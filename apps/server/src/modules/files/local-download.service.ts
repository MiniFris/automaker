import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import type { Response } from 'express';
import type * as Filesystem from '../../lib/secure-fs.js';
import { SECURE_FILESYSTEM, SecurityService } from '../../core/security/index.js';
import { RuntimePathsService } from '../../core/config/index.js';
import { UnavailableDomainError, ValidationDomainError } from '../../core/errors/index.js';
import { writeLocalArchive, type ArchiveEntry } from './local-zip-archive.js';

const MAX_DIRECTORY_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 500 * 1024 * 1024;
interface DownloadJob {
  controller: AbortController;
  promise: Promise<void>;
}

@Injectable()
export class LocalDownloadService {
  private readonly active = new Set<DownloadJob>();
  private stopping = false;
  private cleanupFailed = false;
  private shutdown?: Promise<void>;
  constructor(
    @Inject(SecurityService) private readonly security: SecurityService,
    @Inject(SECURE_FILESYSTEM) private readonly filesystem: typeof Filesystem,
    @Inject(RuntimePathsService) private readonly paths: RuntimePathsService
  ) {}

  stream(candidate: string, response: Response): Promise<void> {
    if (this.stopping || this.active.size >= 8)
      return Promise.reject(new UnavailableDomainError('Downloads are unavailable.'));
    const controller = new AbortController();
    const disconnected = () => {
      if (!response.writableFinished) controller.abort();
    };
    response.once('close', disconnected);
    if (response.destroyed) controller.abort();
    const job: DownloadJob = { controller, promise: Promise.resolve() };
    job.promise = this.perform(candidate, response, controller.signal).finally(() => {
      response.off('close', disconnected);
      this.active.delete(job);
    });
    this.active.add(job);
    return job.promise;
  }

  private async perform(candidate: string, response: Response, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const filePath = this.security.validateLocalPath(candidate, 'download local file');
    const stats = await this.filesystem.stat(filePath);
    signal.throwIfAborted();
    if (!stats.isFile() && !stats.isDirectory())
      throw new ValidationDomainError('Only files and directories can be downloaded.');
    if (stats.isFile()) {
      if (Number(stats.size) > MAX_FILE_BYTES)
        throw new ValidationDomainError('File exceeds the 500 MiB download limit.');
      this.headers(
        response,
        path.basename(filePath),
        'application/octet-stream',
        Number(stats.size)
      );
      await this.filesystem.pipeFile(filePath, response, { signal, maxBytes: Number(stats.size) });
      return;
    }
    if (path.dirname(filePath) === filePath)
      throw new ValidationDomainError('Select a directory below the filesystem root.');
    const storage = this.security.validateLocalPath(
      path.join(this.paths.dataDirectory, '.automaker-downloads'),
      'download storage'
    );
    const state = { bytes: 0, names: 0, entries: [] as ArchiveEntry[] };
    await this.scan(filePath, path.basename(filePath), storage, signal, state, 0);
    signal.throwIfAborted();
    const temporary = path.join(storage, randomUUID());
    const archivePath = path.join(temporary, 'archive.zip');
    await this.filesystem.mkdir(temporary, { recursive: true, mode: 0o700 });
    try {
      await writeLocalArchive(this.filesystem, state.entries, archivePath, MAX_FILE_BYTES, signal);
      signal.throwIfAborted();
      const archive = await this.filesystem.stat(archivePath);
      this.headers(
        response,
        `${path.basename(filePath)}.zip`,
        'application/zip',
        Number(archive.size)
      );
      response.setHeader('X-Directory-Size', String(state.bytes));
      await this.filesystem.pipeFile(archivePath, response, {
        signal,
        maxBytes: Number(archive.size),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'STREAM_BYTE_LIMIT')
        throw new ValidationDomainError('Archive exceeds the 500 MiB download limit.');
      throw error;
    } finally {
      await this.removeTemporary(temporary);
    }
  }

  private async removeTemporary(temporary: string): Promise<void> {
    try {
      await this.filesystem.rm(temporary, { recursive: true, force: true });
    } catch {
      this.cleanupFailed = true;
      throw new UnavailableDomainError('Download cleanup could not be confirmed.');
    }
  }

  private headers(response: Response, name: string, type: string, bytes: number): void {
    response.setHeader('Content-Type', type);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${name.replace(/["\r\n]/g, '_')}"`
    );
    response.setHeader('Content-Length', String(bytes));
  }

  private async scan(
    source: string,
    name: string,
    excluded: string,
    signal: AbortSignal,
    state: { bytes: number; names: number; entries: ArchiveEntry[] },
    depth: number
  ): Promise<void> {
    signal.throwIfAborted();
    if (source === excluded) return;
    if (depth > 64) throw new ValidationDomainError('Directory is too deeply nested.');
    if (state.entries.length >= 10_000)
      throw new ValidationDomainError('Directory has too many entries.');
    if (name.includes('\\'))
      throw new ValidationDomainError('Directory contains an unsupported file name.');
    const stats = await this.filesystem.lstat(source);
    if (stats.isSymbolicLink()) return;
    if (!stats.isFile() && !stats.isDirectory())
      throw new ValidationDomainError('Directory contains an unsupported file type.');
    state.names += Buffer.byteLength(name, 'utf8') + 46;
    if (state.names > 2 * 1024 * 1024)
      throw new ValidationDomainError('Directory archive metadata exceeds the 2 MiB limit.');
    state.entries.push({
      source,
      name,
      bytes: Number(stats.size),
      directory: stats.isDirectory(),
      mode: Number(stats.mode),
      modified: stats.mtime,
    });
    if (stats.isFile()) {
      state.bytes += Number(stats.size);
      if (state.bytes > MAX_DIRECTORY_BYTES)
        throw new ValidationDomainError('Directory exceeds the 100 MiB download limit.');
      return;
    }
    for (const entry of await this.filesystem.readdir(source, { withFileTypes: true }))
      await this.scan(
        path.join(source, entry.name),
        `${name}/${entry.name}`,
        excluded,
        signal,
        state,
        depth + 1
      );
  }

  onModuleDestroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopping = true;
    this.shutdown = Promise.resolve().then(async () => {
      for (const job of this.active) job.controller.abort();
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          Promise.allSettled([...this.active].map((job) => job.promise)),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new UnavailableDomainError('Download cleanup could not be confirmed.')),
              5000
            );
          }),
        ]);
        if (this.cleanupFailed)
          throw new UnavailableDomainError('Download cleanup could not be confirmed.');
      } finally {
        if (timer) clearTimeout(timer);
      }
    });
    return this.shutdown;
  }
}
