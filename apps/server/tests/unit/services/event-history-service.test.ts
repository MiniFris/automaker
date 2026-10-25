import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const filesystem = vi.hoisted(() => ({
  lstat: vi.fn().mockRejectedValue(Object.assign(new Error('Missing'), { code: 'ENOENT' })),
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn(),
  copyFile: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/lib/secure-fs.js', () => filesystem);
vi.mock('@automaker/platform', () => ({
  ensureEventHistoryDir: vi.fn().mockResolvedValue(undefined),
  getEventHistoryIndexPath: (projectPath: string) => `${projectPath}/events/index.json`,
  getEventPath: (projectPath: string, eventId: string) => `${projectPath}/events/${eventId}.json`,
}));

import { EventHistoryService } from '../../../src/services/event-history-service.js';

describe('EventHistoryService retention', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns history in newest-first order and applies pagination', async () => {
    filesystem.readFile.mockResolvedValue(
      JSON.stringify({
        version: 1,
        events: [
          { id: 'old', trigger: 'feature_created', timestamp: '2026-01-01T00:00:00.000Z' },
          { id: 'new', trigger: 'feature_success', timestamp: '2026-01-03T00:00:00.000Z' },
          { id: 'middle', trigger: 'feature_error', timestamp: '2026-01-02T00:00:00.000Z' },
        ],
      })
    );

    await expect(
      new EventHistoryService(filesystem, path.resolve).getEvents('/project', { limit: 2 })
    ).resolves.toEqual([
      expect.objectContaining({ id: 'new' }),
      expect.objectContaining({ id: 'middle' }),
    ]);
  });

  it('bounds history to 1000 entries and deletes the oldest event file', async () => {
    const events = Array.from({ length: 1_000 }, (_, index) => ({
      id: `event-${index}`,
      trigger: 'feature_created',
      timestamp: new Date(index).toISOString(),
    }));
    filesystem.readFile.mockResolvedValue(JSON.stringify({ version: 1, events }));

    await new EventHistoryService(filesystem, path.resolve).storeEvent({
      projectPath: '/project',
      trigger: 'feature_success',
    });

    expect(filesystem.unlink).toHaveBeenCalledWith('/project/events/event-999.json');
    const indexWrite = filesystem.writeFile.mock.calls.find(([filePath]) =>
      String(filePath).startsWith('/project/events/index.json.write.')
    );
    expect(indexWrite).toBeDefined();
    const persisted = JSON.parse(String(indexWrite?.[1])) as { events: unknown[] };
    expect(persisted.events).toHaveLength(1_000);
  });

  it('cleans all event files and resets the index', async () => {
    filesystem.readFile.mockResolvedValue(
      JSON.stringify({
        version: 1,
        events: [
          { id: 'one', trigger: 'feature_created', timestamp: '2026-01-01T00:00:00.000Z' },
          { id: 'two', trigger: 'feature_error', timestamp: '2026-01-02T00:00:00.000Z' },
        ],
      })
    );

    await expect(
      new EventHistoryService(filesystem, path.resolve).clearEvents('/project')
    ).resolves.toBe(2);
    expect(filesystem.unlink).toHaveBeenCalledWith('/project/events/one.json');
    expect(filesystem.unlink).toHaveBeenCalledWith('/project/events/two.json');
  });
});
