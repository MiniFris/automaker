import {
  isCodexModel,
  isCopilotModel,
  isCursorModel,
  isDirectModel,
  isGeminiModel,
  isOpencodeModel,
} from '@automaker/types';

import { ClaudeProvider } from '../../providers/claude-provider.js';
import { CodexProvider } from '../../providers/codex-provider.js';
import { CopilotProvider } from '../../providers/copilot-provider.js';
import { CursorProvider } from '../../providers/cursor-provider.js';
import { GeminiProvider } from '../../providers/gemini-provider.js';
import { OpenAICompatibleProvider } from '../../providers/openai-compatible-provider.js';
import { OpencodeProvider } from '../../providers/opencode-provider.js';
import type { SettingsService } from '../../services/settings-service.js';
import type { ProviderRegistration } from './provider-registry.service.js';

export function createProviderRegistrations(
  settings: SettingsService
): readonly ProviderRegistration[] {
  return Object.freeze([
    {
      name: 'openai-compatible',
      priority: 100,
      canHandleModel: isDirectModel,
      create: () => new OpenAICompatibleProvider(),
    },
    {
      name: 'claude',
      aliases: ['anthropic'],
      canHandleModel: (model: string) =>
        model.startsWith('claude-') ||
        ['opus', 'sonnet', 'haiku'].some((name) => model.includes(name)),
      create: () => new ClaudeProvider(),
    },
    {
      name: 'cursor',
      priority: 10,
      canHandleModel: isCursorModel,
      create: () => new CursorProvider(),
    },
    {
      name: 'codex',
      aliases: ['openai'],
      priority: 5,
      canHandleModel: isCodexModel,
      create: () => new CodexProvider(settings),
    },
    {
      name: 'opencode',
      priority: 3,
      canHandleModel: isOpencodeModel,
      create: () => new OpencodeProvider(),
    },
    {
      name: 'gemini',
      aliases: ['google'],
      priority: 4,
      canHandleModel: isGeminiModel,
      create: () => new GeminiProvider(),
    },
    {
      name: 'copilot',
      aliases: ['github-copilot', 'github'],
      priority: 6,
      canHandleModel: isCopilotModel,
      create: () => new CopilotProvider(),
    },
  ]);
}
