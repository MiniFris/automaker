import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesCommandService } from '@/modules/files/files-command.service.js';
import { LocalProjectFileAdapter } from '@/modules/files/local-project-file.adapter.js';
import { SecurityService } from '@/core/security/index.js';
import { RuntimePathsService, parseRuntimeConfig } from '@/core/config/index.js';
import { secureFs } from '@automaker/platform';

describe('FilesCommandService', () => {
  let temporary: string;
  let service: FilesCommandService;

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'nest-files-command-'));
    const security = new SecurityService(
      new RuntimePathsService(parseRuntimeConfig({ DATA_DIR: temporary }, temporary), temporary)
    );
    const filesystem = secureFs.createSecureFs((candidate, options) =>
      security.validateLocalPath(candidate, 'filesystem test', options?.followFinalSymlink)
    );
    service = new FilesCommandService(new LocalProjectFileAdapter(filesystem, security));
  });

  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  it('serializes atomic writes and never leaves temporary files', async () => {
    const first = path.join(temporary, 'nested', 'first.txt');
    const second = path.join(temporary, 'nested', 'second.txt');
    await Promise.all([service.write(first, 'one'), service.write(second, 'two')]);

    await expect(readFile(first, 'utf8')).resolves.toBe('one');
    await expect(readFile(second, 'utf8')).resolves.toBe('two');
    const entries = await readdir(path.dirname(first));
    expect(entries.some((name) => name.includes('.tmp.'))).toBe(false);
  });

  it('copies and moves without implicit overwrite', async () => {
    const source = path.join(temporary, 'source.txt');
    const copy = path.join(temporary, 'copy.txt');
    const moved = path.join(temporary, 'moved.txt');
    await writeFile(source, 'source');
    await service.copy(source, copy, false);
    await expect(service.copy(source, copy, false)).rejects.toMatchObject({ statusCode: 409 });
    await service.move(copy, moved, false);
    await expect(readFile(moved, 'utf8')).resolves.toBe('source');
  });

  it('rejects recursive self-copy before touching the destination', async () => {
    const directory = path.join(temporary, 'directory');
    await service.mkdir(directory);
    await expect(
      service.copy(directory, path.join(directory, 'child'), false)
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
