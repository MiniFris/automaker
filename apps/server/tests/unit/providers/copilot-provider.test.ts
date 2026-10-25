import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CopilotProvider, CopilotErrorCode } from '@/providers/copilot-provider.js';
import { collectAsyncGenerator } from '../../utils/helpers.js';
import { CopilotClient } from '@github/copilot-sdk';
import * as fsPromises from 'fs/promises';

const createSessionMock = vi.fn();
const resumeSessionMock = vi.fn();

function createMockSession(sessionId = 'test-session') {
  let eventHandler: ((event: any) => void) | null = null;
  return {
    sessionId,
    send: vi.fn().mockImplementation(async () => {
      if (eventHandler) {
        eventHandler({ type: 'assistant.message', data: { content: 'hello' } });
        eventHandler({ type: 'session.idle' });
      }
    }),
    destroy: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockImplementation((handler: (event: any) => void) => {
      eventHandler = handler;
    }),
  };
}

// Mock the Copilot SDK
vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue([]),
    createSession: createSessionMock,
    resumeSession: resumeSessionMock,
  })),
}));

// Mock child_process with all needed exports
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

// Mock fs (synchronous) for CLI detection (existsSync)
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

// Mock fs/promises
vi.mock('fs/promises', () => ({
  stat: vi.fn(),
  access: vi.fn().mockRejectedValue(new Error('Not found')),
  readFile: vi.fn().mockRejectedValue(new Error('Not found')),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Import execSync after mocking
import { execSync } from 'child_process';
import * as fs from 'fs';
import { ProviderCleanupError } from '@/providers/provider-execution-scope.js';

describe('copilot-provider.ts', () => {
  let provider: CopilotProvider;

  it('passes a fresh application environment to each SDK client without global mutation', async () => {
    let snapshot: Readonly<NodeJS.ProcessEnv> = Object.freeze({
      GITHUB_TOKEN: 'app-token-fixture',
    });
    const environment = vi.fn(async () => snapshot);
    const isolated = new CopilotProvider({}, environment);
    const original = process.env.GITHUB_TOKEN;
    await collectAsyncGenerator(isolated.executeQuery({ prompt: 'Fixture', cwd: '/fixture' }));
    expect(vi.mocked(CopilotClient).mock.calls.at(-1)?.[0]?.env).toEqual(snapshot);
    snapshot = Object.freeze({});
    await collectAsyncGenerator(isolated.executeQuery({ prompt: 'Fixture', cwd: '/fixture' }));
    expect(vi.mocked(CopilotClient).mock.calls.at(-1)?.[0]?.env).toEqual({});
    expect(environment).toHaveBeenCalledTimes(2);
    expect(process.env.GITHUB_TOKEN).toBe(original);
    await isolated.dispose();
  });

  function ownedClient(session: ReturnType<typeof createMockSession>) {
    const client = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockImplementation(async () => {
        try {
          await session.destroy();
          return [];
        } catch (error) {
          return [error];
        }
      }),
      createSession: vi.fn().mockResolvedValue(session),
    };
    vi.mocked(CopilotClient).mockImplementationOnce(function () {
      return client as any;
    });
    return client;
  }

  it('early return destroys the SDK session and stops its client exactly once', async () => {
    const session = createMockSession();
    const client = ownedClient(session);
    const stream = provider.executeQuery({ prompt: 'Fixture', cwd: '/fixture' });
    await stream.next();
    await stream.return(undefined);
    await provider.dispose();
    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(client.stop).toHaveBeenCalledTimes(1);
  });

  it('wakes an idle event bridge on abort and waits for destroy before completing disposal', async () => {
    const session = createMockSession();
    let listener!: (event: any) => void;
    const unsubscribe = vi.fn();
    session.on.mockImplementation((handler) => {
      listener = handler;
      return unsubscribe;
    });
    session.send.mockImplementation(async () => {
      listener({ type: 'assistant.message', data: { content: 'Partial' } });
    });
    let release!: () => void;
    session.destroy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const client = ownedClient(session);
    const parent = new AbortController();
    const stream = provider.executeQuery({
      prompt: 'Fixture',
      cwd: '/fixture',
      abortController: parent,
    });
    await stream.next();
    const next = stream.next().catch((error) => error);
    parent.abort();
    await vi.waitFor(() => expect(session.destroy).toHaveBeenCalledTimes(1));
    let disposed = false;
    const disposing = provider.dispose().then(() => {
      disposed = true;
    });
    expect(client.stop).toHaveBeenCalledTimes(1);
    expect(session.abort).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(disposed).toBe(false);
    release();
    expect((await next).name).toBe('AbortError');
    await disposing;
    expect(client.stop).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it.each(['destroy', 'stop-throw', 'stop-errors'] as const)(
    'fails closed for %s cleanup failure and still attempts client.stop',
    async (failure) => {
      const session = createMockSession();
      const client = ownedClient(session);
      if (failure === 'destroy')
        session.destroy.mockRejectedValueOnce(new Error('private cleanup detail'));
      if (failure === 'stop-throw')
        client.stop.mockRejectedValueOnce(new Error('private cleanup detail'));
      if (failure === 'stop-errors')
        client.stop.mockResolvedValueOnce([new Error('private cleanup detail')]);
      await expect(
        collectAsyncGenerator(provider.executeQuery({ prompt: 'Fixture', cwd: '/fixture' }))
      ).rejects.toBeInstanceOf(ProviderCleanupError);
      expect(client.stop).toHaveBeenCalledTimes(1);
      expect(session.destroy).toHaveBeenCalledTimes(failure === 'destroy' ? 1 : 0);
      await expect(provider.dispose()).rejects.not.toThrow('private cleanup detail');
      await expect(
        provider.executeQuery({ prompt: 'No replacement', cwd: '/fixture' }).next()
      ).rejects.toThrow('not accepting');
    }
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsPromises.stat)
      .mockReset()
      .mockRejectedValue(Object.assign(new Error('Not found'), { code: 'ENOENT' }));
    vi.mocked(CopilotClient).mockImplementation(function () {
      return {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue([]),
        createSession: createSessionMock,
        resumeSession: resumeSessionMock,
      } as any;
    });
    createSessionMock.mockResolvedValue(createMockSession());
    resumeSessionMock.mockResolvedValue(createMockSession('resumed-session'));

    // Mock fs.existsSync for CLI path validation
    vi.mocked(fs.existsSync).mockReturnValue(true);

    // Mock CLI detection to find the CLI
    // The CliProvider base class uses 'which copilot' (Unix) or 'where copilot' (Windows)
    // to find the CLI path, then validates with fs.existsSync
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      // CLI path detection (which/where command)
      if (cmd.startsWith('which ') || cmd.startsWith('where ')) {
        return '/usr/local/bin/copilot';
      }
      if (cmd.includes('--version')) {
        return '1.0.0';
      }
      if (cmd.includes('gh auth status')) {
        return 'Logged in to github.com account testuser';
      }
      if (cmd.includes('models list')) {
        return JSON.stringify([{ id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5' }]);
      }
      return '';
    });

    provider = new CopilotProvider();
    vi.stubEnv('GITHUB_TOKEN', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('getName', () => {
    it("should return 'copilot' as provider name", () => {
      expect(provider.getName()).toBe('copilot');
    });
  });

  describe('getCliName', () => {
    it("should return 'copilot' as CLI name", () => {
      expect(provider.getCliName()).toBe('copilot');
    });
  });

  describe('supportsFeature', () => {
    it('should support tools feature', () => {
      expect(provider.supportsFeature('tools')).toBe(true);
    });

    it('should support text feature', () => {
      expect(provider.supportsFeature('text')).toBe(true);
    });

    it('should support streaming feature', () => {
      expect(provider.supportsFeature('streaming')).toBe(true);
    });

    it('should NOT support vision feature (not implemented yet)', () => {
      expect(provider.supportsFeature('vision')).toBe(false);
    });

    it('should not support unknown feature', () => {
      expect(provider.supportsFeature('unknown')).toBe(false);
    });
  });

  describe('getAvailableModels', () => {
    it('should return static model definitions', () => {
      const models = provider.getAvailableModels();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      // All models should have required fields
      models.forEach((model) => {
        expect(model.id).toBeDefined();
        expect(model.name).toBeDefined();
        expect(model.provider).toBe('copilot');
      });
    });

    it('should include copilot- prefix in model IDs', () => {
      const models = provider.getAvailableModels();
      models.forEach((model) => {
        expect(model.id).toMatch(/^copilot-/);
      });
    });
  });

  describe('checkAuth', () => {
    it('does not treat a directory as a configuration file', async () => {
      vi.mocked(fsPromises.stat).mockResolvedValueOnce({ isFile: () => false } as never);
      expect((await new CopilotProvider({}, async () => ({})).checkAuth()).hasConfigFile).toBe(
        false
      );
    });

    it('redacts filesystem failures without inventing credential hints', async () => {
      vi.mocked(fsPromises.stat).mockRejectedValueOnce(new Error('private-token /private/config'));
      const result = await new CopilotProvider({}, async () => ({})).checkAuth();
      expect(result).toMatchObject({
        authenticated: false,
        authenticationChecked: false,
        hasConfigFile: false,
        error: 'Local configuration could not be inspected.',
      });
      expect(JSON.stringify(result)).not.toContain('private-token');
    });

    it('does not launch auth commands or turn CLI installation into authentication', async () => {
      const freshProvider = new CopilotProvider({}, async () => ({}));
      vi.mocked(execSync).mockClear();
      expect(await freshProvider.checkAuth()).toMatchObject({
        authenticated: false,
        authenticationChecked: false,
        method: 'none',
        hasEnvToken: false,
        hasConfigFile: false,
      });
      expect(execSync).not.toHaveBeenCalled();
    });

    it('uses the application snapshot, not the ambient token, and never verifies token presence', async () => {
      const original = process.env.GITHUB_TOKEN;
      const environment = vi.fn(async () => ({ GITHUB_TOKEN: 'application-private-fixture' }));
      const status = await new CopilotProvider({}, environment).checkAuth();
      expect(status).toMatchObject({
        authenticated: false,
        authenticationChecked: false,
        method: 'oauth',
        hasEnvToken: true,
      });
      expect(environment).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(status)).not.toContain('application-private-fixture');
      expect(process.env.GITHUB_TOKEN).toBe(original);
    });

    it('reports file presence without reading token or identity', async () => {
      const promises = await import('fs/promises');
      vi.mocked(promises.stat).mockResolvedValueOnce({ isFile: () => true } as never);
      vi.mocked(promises.readFile).mockClear();
      const status = await new CopilotProvider({}, async () => ({
        GH_CONFIG_DIR: '/application/gh-config',
      })).checkAuth();
      expect(promises.stat).toHaveBeenLastCalledWith(
        expect.stringMatching(/application[\\/]gh-config[\\/]hosts.yml$/)
      );
      expect(status).toMatchObject({
        authenticated: false,
        authenticationChecked: false,
        hasConfigFile: true,
      });
      expect(promises.readFile).not.toHaveBeenCalled();
    });
  });

  describe('detectInstallation', () => {
    it('should detect installed CLI', async () => {
      // Set up mocks BEFORE creating provider
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        // CLI path detection (which/where command)
        if (cmd.startsWith('which ') || cmd.startsWith('where ')) {
          return '/usr/local/bin/copilot';
        }
        if (cmd.includes('--version')) {
          return '1.2.3';
        }
        if (cmd.includes('gh auth status')) {
          return 'Logged in to github.com account testuser';
        }
        return '';
      });

      // Create fresh provider with the mock in place
      const freshProvider = new CopilotProvider();
      const status = await freshProvider.detectInstallation();
      expect(status.installed).toBe(true);
      expect(status.version).toBe('1.2.3');
      expect(status.authenticated).toBe(false);
    });
  });

  describe('normalizeEvent', () => {
    it('should normalize assistant.message event', () => {
      const event = {
        type: 'assistant.message',
        data: { content: 'Hello, world!' },
      };

      const result = provider.normalizeEvent(event);
      expect(result).toEqual({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello, world!' }],
        },
      });
    });

    it('should skip assistant.message_delta event', () => {
      const event = {
        type: 'assistant.message_delta',
        data: { delta: 'partial' },
      };

      const result = provider.normalizeEvent(event);
      expect(result).toBeNull();
    });

    it('should normalize tool.execution_start event', () => {
      const event = {
        type: 'tool.execution_start',
        data: {
          toolName: 'read_file',
          toolCallId: 'call-123',
          input: { path: '/test/file.txt' },
        },
      };

      const result = provider.normalizeEvent(event);
      expect(result).toEqual({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              name: 'Read', // Normalized from read_file
              tool_use_id: 'call-123',
              input: { path: '/test/file.txt', file_path: '/test/file.txt' }, // Path normalized
            },
          ],
        },
      });
    });

    it('should normalize tool.execution_complete event', () => {
      const event = {
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'call-123',
          success: true,
          result: {
            content: 'file content',
          },
        },
      };

      const result = provider.normalizeEvent(event);
      expect(result).toEqual({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call-123',
              content: 'file content',
            },
          ],
        },
      });
    });

    it('should handle tool.execution_complete with error', () => {
      const event = {
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'call-456',
          success: false,
          error: {
            message: 'Command failed',
          },
        },
      };

      const result = provider.normalizeEvent(event);
      expect(result?.message?.content?.[0]).toMatchObject({
        type: 'tool_result',
        tool_use_id: 'call-456',
        content: '[ERROR] Command failed',
      });
    });

    it('should handle tool.execution_complete with empty result', () => {
      const event = {
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'call-789',
          success: true,
          result: {
            content: '',
          },
        },
      };

      const result = provider.normalizeEvent(event);
      expect(result?.message?.content?.[0]).toMatchObject({
        type: 'tool_result',
        tool_use_id: 'call-789',
        content: '',
      });
    });

    it('should handle tool.execution_complete with missing result', () => {
      const event = {
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'call-999',
          success: true,
          // No result field
        },
      };

      const result = provider.normalizeEvent(event);
      expect(result?.message?.content?.[0]).toMatchObject({
        type: 'tool_result',
        tool_use_id: 'call-999',
        content: '',
      });
    });

    it('should handle tool.execution_complete with error code', () => {
      const event = {
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'call-567',
          success: false,
          error: {
            message: 'Permission denied',
            code: 'EACCES',
          },
        },
      };

      const result = provider.normalizeEvent(event);
      expect(result?.message?.content?.[0]).toMatchObject({
        type: 'tool_result',
        tool_use_id: 'call-567',
        content: '[ERROR] Permission denied (EACCES)',
      });
    });

    it('should normalize session.idle to success result', () => {
      const event = { type: 'session.idle' };

      const result = provider.normalizeEvent(event);
      expect(result).toEqual({
        type: 'result',
        subtype: 'success',
      });
    });

    it('should normalize session.error to error event', () => {
      const event = {
        type: 'session.error',
        data: { message: 'Something went wrong' },
      };

      const result = provider.normalizeEvent(event);
      expect(result).toEqual({
        type: 'error',
        error: 'Something went wrong',
      });
    });

    it('should use error code in fallback when session.error message is empty', () => {
      const event = {
        type: 'session.error',
        data: { message: '', code: 'RATE_LIMIT_EXCEEDED' },
      };

      const result = provider.normalizeEvent(event);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('error');
      expect(result!.error).toContain('RATE_LIMIT_EXCEEDED');
      expect(result!.error).not.toBe('Unknown error');
    });

    it('should return generic "Copilot agent error" fallback when both message and code are empty', () => {
      const event = {
        type: 'session.error',
        data: { message: '', code: '' },
      };

      const result = provider.normalizeEvent(event);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('error');
      expect(result!.error).toBe('Copilot agent error');
      // Must NOT be the old opaque 'Unknown error'
      expect(result!.error).not.toBe('Unknown error');
    });

    it('should return generic "Copilot agent error" fallback when data has no code field', () => {
      const event = {
        type: 'session.error',
        data: { message: '' },
      };

      const result = provider.normalizeEvent(event);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('error');
      expect(result!.error).toBe('Copilot agent error');
    });

    it('should return null for unknown event types', () => {
      const event = { type: 'unknown.event' };

      const result = provider.normalizeEvent(event);
      expect(result).toBeNull();
    });
  });

  describe('mapError', () => {
    it('should map authentication errors', () => {
      const errorInfo = (provider as any).mapError('not authenticated', null);
      expect(errorInfo.code).toBe(CopilotErrorCode.NOT_AUTHENTICATED);
      expect(errorInfo.recoverable).toBe(true);
    });

    it('should map rate limit errors', () => {
      const errorInfo = (provider as any).mapError('rate limit exceeded', null);
      expect(errorInfo.code).toBe(CopilotErrorCode.RATE_LIMITED);
      expect(errorInfo.recoverable).toBe(true);
    });

    it('should map model unavailable errors', () => {
      const errorInfo = (provider as any).mapError('model not available', null);
      expect(errorInfo.code).toBe(CopilotErrorCode.MODEL_UNAVAILABLE);
      expect(errorInfo.recoverable).toBe(true);
    });

    it('should map network errors', () => {
      const errorInfo = (provider as any).mapError('connection refused', null);
      expect(errorInfo.code).toBe(CopilotErrorCode.NETWORK_ERROR);
      expect(errorInfo.recoverable).toBe(true);
    });

    it('should map process crash (exit code 137)', () => {
      const errorInfo = (provider as any).mapError('', 137);
      expect(errorInfo.code).toBe(CopilotErrorCode.PROCESS_CRASHED);
      expect(errorInfo.recoverable).toBe(true);
    });

    it('should return unknown error for unrecognized errors', () => {
      const errorInfo = (provider as any).mapError('some random error', 1);
      expect(errorInfo.code).toBe(CopilotErrorCode.UNKNOWN);
      expect(errorInfo.recoverable).toBe(false);
    });
  });

  describe('model cache', () => {
    it('should indicate when cache is empty', () => {
      expect(provider.hasCachedModels()).toBe(false);
    });

    it('should clear model cache', () => {
      provider.clearModelCache();
      expect(provider.hasCachedModels()).toBe(false);
    });
  });

  describe('tool name normalization', () => {
    it('should normalize read_file to Read', () => {
      const event = {
        type: 'tool.execution_start',
        data: { toolName: 'read_file', toolCallId: 'id', input: {} },
      };
      const result = provider.normalizeEvent(event);
      expect(result?.message?.content?.[0]).toMatchObject({ name: 'Read' });
    });

    it('should normalize write_file to Write', () => {
      const event = {
        type: 'tool.execution_start',
        data: { toolName: 'write_file', toolCallId: 'id', input: {} },
      };
      const result = provider.normalizeEvent(event);
      expect(result?.message?.content?.[0]).toMatchObject({ name: 'Write' });
    });

    it('should normalize run_shell to Bash', () => {
      const event = {
        type: 'tool.execution_start',
        data: { toolName: 'run_shell', toolCallId: 'id', input: {} },
      };
      const result = provider.normalizeEvent(event);
      expect(result?.message?.content?.[0]).toMatchObject({ name: 'Bash' });
    });

    it('should normalize search to Grep', () => {
      const event = {
        type: 'tool.execution_start',
        data: { toolName: 'search', toolCallId: 'id', input: {} },
      };
      const result = provider.normalizeEvent(event);
      expect(result?.message?.content?.[0]).toMatchObject({ name: 'Grep' });
    });

    it('should normalize todo_write to TodoWrite', () => {
      const event = {
        type: 'tool.execution_start',
        data: {
          toolName: 'todo_write',
          toolCallId: 'id',
          input: {
            todos: [{ description: 'Test task', status: 'pending' }],
          },
        },
      };
      const result = provider.normalizeEvent(event);
      expect(result?.message?.content?.[0]).toMatchObject({ name: 'TodoWrite' });
    });

    it('should normalize todo content from description', () => {
      const event = {
        type: 'tool.execution_start',
        data: {
          toolName: 'todo_write',
          toolCallId: 'id',
          input: {
            todos: [{ description: 'Test task', status: 'pending' }],
          },
        },
      };
      const result = provider.normalizeEvent(event);
      const todoInput = (result?.message?.content?.[0] as any)?.input;
      expect(todoInput.todos[0]).toMatchObject({
        content: 'Test task',
        status: 'pending',
        activeForm: 'Test task',
      });
    });

    it('should map cancelled status to completed', () => {
      const event = {
        type: 'tool.execution_start',
        data: {
          toolName: 'todo_write',
          toolCallId: 'id',
          input: {
            todos: [{ description: 'Cancelled task', status: 'cancelled' }],
          },
        },
      };
      const result = provider.normalizeEvent(event);
      const todoInput = (result?.message?.content?.[0] as any)?.input;
      expect(todoInput.todos[0].status).toBe('completed');
    });
  });

  describe('executeQuery resume behavior', () => {
    it('uses resumeSession when sdkSessionId is provided', async () => {
      const results = await collectAsyncGenerator(
        provider.executeQuery({
          prompt: 'Hello',
          model: 'claude-sonnet-4.6',
          cwd: '/tmp/project',
          sdkSessionId: 'session-123',
        })
      );

      expect(resumeSessionMock).toHaveBeenCalledWith(
        'session-123',
        expect.objectContaining({ model: 'claude-sonnet-4.6', streaming: true })
      );
      expect(createSessionMock).not.toHaveBeenCalled();
      expect(results.some((msg) => msg.session_id === 'resumed-session')).toBe(true);
    });

    it('falls back to createSession when resumeSession fails', async () => {
      resumeSessionMock.mockRejectedValueOnce(new Error('session not found'));
      createSessionMock.mockResolvedValueOnce(createMockSession('fresh-session'));

      const results = await collectAsyncGenerator(
        provider.executeQuery({
          prompt: 'Hello',
          model: 'claude-sonnet-4.6',
          cwd: '/tmp/project',
          sdkSessionId: 'stale-session',
        })
      );

      expect(resumeSessionMock).toHaveBeenCalledWith(
        'stale-session',
        expect.objectContaining({ model: 'claude-sonnet-4.6', streaming: true })
      );
      expect(createSessionMock).toHaveBeenCalledTimes(1);
      expect(results.some((msg) => msg.session_id === 'fresh-session')).toBe(true);
    });
  });
});
