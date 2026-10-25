import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { secureFs } from '@automaker/platform';
import { SecurityService } from '../../../src/core/security/security.service.js';
import { parseRuntimeConfig, RuntimePathsService } from '../../../src/core/config/index.js';
import { FilePipelineConfigurationRepository } from '../../../src/services/pipeline-config.repository.js';
import { PipelineService } from '../../../src/services/pipeline-service.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('native pipeline configuration repository', () => {
  let root: string;
  const step = { name: 'Review', order: 0, instructions: 'Review only', colorClass: 'blue' };
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'automaker-pipeline-repo-'));
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });
  function nativeRepository() {
    const security = new SecurityService(
      new RuntimePathsService(
        parseRuntimeConfig({ DATA_DIR: root, ALLOWED_ROOT_DIRECTORY: root }, root),
        root
      )
    );
    const filesystem = secureFs.createSecureFs((candidate, options) =>
      security.validateLocalPath(candidate, 'pipeline fixture', options?.followFinalSymlink)
    );
    return new FilePipelineConfigurationRepository(
      filesystem,
      (project) => filesystem.mkdir(path.join(project, '.automaker'), { recursive: true }),
      (project) => security.validateLocalPath(project),
      { strictRead: true }
    );
  }

  it('serializes concurrent read-modify-write without losing steps or colliding temporary files', async () => {
    const repository = nativeRepository(),
      service = new PipelineService(repository);
    const steps = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        service.addStep(root, { ...step, name: `Review ${index}` })
      )
    );
    const stored = await service.getPipelineConfig(root);
    expect(stored.steps.map(({ id }) => id).sort()).toEqual(steps.map(({ id }) => id).sort());
    expect(stored.steps.map(({ order }) => order)).toEqual(
      Array.from({ length: 20 }, (_, index) => index)
    );
    expect(
      JSON.parse(await readFile(path.join(root, '.automaker/pipeline.json'), 'utf8')).steps
    ).toHaveLength(20);
    await repository.onModuleDestroy();
  });

  it.skipIf(process.platform === 'win32')('uses the same queue for canonical aliases', async () => {
    const project = path.join(root, 'project'),
      alias = path.join(root, 'alias');
    await mkdir(project);
    await symlink(project, alias);
    const repository = nativeRepository(),
      service = new PipelineService(repository);
    await Promise.all([service.addStep(project, step), service.addStep(alias, step)]);
    expect((await service.getPipelineConfig(alias)).steps).toHaveLength(2);
    await repository.onModuleDestroy();
  });

  it('does not convert a denied/unknown read into empty config or overwrite it', async () => {
    const failure = Object.assign(new Error('private fixture path'), { code: 'EACCES' });
    const filesystem = {
      readFile: vi.fn().mockRejectedValue(failure),
      writeFile: vi.fn(),
      rename: vi.fn(),
      unlink: vi.fn(),
    };
    const directory = vi.fn();
    const repository = new FilePipelineConfigurationRepository(
      filesystem,
      directory,
      path.resolve,
      { strictRead: true }
    );
    await expect(new PipelineService(repository).addStep(root, step)).rejects.toBe(failure);
    expect(directory).not.toHaveBeenCalled();
    expect(filesystem.writeFile).not.toHaveBeenCalled();
    await repository.onModuleDestroy();
  });

  it('drains accepted writes before rejecting further admission and preserves one close promise', async () => {
    const entered = deferred(),
      release = deferred();
    const filesystem = {
      readFile: vi.fn().mockResolvedValue('{"version":1,"steps":[]}'),
      writeFile: vi.fn(async () => {
        entered.resolve();
        await release.promise;
      }),
      rename: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn(),
    };
    const repository = new FilePipelineConfigurationRepository(
      filesystem,
      async () => {},
      path.resolve
    );
    const pending = new PipelineService(repository).addStep(root, step);
    await entered.promise;
    let closed = false;
    const closing = repository.onModuleDestroy();
    closing.then(() => {
      closed = true;
    });
    expect(() => repository.read(root)).toThrow('shutting down');
    expect(repository.onModuleDestroy()).toBe(closing);
    await Promise.resolve();
    expect(closed).toBe(false);
    release.resolve();
    await pending;
    await closing;
    expect(filesystem.rename).toHaveBeenCalledOnce();
  });

  it('retains uncertain work after the drain deadline without replay or later success', async () => {
    vi.useFakeTimers();
    const entered = deferred(),
      release = deferred();
    const filesystem = {
      readFile: vi.fn().mockResolvedValue('{"version":1,"steps":[]}'),
      writeFile: vi.fn(async () => {
        entered.resolve();
        await release.promise;
      }),
      rename: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn(),
    };
    const repository = new FilePipelineConfigurationRepository(
      filesystem,
      async () => {},
      path.resolve,
      { shutdownTimeoutMs: 25 }
    );
    const pending = new PipelineService(repository).addStep(root, step);
    await entered.promise;
    const closing = repository.onModuleDestroy();
    const rejected = expect(closing).rejects.toMatchObject({
      code: 'PIPELINE_CONFIGURATION_CLEANUP_FAILED',
    });
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect((repository as unknown as { accepted: Set<unknown> }).accepted.size).toBe(1);
    release.resolve();
    await pending;
    await expect(repository.onModuleDestroy()).rejects.toMatchObject({
      code: 'PIPELINE_CONFIGURATION_CLEANUP_FAILED',
    });
    expect(filesystem.writeFile).toHaveBeenCalledOnce();
  });

  it('bounds accepted operations without dispatching the rejected request', async () => {
    const entered = deferred(),
      release = deferred();
    const filesystem = {
      readFile: vi.fn(async () => {
        entered.resolve();
        await release.promise;
        return '{"version":1,"steps":[]}';
      }),
      writeFile: vi.fn(),
      rename: vi.fn(),
      unlink: vi.fn(),
    };
    const repository = new FilePipelineConfigurationRepository(
      filesystem,
      async () => {},
      path.resolve,
      { maxAccepted: 1 }
    );
    const first = repository.read(root);
    await entered.promise;
    expect(() => repository.read(root)).toThrow('busy');
    release.resolve();
    await first;
    await repository.onModuleDestroy();
    expect(filesystem.readFile).toHaveBeenCalledOnce();
  });
});
