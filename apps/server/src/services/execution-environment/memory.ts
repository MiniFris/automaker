import path from 'node:path';
import { TextDecoder } from 'node:util';
import type { ExecutionEnvironmentBinding } from '@automaker/types';
import {
  countMatches,
  extractTerms,
  formatLearning,
  parseFrontmatter,
  serializeFrontmatter,
  type LearningEntry,
  type MemoryFileInfo,
  type MemoryMetadata,
  type SimpleMemoryFile,
} from '@automaker/utils';
import { ExecutionEnvironmentError, type ExecutionEnvironment } from './runtime.js';
import { nodeCommand } from './ssh-transport.js';
import { sshSerialized } from './ssh-state.js';
import { MEMORY_WORKER } from './memory-worker.js';

interface MemorySnapshot {
  name: string;
  data: string;
  sha256: string;
}

/** A callback gets a writer, not a controller filesystem path pretending to be remote. */
export interface FeatureMemoryWriter {
  readonly projectRoot: string;
  appendLearning(learning: LearningEntry): Promise<void>;
}

/** Shared project memory, pinned to the run's backend even after settings change. */
export class RuntimeMemoryStore {
  readonly projectRoot: string;
  private readonly serializationKey: string;
  constructor(
    private readonly environment: ExecutionEnvironment,
    binding: ExecutionEnvironmentBinding
  ) {
    this.projectRoot = binding.ssh?.remotePath ?? binding.projectPath;
    this.serializationKey = `memory\0${environment.type}\0${
      binding.ssh?.identity ?? binding.docker?.containerId ?? ''
    }\0${this.projectRoot}`;
    if (
      !['docker', 'ssh', 'local'].includes(binding.type) ||
      binding.type !== environment.type ||
      environment.cwd !== (binding.runtimeCwd ?? binding.cwd) ||
      (binding.type === 'ssh' && !binding.ssh) ||
      !['linux', 'darwin'].includes(environment.platform)
    )
      throw new ExecutionEnvironmentError(
        'MEMORY_RUNTIME_INVALID',
        'Memory requires the pinned POSIX runtime. No host filesystem fallback was used.'
      );
  }

  private async call<T>(request: Record<string, unknown>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    const result = await this.environment.exec(
      nodeCommand(MEMORY_WORKER, [JSON.stringify({ ...request, root: this.projectRoot })]),
      signal,
      { timeoutMs: 30000, maxOutputBytes: 1024 * 1024 }
    );
    if (result.exitCode !== 0 || result.truncated)
      throw new ExecutionEnvironmentError(
        'MEMORY_PROTOCOL_FAILED',
        'Memory worker failed or returned incomplete output. Do not replay an uncertain write.'
      );
    let response: { ok: boolean; result: T; code?: string; error?: string };
    try {
      response = JSON.parse(result.output);
      if (typeof response.ok !== 'boolean') throw new Error('Invalid response');
    } catch {
      throw new ExecutionEnvironmentError(
        'MEMORY_PROTOCOL_FAILED',
        'Memory result is unreadable. No automatic retry or host fallback was used.'
      );
    }
    if (!response.ok)
      throw new ExecutionEnvironmentError(
        response.code ?? 'MEMORY_FAILED',
        response.error ?? 'Target memory operation failed.'
      );
    return response.result;
  }

  private content(file: MemorySnapshot): string {
    return new TextDecoder('utf8', { fatal: true, ignoreBOM: true }).decode(
      Buffer.from(file.data, 'base64')
    );
  }

  async load(signal: AbortSignal, maximumBytes = 65536): Promise<MemoryFileInfo[]> {
    const result = await this.call<{ files: MemorySnapshot[] }>(
      { action: 'list', maximumBytes },
      signal
    );
    return result.files.map((file) => ({
      name: file.name,
      path: path.posix.join(this.projectRoot, '.automaker', 'memory', file.name),
      content: parseFrontmatter(this.content(file)).body,
      category: file.name.slice(0, -3),
    }));
  }

  private async update(
    name: string,
    transform: (current: string | undefined) => string | undefined,
    signal: AbortSignal
  ): Promise<void> {
    await sshSerialized(this.serializationKey, async () => {
      const current = await this.call<MemorySnapshot | null>({ action: 'read', name }, signal);
      const next = transform(current ? this.content(current) : undefined);
      if (next === undefined) return;
      await this.call(
        {
          action: 'write',
          name,
          expected: current?.sha256 ?? null,
          data: Buffer.from(next, 'utf8').toString('base64'),
        },
        signal
      );
    });
  }

  async recordLoaded(files: SimpleMemoryFile[], signal: AbortSignal): Promise<void> {
    for (const name of new Set(files.map((file) => file.name)))
      await this.update(
        name,
        (current) => {
          if (current === undefined) return; // Do not recreate a removed file from stale context.
          const { metadata, body } = parseFrontmatter(current);
          metadata.usageStats.loaded++;
          return serializeFrontmatter(metadata) + '\n' + body;
        },
        signal
      );
  }

  async recordUsage(
    files: SimpleMemoryFile[],
    output: string,
    success: boolean,
    signal: AbortSignal
  ): Promise<void> {
    const outputTerms = extractTerms(output);
    const referenced = new Set(
      files
        .filter((file) => countMatches(extractTerms(file.content), outputTerms) >= 3)
        .map((file) => file.name)
    );
    for (const name of referenced)
      await this.update(
        name,
        (current) => {
          if (current === undefined) return;
          const { metadata, body } = parseFrontmatter(current);
          metadata.usageStats.referenced++;
          if (success) metadata.usageStats.successfulFeatures++;
          return serializeFrontmatter(metadata) + '\n' + body;
        },
        signal
      );
  }

  async appendLearning(learning: LearningEntry, signal: AbortSignal): Promise<void> {
    if (
      !learning ||
      !['decision', 'learning', 'pattern', 'gotcha'].includes(learning.type) ||
      typeof learning.category !== 'string' ||
      !learning.category.trim() ||
      learning.category.length > 120 ||
      typeof learning.content !== 'string' ||
      !learning.content.trim() ||
      ['content', 'context', 'why', 'rejected', 'tradeoffs', 'breaking'].some((key) => {
        const value = learning[key as keyof LearningEntry];
        return value !== undefined && (typeof value !== 'string' || value.length > 8192);
      })
    )
      throw new ExecutionEnvironmentError('MEMORY_LEARNING_INVALID', 'Invalid learning entry.');
    const category =
      learning.category
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '') || 'general';
    // "_index" sanitizes to "index", so learned content never overwrites the memory index.
    await this.update(
      `${category}.md`,
      (current) => {
        if (current !== undefined) return current + '\n' + formatLearning(learning);
        const metadata: MemoryMetadata = {
          tags: [category],
          summary: `${learning.category} implementation decisions and patterns`,
          relevantTo: [category],
          importance: 0.7,
          relatedFiles: [],
          usageStats: { loaded: 0, referenced: 0, successfulFeatures: 0 },
        };
        return (
          serializeFrontmatter(metadata) + `\n# ${learning.category}\n` + formatLearning(learning)
        );
      },
      signal
    );
  }

  writer(signal: AbortSignal): FeatureMemoryWriter {
    return Object.freeze({
      projectRoot: this.projectRoot,
      appendLearning: (learning: LearningEntry) => this.appendLearning(learning, signal),
    });
  }
}
