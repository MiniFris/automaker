import { describe, expect, it, vi } from 'vitest';
import { FilesQueryService } from '@/modules/files/files-query.service.js';
import type { ProjectFilePort } from '@/modules/files/project-file.port.js';

describe('FilesQueryService', () => {
  it('delegates read-only operations through the file port', async () => {
    const port: ProjectFilePort = {
      read: vi.fn().mockResolvedValue('content'),
      list: vi.fn().mockResolvedValue([{ name: 'src', isDirectory: true, isFile: false }]),
      stat: vi.fn().mockResolvedValue({
        isDirectory: false,
        isFile: true,
        size: 7,
        mtime: new Date('2026-01-01T00:00:00Z'),
      }),
      exists: vi.fn().mockResolvedValue(true),
      write: vi.fn(),
      mkdir: vi.fn(),
      remove: vi.fn(),
      copy: vi.fn(),
      move: vi.fn(),
      readBuffer: vi.fn(),
      writeBuffer: vi.fn(),
    };
    const service = new FilesQueryService(port, {} as never);

    await expect(service.read('/project/a.txt')).resolves.toEqual({
      success: true,
      content: 'content',
    });
    await expect(service.list('/project')).resolves.toMatchObject({ success: true });
    await expect(service.stat('/project/a.txt')).resolves.toMatchObject({
      success: true,
      stats: { size: 7 },
    });
    await expect(service.exists('/project/a.txt')).resolves.toEqual({
      success: true,
      exists: true,
    });
  });

  it('maps missing files to a stable not-found domain error', async () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const service = new FilesQueryService(
      {
        read: vi.fn().mockRejectedValue(missing),
        list: vi.fn(),
        stat: vi.fn().mockRejectedValue(missing),
        exists: vi.fn(),
        write: vi.fn(),
        mkdir: vi.fn(),
        remove: vi.fn(),
        copy: vi.fn(),
        move: vi.fn(),
        readBuffer: vi.fn(),
        writeBuffer: vi.fn(),
      },
      {} as never
    );

    await expect(service.read('/project/missing')).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'NOT_FOUND',
    });
    await expect(service.stat('/project/missing')).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'NOT_FOUND',
    });
  });
});
