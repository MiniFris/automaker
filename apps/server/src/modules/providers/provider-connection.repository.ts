import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CliConnectionProvider, ProviderConnectionTarget } from '@automaker/contracts';
import { RuntimePathsService } from '../../core/config/index.js';
import { UnavailableDomainError } from '../../core/errors/domain-errors.js';

const DISCONNECTED_MARKERS: Readonly<Record<string, string>> = Object.freeze({
  claude: '.claude-disconnected',
  codex: '.codex-disconnected',
  cursor: '.cursor-disconnected',
  opencode: '.opencode-disconnected',
  gemini: '.gemini-disconnected',
  copilot: '.copilot-disconnected',
});

@Injectable()
export class ProviderConnectionRepository {
  private readonly instanceId = randomUUID();
  constructor(private readonly paths: RuntimePathsService) {}

  static forWorkingDirectory(workingDirectory: string): ProviderConnectionRepository {
    return new ProviderConnectionRepository({
      resolveFromWorkingDirectory: (...segments: string[]) =>
        path.resolve(workingDirectory, ...segments),
    } as RuntimePathsService);
  }

  isDisconnected(providerName: string): boolean {
    const marker = this.marker(providerName.toLowerCase());
    if (!marker) return false;
    try {
      this.assertDirectory(fs.lstatSync(this.directory()));
      this.assertMarker(fs.lstatSync(path.join(this.directory(), marker)));
      return true;
    } catch (error) {
      if (this.isMissing(error)) return false;
      throw new UnavailableDomainError('Provider connection state is unavailable.');
    }
  }

  target(provider: CliConnectionProvider): ProviderConnectionTarget {
    if (!this.marker(provider)) throw new UnavailableDomainError('Unknown provider connection.');
    return {
      kind: 'host-application',
      instanceId: this.instanceId,
      provider,
      workingDirectory: this.paths.resolveFromWorkingDirectory(),
    };
  }

  async disconnect(provider: CliConnectionProvider): Promise<void> {
    const marker = this.marker(provider);
    if (!marker) throw new UnavailableDomainError('Unknown provider connection.');
    try {
      await fs.promises.mkdir(this.directory(), { recursive: true });
      this.assertDirectory(await fs.promises.lstat(this.directory()));
      const file = path.join(this.directory(), marker);
      try {
        // Presence is the persisted state. Exclusive empty-file creation avoids
        // truncating an old marker, following a marker symlink or partial JSON.
        const handle = await fs.promises.open(file, 'wx', 0o600);
        await handle.close();
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST')
          throw error;
        this.assertMarker(await fs.promises.lstat(file));
      }
    } catch {
      throw new UnavailableDomainError('Provider connection state could not be saved.');
    }
  }

  private directory(): string {
    return this.paths.resolveFromWorkingDirectory('.automaker');
  }

  async reconnect(provider: CliConnectionProvider): Promise<void> {
    const marker = this.marker(provider);
    if (!marker) throw new UnavailableDomainError('Unknown provider connection.');
    try {
      this.assertDirectory(await fs.promises.lstat(this.directory()));
      const file = path.join(this.directory(), marker);
      this.assertMarker(await fs.promises.lstat(file));
      await fs.promises.unlink(file);
    } catch (error) {
      // Only absent state means already connected; never hide permission/type errors.
      if (this.isMissing(error)) return;
      throw new UnavailableDomainError('Provider connection state could not be saved.');
    }
  }

  private marker(name: string): string | undefined {
    return Object.hasOwn(DISCONNECTED_MARKERS, name) ? DISCONNECTED_MARKERS[name] : undefined;
  }

  private assertDirectory(stat: fs.Stats): void {
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('Invalid connection directory.');
  }

  private assertMarker(stat: fs.Stats): void {
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Invalid connection marker.');
  }

  private isMissing(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
  }
}
