import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecuteOptions, ExecutionEnvironmentBinding } from '@automaker/types';
import type { SettingsService } from '../../../src/services/settings-service.js';
import { AgentEnvironmentPreparer } from '../../../src/services/agent/agent-environment-preparer.js';
import { AgentPromptBuilder } from '../../../src/services/agent/agent-prompt-builder.js';
import * as filesystem from '../../../src/lib/secure-fs.js';

const mocks = vi.hoisted(() => ({
  remote: vi.fn(),
  prepare: vi.fn(),
  issued: vi.fn(),
  context: vi.fn(),
  record: vi.fn(),
  memory: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock('../../../src/providers/environment-execution.js', () => ({
  hasRemoteEnvironment: mocks.remote,
}));
vi.mock('../../../src/providers/openai-compatible/execution.js', () => ({
  prepareDirectExecution: mocks.prepare,
}));
vi.mock('../../../src/services/execution-environment/runtime.js', () => ({
  isIssuedEnvironment: mocks.issued,
}));
vi.mock('../../../src/services/execution-environment/feature-workspace.js', () => ({
  FeatureWorkspaceService: class {
    constructor(settings: unknown) {
      mocks.workspace(settings);
    }
    context = mocks.context;
    memory = mocks.memory;
  },
}));

const settings = {} as SettingsService;
const runtime = {} as NonNullable<ExecuteOptions['executionEnvironmentRuntime']>;
const binding: ExecutionEnvironmentBinding = {
  version: 1,
  id: 'bound-chat',
  type: 'ssh',
  projectPath: '/controller',
  cwd: '/controller',
  createdAt: '2026-10-24T00:00:00Z',
};
const memoryFiles = [{ name: 'memory.md', path: '/target/memory.md', content: 'TARGET_MEMORY' }];
function input() {
  return {
    options: {
      prompt: 'Message',
      cwd: '/controller',
      model: 'sonnet',
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'BASE' },
      abortController: new AbortController(),
    } satisfies ExecuteOptions,
    settings: settings as SettingsService | null,
    selection: { model: 'sonnet', projectPath: '/controller', runKey: 'chat:fixture' },
    managedContext: true,
    onBinding: vi.fn().mockResolvedValue(undefined),
  };
}
const preparer = new AgentEnvironmentPreparer(new AgentPromptBuilder(filesystem));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.remote.mockResolvedValue(true);
  mocks.prepare.mockImplementation(async (options) => ({
    ...options,
    executionEnvironmentBinding: binding,
    executionEnvironmentRuntime: runtime,
  }));
  mocks.issued.mockReturnValue(true);
  mocks.context.mockResolvedValue({ formattedPrompt: 'TARGET', files: [], memoryFiles });
  mocks.memory.mockReturnValue({ recordUsage: mocks.record });
  mocks.record.mockResolvedValue(undefined);
});

