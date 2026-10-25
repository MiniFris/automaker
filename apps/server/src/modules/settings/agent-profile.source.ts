import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { HOST_PROFILE_CONFIG, type HostProfileConfig } from '../../core/config/index.js';
import { ForbiddenDomainError, UnavailableDomainError } from '../../core/errors/index.js';
import type { AgentDiscoveryEntry, AgentDiscoveryFilesystem } from '../../lib/agent-discovery.js';

/** Host-profile reads are separate from the application's project write capability. */
export abstract class AgentProfileSource implements AgentDiscoveryFilesystem {
  abstract readonly directory: string | undefined;
  abstract exists(file: string): Promise<boolean>;
  abstract readdir(directory: string): Promise<AgentDiscoveryEntry[]>;
  abstract readFile(file: string): Promise<string>;
}

@Injectable()
export class NodeAgentProfileSource extends AgentProfileSource {
  readonly directory: string | undefined;
  private readonly home: string | undefined;
  private canonicalRoot?: string;
  private readonly active = new Set<Promise<unknown>>();
  private closing?: Promise<void>;

  private read<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing)
      return Promise.reject(new UnavailableDomainError('Agent profile reads are shutting down.'));
    if (this.active.size >= 256)
      return Promise.reject(new UnavailableDomainError('Agent profile reads are busy.'));
    const task = Promise.resolve().then(operation);
    this.active.add(task);
    void task.then(
      () => this.active.delete(task),
      () => this.active.delete(task)
    );
    return task;
  }

  onModuleDestroy(): Promise<void> {
    if (this.closing) return this.closing;
    let timer: NodeJS.Timeout;
    this.closing = Promise.race([
      Promise.allSettled([...this.active]).then(() => undefined),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new UnavailableDomainError('Agent profile read cleanup could not be confirmed.')
            ),
          5000
        );
      }),
    ]).finally(() => clearTimeout(timer));
    return this.closing;
  }

  constructor(@Inject(HOST_PROFILE_CONFIG) profile: HostProfileConfig) {
    super();
    if (profile.homeDirectory && !path.isAbsolute(profile.homeDirectory))
      throw new UnavailableDomainError('Agent profile configuration must be absolute.');
    this.home = profile.homeDirectory;
    this.directory = this.home ? path.join(this.home, '.claude', 'agents') : undefined;
  }

  private inside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  }

  private async checked(candidate: string): Promise<string> {
    if (!this.directory || !this.home || !this.inside(this.directory, path.resolve(candidate)))
      throw new ForbiddenDomainError('Agent profile path is outside its configured directory.');
    const [home, root] = await Promise.all([fs.realpath(this.home), fs.realpath(this.directory)]);
    if (!this.inside(home, root) || (this.canonicalRoot && this.canonicalRoot !== root))
      throw new ForbiddenDomainError('Agent profile directory changed or escaped its home.');
    this.canonicalRoot = root;
    const resolved = await fs.realpath(candidate);
    if (!this.inside(root, resolved))
      throw new ForbiddenDomainError('Agent profile path escaped its directory.');
    return resolved;
  }

  async exists(file: string): Promise<boolean> {
    return this.read(async () => {
      try {
        await this.checked(file);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
        throw error;
      }
    });
  }

  async readdir(directory: string): Promise<AgentDiscoveryEntry[]> {
    return this.read(async () => {
      const entries: AgentDiscoveryEntry[] = [];
      for (const name of await fs.readdir(await this.checked(directory))) {
        const stat = await fs.stat(await this.checked(path.join(directory, name)));
        entries.push({ name, isFile: stat.isFile(), isDirectory: stat.isDirectory() });
      }
      return entries;
    });
  }

  async readFile(file: string): Promise<string> {
    return this.read(async () => fs.readFile(await this.checked(file), 'utf8'));
  }
}
