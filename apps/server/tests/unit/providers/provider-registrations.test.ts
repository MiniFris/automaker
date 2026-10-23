import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestProviderRegistry } from '../../helpers/provider-registry.js';
import { SettingsService } from '@/services/settings-service.js';
import { ClaudeProvider } from '@/providers/claude-provider.js';
import { CursorProvider } from '@/providers/cursor-provider.js';
import { CodexProvider } from '@/providers/codex-provider.js';
import { OpencodeProvider } from '@/providers/opencode-provider.js';
import { GeminiProvider } from '@/providers/gemini-provider.js';
import { CopilotProvider } from '@/providers/copilot-provider.js';
import { OpenAICompatibleProvider } from '@/providers/openai-compatible-provider.js';

describe('explicit provider registrations', () => {
  let registry: ReturnType<typeof createTestProviderRegistry>;
  let consoleSpy: any;
  let detectClaudeSpy: any;
  let detectCursorSpy: any;
  let detectCodexSpy: any;
  let detectOpencodeSpy: any;
  let detectGeminiSpy: any;
  let detectCopilotSpy: any;

  beforeEach(() => {
    registry = createTestProviderRegistry(new SettingsService('/unused-provider-registry-test'));
    consoleSpy = {
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    };

    // Avoid hitting real CLI / filesystem checks during unit tests
    detectClaudeSpy = vi
      .spyOn(ClaudeProvider.prototype, 'detectInstallation')
      .mockResolvedValue({ installed: true });
    detectCursorSpy = vi
      .spyOn(CursorProvider.prototype, 'detectInstallation')
      .mockResolvedValue({ installed: true });
    detectCodexSpy = vi
      .spyOn(CodexProvider.prototype, 'detectInstallation')
      .mockResolvedValue({ installed: true });
    detectOpencodeSpy = vi
      .spyOn(OpencodeProvider.prototype, 'detectInstallation')
      .mockResolvedValue({ installed: true });
    detectGeminiSpy = vi
      .spyOn(GeminiProvider.prototype, 'detectInstallation')
      .mockResolvedValue({ installed: true });
    detectCopilotSpy = vi
      .spyOn(CopilotProvider.prototype, 'detectInstallation')
      .mockResolvedValue({ installed: true });
  });

  afterEach(() => {
    consoleSpy.warn.mockRestore();
    detectClaudeSpy.mockRestore();
    detectCursorSpy.mockRestore();
    detectCodexSpy.mockRestore();
    detectOpencodeSpy.mockRestore();
    detectGeminiSpy.mockRestore();
    detectCopilotSpy.mockRestore();
  });

  describe('getProviderForModel', () => {
    it.each(['direct-Qwen/Qwen3-Coder:latest', 'direct-claude-sonnet-custom', 'direct-gpt-5.2'])(
      'routes %s explicitly without falling back to an existing CLI',
      (model) => {
        expect(registry.providerNameForModel(model)).toBe('openai-compatible');
        expect(registry.providerNameForModel(model)).toBe('openai-compatible');
        expect(registry.providerForModel(model)).toBeInstanceOf(OpenAICompatibleProvider);
        expect(registry.supportsVision(model)).toBe(false);
      }
    );

    describe('Claude models (claude-* prefix)', () => {
      it('should return ClaudeProvider for claude-opus-4-6', () => {
        const provider = registry.providerForModel('claude-opus-4-6');
        expect(provider).toBeInstanceOf(ClaudeProvider);
      });

      it('should return ClaudeProvider for claude-sonnet-4-6', () => {
        const provider = registry.providerForModel('claude-sonnet-4-6');
        expect(provider).toBeInstanceOf(ClaudeProvider);
      });

      it('should return ClaudeProvider for claude-haiku-4-5', () => {
        const provider = registry.providerForModel('claude-haiku-4-5');
        expect(provider).toBeInstanceOf(ClaudeProvider);
      });

      it('should be case-insensitive for claude models', () => {
        const provider = registry.providerForModel('CLAUDE-OPUS-4-6');
        expect(provider).toBeInstanceOf(ClaudeProvider);
      });
    });

    describe('Claude aliases', () => {
      it("should return ClaudeProvider for 'haiku'", () => {
        const provider = registry.providerForModel('haiku');
        expect(provider).toBeInstanceOf(ClaudeProvider);
      });

      it("should return ClaudeProvider for 'sonnet'", () => {
        const provider = registry.providerForModel('sonnet');
        expect(provider).toBeInstanceOf(ClaudeProvider);
      });

      it("should return ClaudeProvider for 'opus'", () => {
        const provider = registry.providerForModel('opus');
        expect(provider).toBeInstanceOf(ClaudeProvider);
      });

      it('should be case-insensitive for aliases', () => {
        const provider1 = registry.providerForModel('HAIKU');
        const provider2 = registry.providerForModel('Sonnet');
        const provider3 = registry.providerForModel('Opus');

        expect(provider1).toBeInstanceOf(ClaudeProvider);
        expect(provider2).toBeInstanceOf(ClaudeProvider);
        expect(provider3).toBeInstanceOf(ClaudeProvider);
      });
    });

    describe('Cursor models (cursor-* prefix)', () => {
      it('should return CursorProvider for cursor-auto', () => {
        const provider = registry.providerForModel('cursor-auto');
        expect(provider).toBeInstanceOf(CursorProvider);
      });

      it('should return CursorProvider for cursor-sonnet-4.5', () => {
        const provider = registry.providerForModel('cursor-sonnet-4.5');
        expect(provider).toBeInstanceOf(CursorProvider);
      });

      it('should return CursorProvider for cursor-gpt-5.2', () => {
        const provider = registry.providerForModel('cursor-gpt-5.2');
        expect(provider).toBeInstanceOf(CursorProvider);
      });

      it('should be case-insensitive for cursor models', () => {
        const provider = registry.providerForModel('CURSOR-AUTO');
        expect(provider).toBeInstanceOf(CursorProvider);
      });

      it('should return CursorProvider for known cursor model ID without prefix', () => {
        const provider = registry.providerForModel('auto');
        expect(provider).toBeInstanceOf(CursorProvider);
      });
    });

    describe('Unknown models', () => {
      it('should default to ClaudeProvider for unknown model', () => {
        const provider = registry.providerForModel('unknown-model-123');
        expect(provider).toBeInstanceOf(ClaudeProvider);
      });

      it('should handle empty string by defaulting to ClaudeProvider', () => {
        const provider = registry.providerForModel('');
        expect(provider).toBeInstanceOf(ClaudeProvider);
      });

      it('should default to ClaudeProvider for completely unknown prefixes', () => {
        const provider = registry.providerForModel('random-xyz-model');
        expect(provider).toBeInstanceOf(ClaudeProvider);
      });
    });

    describe('Cursor models via model ID lookup', () => {
      it('should return CodexProvider for gpt-5.2 (Codex model, not Cursor)', () => {
        // gpt-5.2 is in both CURSOR_MODEL_MAP and CODEX_MODEL_CONFIG_MAP
        // It should route to Codex since Codex models take priority
        const provider = registry.providerForModel('gpt-5.2');
        expect(provider).toBeInstanceOf(CodexProvider);
      });

      it('should return CursorProvider for grok (valid Cursor model)', () => {
        const provider = registry.providerForModel('grok');
        expect(provider).toBeInstanceOf(CursorProvider);
      });

      it('should return CursorProvider for gemini-3-pro (valid Cursor model)', () => {
        const provider = registry.providerForModel('gemini-3-pro');
        expect(provider).toBeInstanceOf(CursorProvider);
      });
    });
  });

  describe('getAllProviders', () => {
    it('should return array of all providers', () => {
      const providers = registry.all();
      expect(Array.isArray(providers)).toBe(true);
    });

    it('should include ClaudeProvider', () => {
      const providers = registry.all();
      const hasClaudeProvider = providers.some((p) => p instanceof ClaudeProvider);
      expect(hasClaudeProvider).toBe(true);
    });

    it('should return exactly 7 providers', () => {
      const providers = registry.all();
      expect(providers).toHaveLength(7);
    });

    it('should include CopilotProvider', () => {
      const providers = registry.all();
      const hasCopilotProvider = providers.some((p) => p instanceof CopilotProvider);
      expect(hasCopilotProvider).toBe(true);
    });

    it('should include GeminiProvider', () => {
      const providers = registry.all();
      const hasGeminiProvider = providers.some((p) => p instanceof GeminiProvider);
      expect(hasGeminiProvider).toBe(true);
    });

    it('should include CursorProvider', () => {
      const providers = registry.all();
      const hasCursorProvider = providers.some((p) => p instanceof CursorProvider);
      expect(hasCursorProvider).toBe(true);
    });

    it('should create new instances each time', () => {
      const providers1 = registry.all();
      const providers2 = registry.all();

      expect(providers1[0]).not.toBe(providers2[0]);
    });
  });

  describe('checkAllProviders', () => {
    it('should return installation status for all providers', async () => {
      const statuses = await registry.statuses();

      expect(statuses).toHaveProperty('claude');
    });

    it('should call detectInstallation on each provider', async () => {
      const statuses = await registry.statuses();

      expect(statuses.claude).toHaveProperty('installed');
    });

    it('should return correct provider names as keys', async () => {
      const statuses = await registry.statuses();
      const keys = Object.keys(statuses);

      expect(keys).toContain('claude');
      expect(keys).toContain('cursor');
      expect(keys).toContain('codex');
      expect(keys).toContain('opencode');
      expect(keys).toContain('gemini');
      expect(keys).toContain('copilot');
      expect(keys).toContain('openai-compatible');
      expect(keys).toHaveLength(7);
    });

    it('should include cursor status', async () => {
      const statuses = await registry.statuses();

      expect(statuses.cursor).toHaveProperty('installed');
    });
  });

  describe('getProviderByName', () => {
    it("should return ClaudeProvider for 'claude'", () => {
      const provider = registry.byName('claude');
      expect(provider).toBeInstanceOf(ClaudeProvider);
    });

    it("should return ClaudeProvider for 'anthropic'", () => {
      const provider = registry.byName('anthropic');
      expect(provider).toBeInstanceOf(ClaudeProvider);
    });

    it("should return CursorProvider for 'cursor'", () => {
      const provider = registry.byName('cursor');
      expect(provider).toBeInstanceOf(CursorProvider);
    });

    it('should be case-insensitive', () => {
      const provider1 = registry.byName('CLAUDE');
      const provider2 = registry.byName('ANTHROPIC');
      const provider3 = registry.byName('CURSOR');

      expect(provider1).toBeInstanceOf(ClaudeProvider);
      expect(provider2).toBeInstanceOf(ClaudeProvider);
      expect(provider3).toBeInstanceOf(CursorProvider);
    });

    it('should return null for unknown provider', () => {
      const provider = registry.byName('unknown');
      expect(provider).toBeNull();
    });

    it('should return null for empty string', () => {
      const provider = registry.byName('');
      expect(provider).toBeNull();
    });

    it('should create new instance each time', () => {
      const provider1 = registry.byName('claude');
      const provider2 = registry.byName('claude');

      expect(provider1).not.toBe(provider2);
      expect(provider1).toBeInstanceOf(ClaudeProvider);
      expect(provider2).toBeInstanceOf(ClaudeProvider);
    });
  });

  describe('getAllAvailableModels', () => {
    it('should return array of models', () => {
      const models = registry.allModels();
      expect(Array.isArray(models)).toBe(true);
    });

    it('should include models from all providers', () => {
      const models = registry.allModels();
      expect(models.length).toBeGreaterThan(0);
    });

    it('should return models with required fields', () => {
      const models = registry.allModels();

      models.forEach((model) => {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('name');
        expect(typeof model.id).toBe('string');
        expect(typeof model.name).toBe('string');
      });
    });

    it('should include Claude models', () => {
      const models = registry.allModels();

      // Claude models should include claude-* in their IDs
      const hasClaudeModels = models.some((m) => m.id.toLowerCase().includes('claude'));

      expect(hasClaudeModels).toBe(true);
    });

    it('should include Cursor models', () => {
      const models = registry.allModels();

      // Cursor models should include cursor provider
      const hasCursorModels = models.some((m) => m.provider === 'cursor');

      expect(hasCursorModels).toBe(true);
    });
  });
});