describe('AgentEnvironmentPreparer', () => {
  it('reads authoritative selection, and requires no lookup without settings', async () => {
    const signal = new AbortController().signal;
    expect(await preparer.usesManagedContext(settings, '/project', 'chat:fixture', signal)).toBe(
      true
    );
    expect(mocks.remote).toHaveBeenCalledWith(settings, '/project', 'chat:fixture');
    expect(await preparer.usesManagedContext(null, '/project', 'chat:fixture', signal)).toBe(false);
    expect(mocks.remote).toHaveBeenCalledTimes(1);
  });
  it('does not interpret unavailable environment configuration as Local', async () => {
    const failure = new Error('Unavailable pinned environment');
    mocks.remote.mockRejectedValue(failure);
    await expect(
      preparer.usesManagedContext(
        settings,
        '/project',
        'chat:fixture',
        new AbortController().signal
      )
    ).rejects.toBe(failure);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('checks cancellation before and after configuration lookup', async () => {
    const controller = new AbortController();
    mocks.remote.mockImplementationOnce(async () => {
      controller.abort();
      return true;
    });
    await expect(
      preparer.usesManagedContext(settings, '/project', 'chat:fixture', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    mocks.remote.mockClear();
    await expect(
      preparer.usesManagedContext(settings, '/project', 'chat:fixture', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.remote).not.toHaveBeenCalled();
  });
  it('persists binding before target IO and preserves the SDK preset', async () => {
    const request = input();
    let persisted = false;
    request.onBinding.mockImplementationOnce(async () => {
      await Promise.resolve();
      persisted = true;
    });
    mocks.context.mockImplementationOnce(async () => {
      expect(request.onBinding).toHaveBeenCalledWith(binding);
      expect(persisted).toBe(true);
      return { formattedPrompt: 'TARGET', files: [], memoryFiles };
    });
    const result = await preparer.prepare(request);
    expect(mocks.prepare).toHaveBeenCalledWith(request.options, settings, request.selection);
    expect(mocks.workspace).toHaveBeenCalledWith(settings);
    expect(mocks.context).toHaveBeenCalledWith(
      { binding, environment: runtime },
      request.options.abortController.signal
    );
    expect(result.options.systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: 'BASE\n\nTARGET',
    });
    expect(request.options.systemPrompt.append).toBe('BASE');
    await result.recordMemoryUsage('Response', true);
    expect(mocks.memory).toHaveBeenCalledWith({ binding, environment: runtime });
    expect(mocks.record).toHaveBeenCalledWith(
      memoryFiles,
      'Response',
      true,
      request.options.abortController.signal
    );
  });
  it('does not read target context if binding persistence fails', async () => {
    const request = input();
    const failure = new Error('Binding metadata write failed');
    request.onBinding.mockRejectedValue(failure);
    await expect(preparer.prepare(request)).rejects.toBe(failure);
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it('never retries a failed preparation', async () => {
    const failure = new Error('Transport loss with unknown outcome');
    mocks.prepare.mockRejectedValue(failure);
    await expect(preparer.prepare(input())).rejects.toBe(failure);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it('does not retry or fall back when target context is inaccessible', async () => {
    const failure = new Error('Target context inaccessible');
    mocks.context.mockRejectedValue(failure);
    await expect(preparer.prepare(input())).rejects.toBe(failure);
    expect(mocks.context).toHaveBeenCalledTimes(1);
    expect(mocks.memory).not.toHaveBeenCalled();
  });
  it.each(['local', 'no-settings', 'unissued', 'no-binding'])(
    'does not initialize target context/memory for %s',
    async (mode) => {
      const request = input();
      if (mode === 'local') request.managedContext = false;
      if (mode === 'no-settings') request.settings = null;
      if (mode === 'unissued') mocks.issued.mockReturnValue(false);
      if (mode === 'no-binding') mocks.prepare.mockResolvedValue(request.options);
      const result = await preparer.prepare(request);
      await result.recordMemoryUsage('Response', false);
      expect(mocks.workspace).not.toHaveBeenCalled();
      expect(mocks.context).not.toHaveBeenCalled();
      expect(mocks.memory).not.toHaveBeenCalled();
    }
  );
  it('does not acquire a binding when already cancelled', async () => {
    const request = input();
    request.options.abortController.abort();
    await expect(preparer.prepare(request)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(request.onBinding).not.toHaveBeenCalled();
  });
  it('persists a binding acquired during cancellation, without reading target context', async () => {
    const request = input();
    mocks.prepare.mockImplementationOnce(async (options) => {
      request.options.abortController.abort();
      return {
        ...options,
        executionEnvironmentBinding: binding,
        executionEnvironmentRuntime: runtime,
      };
    });
    await expect(preparer.prepare(request)).rejects.toMatchObject({ name: 'AbortError' });
    expect(request.onBinding).toHaveBeenCalledWith(binding);
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it('rejects cancellation during target context reading', async () => {
    const request = input();
    mocks.context.mockImplementationOnce(async () => {
      request.options.abortController.abort();
      return { formattedPrompt: 'LATE_TARGET', files: [], memoryFiles };
    });
    await expect(preparer.prepare(request)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.memory).not.toHaveBeenCalled();
  });
  it('does not initialize target memory when no memory files were selected', async () => {
    mocks.context.mockResolvedValue({ formattedPrompt: '', files: [], memoryFiles: [] });
    const result = await preparer.prepare(input());
    expect(result.options.systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: 'BASE',
    });
    await result.recordMemoryUsage('Response', true);
    expect(mocks.memory).not.toHaveBeenCalled();
  });
  it('exposes memory statistics failure without replay', async () => {
    const failure = new Error('Target stats write failed');
    mocks.record.mockRejectedValue(failure);
    const result = await preparer.prepare(input());
    await expect(result.recordMemoryUsage('Response', false)).rejects.toBe(failure);
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });
  it('does not start memory writes after cancellation', async () => {
    const request = input();
    const result = await preparer.prepare(request);
    request.options.abortController.abort();
    await expect(result.recordMemoryUsage('Response', true)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(mocks.memory).not.toHaveBeenCalled();
  });
});
