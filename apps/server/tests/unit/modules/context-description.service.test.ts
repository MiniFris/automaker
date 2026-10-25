import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextDescriptionService } from '@/modules/context/context-description.service.js';
import type { ContextQueryPort } from '@/modules/context/context-query.port.js';
import type { ProjectFilePort } from '@/modules/files/project-file.port.js';
import * as settingsHelpers from '@/lib/settings-helpers.js';

vi.mock('@/lib/settings-helpers.js', () => ({
  getAutoLoadClaudeMdSetting: vi.fn(),
  getPhaseModelWithOverrides: vi.fn(),
  getPromptCustomization: vi.fn(),
}));

const createFiles = (): ProjectFilePort => ({
  read: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  stat: vi.fn(),
  exists: vi.fn().mockResolvedValue(false),
  write: vi.fn(),
  mkdir: vi.fn(),
  remove: vi.fn(),
  copy: vi.fn(),
  move: vi.fn(),
  readBuffer: vi.fn(),
  writeBuffer: vi.fn(),
});

describe('ContextDescriptionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsHelpers.getAutoLoadClaudeMdSetting).mockResolvedValue(false);
    vi.mocked(settingsHelpers.getPromptCustomization).mockResolvedValue({
      contextDescription: {
        describeFilePrompt: 'Describe file',
        describeImagePrompt: 'Describe image',
      },
    } as never);
    vi.mocked(settingsHelpers.getPhaseModelWithOverrides).mockResolvedValue({
      phaseModel: { model: 'claude-sonnet-4-6' },
      provider: undefined,
      credentials: undefined,
    } as never);
  });

  it('truncates text input and delegates model execution through the query port', async () => {
    const files = createFiles();
    vi.mocked(files.read).mockResolvedValue('x'.repeat(50_001));
    const queries: ContextQueryPort = {
      execute: vi.fn().mockResolvedValue({ text: '  concise description  ' }),
    };
    const service = new ContextDescriptionService(files, queries, {} as never);

    await expect(service.describeFile('/project/large.md', new AbortController())).resolves.toEqual(
      { success: true, description: 'concise description' }
    );

    expect(queries.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/project',
        allowedTools: [],
        readOnly: true,
        prompt: expect.stringContaining('large.md (truncated)'),
      })
    );
    const prompt = vi.mocked(queries.execute).mock.calls[0][0].prompt as string;
    expect(prompt.endsWith('x'.repeat(50_000))).toBe(true);
  });

  it('builds a base64 image block and enforces the image size limit', async () => {
    const files = createFiles();
    vi.mocked(files.exists).mockResolvedValue(true);
    vi.mocked(files.stat).mockResolvedValue({
      isDirectory: false,
      isFile: true,
      size: 3,
      mtime: new Date(),
    });
    vi.mocked(files.readBuffer).mockResolvedValue(Buffer.from('png'));
    const queries: ContextQueryPort = {
      execute: vi.fn().mockResolvedValue({ text: 'an image' }),
    };
    const service = new ContextDescriptionService(files, queries, {} as never);

    await expect(
      service.describeImage('/project/image.png', new AbortController())
    ).resolves.toEqual({ success: true, description: 'an image' });
    expect(queries.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedTools: [],
        prompt: expect.arrayContaining([
          expect.objectContaining({
            type: 'image',
            source: expect.objectContaining({ data: Buffer.from('png').toString('base64') }),
          }),
        ]),
      })
    );

    vi.mocked(files.stat).mockResolvedValue({
      isDirectory: false,
      isFile: true,
      size: 20 * 1024 * 1024 + 1,
      mtime: new Date(),
    });
    await expect(
      service.describeImage('/project/image.png', new AbortController())
    ).rejects.toMatchObject({ statusCode: 413 });
  });

  it('resolves image names with Unicode space variants without querying other directories', async () => {
    const files = createFiles();
    vi.mocked(files.exists).mockImplementation(async (candidate) => candidate === '/project');
    vi.mocked(files.list).mockResolvedValue([
      { name: 'Screen\u202FShot.png', isDirectory: false, isFile: true },
    ]);
    vi.mocked(files.stat).mockResolvedValue({
      isDirectory: false,
      isFile: true,
      size: 3,
      mtime: new Date(),
    });
    vi.mocked(files.readBuffer).mockResolvedValue(Buffer.from('png'));
    const queries: ContextQueryPort = {
      execute: vi.fn().mockResolvedValue({ text: 'description' }),
    };
    const service = new ContextDescriptionService(files, queries, {} as never);

    await service.describeImage('/project/Screen Shot.png', new AbortController());

    expect(files.readBuffer).toHaveBeenCalledWith('/project/Screen\u202FShot.png');
    expect(files.list).toHaveBeenCalledWith('/project');
  });
});
