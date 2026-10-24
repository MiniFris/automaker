import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as utils from '@automaker/utils';
import * as settings from '../../../src/lib/settings-helpers.js';
import { AgentPromptBuilder } from '../../../src/services/agent/agent-prompt-builder.js';
import type { Message } from '../../../src/services/agent/agent-session.types.js';

vi.mock('@automaker/utils', async () => {
  const actual = await vi.importActual<typeof import('@automaker/utils')>('@automaker/utils');
  return {
    ...actual,
    loadContextFiles: vi.fn(),
    readImageAsBase64: vi.fn(),
    buildPromptWithImages: vi.fn(),
  };
});

const context = {
  files: [
    { name: 'CLAUDE.md', path: '/project/CLAUDE.md', content: 'CLAUDE_ONLY' },
    { name: 'CODE_QUALITY.md', path: '/project/CODE_QUALITY.md', content: 'QUALITY_ONLY' },
  ],
  formattedPrompt: 'CLAUDE_ONLY\nQUALITY_ONLY',
};
const builder = new AgentPromptBuilder();
const input = () => ({
  workingDirectory: '/project',
  message: 'x'.repeat(240),
  autoLoadClaudeMd: true,
  requestedModel: 'sonnet',
  remoteContext: false,
  settings: null,
  signal: new AbortController().signal,
});
const customized = (systemPrompt: string) =>
  ({ agent: { systemPrompt } }) as Awaited<ReturnType<typeof settings.getPromptCustomization>>;

beforeEach(() => {
  vi.mocked(utils.loadContextFiles).mockResolvedValue(context);
  vi.spyOn(settings, 'getPromptCustomization').mockResolvedValue(customized('BASE_PROMPT'));
});
afterEach(() => vi.restoreAllMocks());

describe('AgentPromptBuilder', () => {
  it('filters SDK-managed CLAUDE.md, retains other context and builds smart-memory task input', async () => {
    const prompt = await builder.systemPrompt(input());
    expect(prompt).not.toContain('CLAUDE_ONLY');
    expect(prompt).toContain('QUALITY_ONLY');
    expect(prompt.endsWith('\n\nBASE_PROMPT')).toBe(true);
    expect(utils.loadContextFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/project',
        taskContext: { title: 'x'.repeat(200), description: 'x'.repeat(240) },
      })
    );
  });

  it.each([
    ['direct-fixture', true],
    ['sonnet', false],
  ] as const)(
    'retains CLAUDE.md for model=%s autoLoad=%s',
    async (requestedModel, autoLoadClaudeMd) => {
      const prompt = await builder.systemPrompt({ ...input(), requestedModel, autoLoadClaudeMd });
      expect(prompt).toBe('CLAUDE_ONLY\nQUALITY_ONLY\n\nBASE_PROMPT');
    }
  );

  it('does not read/initialize controller context or memory for a managed target', async () => {
    vi.mocked(utils.loadContextFiles).mockRejectedValue(new Error('Poisoned controller context'));
    expect(await builder.systemPrompt({ ...input(), remoteContext: true })).toBe('BASE_PROMPT');
    expect(utils.loadContextFiles).not.toHaveBeenCalled();
  });

  it('hot-reloads customized prompts between messages', async () => {
    vi.mocked(settings.getPromptCustomization)
      .mockResolvedValueOnce(customized('FIRST'))
      .mockResolvedValueOnce(customized('SECOND'));
    expect(await builder.systemPrompt({ ...input(), remoteContext: true })).toBe('FIRST');
    expect(await builder.systemPrompt({ ...input(), remoteContext: true })).toBe('SECOND');
    expect(settings.getPromptCustomization).toHaveBeenCalledTimes(2);
  });

  it('stops before file/settings work when cancellation was already requested', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      builder.systemPrompt({ ...input(), signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(builder.readImages(undefined, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(builder.content('message', undefined, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(utils.loadContextFiles).not.toHaveBeenCalled();
    expect(settings.getPromptCustomization).not.toHaveBeenCalled();
    expect(utils.readImageAsBase64).not.toHaveBeenCalled();
    expect(utils.buildPromptWithImages).not.toHaveBeenCalled();
  });

  it('does not continue to settings after cancellation during context loading', async () => {
    const controller = new AbortController();
    vi.mocked(utils.loadContextFiles).mockImplementationOnce(async () => {
      controller.abort();
      return context;
    });
    await expect(
      builder.systemPrompt({ ...input(), signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(settings.getPromptCustomization).not.toHaveBeenCalled();
  });

  it('omits the current user turn and blank historical messages without mutating history', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Earlier', timestamp: 'now' },
      { id: '2', role: 'assistant', content: ' ', timestamp: 'now' },
      { id: '3', role: 'user', content: 'Current', timestamp: 'now' },
    ];
    const snapshot = JSON.stringify(messages);
    expect(builder.history(messages)).toEqual([{ role: 'user', content: 'Earlier' }]);
    expect(builder.history([messages[2]])).toBeUndefined();
    expect(JSON.stringify(messages)).toBe(snapshot);
  });

  it('preserves attachment metadata and skips unreadable images', async () => {
    vi.mocked(utils.readImageAsBase64)
      .mockResolvedValueOnce({ base64: 'YQ==', mimeType: 'image/png', filename: 'image.png' })
      .mockRejectedValueOnce(new Error('Fixture unreadable image'));
    expect(
      await builder.readImages(['good.png', 'missing.png'], new AbortController().signal)
    ).toEqual([{ data: 'YQ==', mimeType: 'image/png', filename: 'image.png' }]);
  });

  it('does not read later attachments after cancellation during image loading', async () => {
    const controller = new AbortController();
    vi.mocked(utils.readImageAsBase64).mockImplementationOnce(async () => {
      controller.abort();
      return { base64: 'YQ==', mimeType: 'image/png', filename: 'image.png' };
    });
    await expect(
      builder.readImages(['first.png', 'second.png'], controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(utils.readImageAsBase64).toHaveBeenCalledTimes(1);
  });

  it('builds provider content with image paths but no controller workDir override', async () => {
    vi.mocked(utils.buildPromptWithImages).mockResolvedValueOnce({
      content: 'PROMPT_CONTENT',
    } as Awaited<ReturnType<typeof utils.buildPromptWithImages>>);
    expect(await builder.content('Message', ['image.png'], new AbortController().signal)).toBe(
      'PROMPT_CONTENT'
    );
    expect(utils.buildPromptWithImages).toHaveBeenCalledWith(
      'Message',
      ['image.png'],
      undefined,
      true
    );
  });

  it('appends target context without losing SDK preset fields or mutating the base', () => {
    const base = { type: 'preset' as const, preset: 'claude_code' as const, append: 'BASE' };
    expect(builder.appendContext(base, 'TARGET')).toEqual({ ...base, append: 'BASE\n\nTARGET' });
    expect(base.append).toBe('BASE');
    expect(builder.appendContext('BASE', 'TARGET')).toBe('BASE\n\nTARGET');
    expect(builder.appendContext(undefined, 'TARGET')).toBe('TARGET');
  });
});
