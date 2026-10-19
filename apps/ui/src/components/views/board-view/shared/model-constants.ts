import { translate } from '@/lib/i18n';
import type { ModelProvider, ThinkingLevel, ReasoningEffort } from '@automaker/types';
import {
  CURSOR_MODEL_MAP,
  CODEX_MODEL_MAP,
  OPENCODE_MODELS as OPENCODE_MODEL_CONFIGS,
  GEMINI_MODEL_MAP,
  COPILOT_MODEL_MAP,
} from '@automaker/types';
import { Brain, Zap, Scale, Cpu, Rocket, Sparkles } from 'lucide-react';
import {
  AnthropicIcon,
  CursorIcon,
  OpenAIIcon,
  OpenCodeIcon,
  GeminiIcon,
  CopilotIcon,
} from '@/components/ui/provider-icon';

export type ModelOption = {
  id: string; // All model IDs use canonical prefixed format (e.g., "claude-sonnet", "cursor-auto")
  label: string;
  description: string;
  badge?: string;
  provider: ModelProvider;
  hasThinking?: boolean;
};

/**
 * Claude models with canonical prefixed IDs
 * UI displays short labels but stores full canonical IDs
 */
export const CLAUDE_MODELS: ModelOption[] = [
  {
    id: 'claude-haiku', // Canonical prefixed ID
    get label() {
      return 'Claude Haiku';
    },
    get description() {
      return translate('Fast and efficient for simple tasks.');
    },
    get badge() {
      return translate('Speed');
    },
    provider: 'claude',
  },
  {
    id: 'claude-sonnet', // Canonical prefixed ID
    get label() {
      return 'Claude Sonnet';
    },
    get description() {
      return translate('Balanced performance with strong reasoning.');
    },
    get badge() {
      return translate('Balanced');
    },
    provider: 'claude',
  },
  {
    id: 'claude-opus', // Canonical prefixed ID
    get label() {
      return 'Claude Opus';
    },
    get description() {
      return translate('Most capable model for complex work.');
    },
    get badge() {
      return translate('Premium');
    },
    provider: 'claude',
  },
];

/**
 * Cursor models derived from CURSOR_MODEL_MAP
 * IDs already have 'cursor-' prefix in the canonical format
 */
export const CURSOR_MODELS: ModelOption[] = Object.entries(CURSOR_MODEL_MAP).map(
  ([id, config]) => ({
    id, // Already prefixed in canonical format
    get label() {
      return config.label;
    },
    get description() {
      return translate(config.description);
    },
    provider: 'cursor' as ModelProvider,
    hasThinking: config.hasThinking,
  })
);

/**
 * Codex/OpenAI models
 * Official models from https://developers.openai.com/codex/models/
 */
export const CODEX_MODELS: ModelOption[] = [
  {
    id: CODEX_MODEL_MAP.gpt52Codex,
    get label() {
      return 'GPT-5.2-Codex';
    },
    get description() {
      return translate('Most advanced agentic coding model for complex software engineering.');
    },
    get badge() {
      return translate('Premium');
    },
    provider: 'codex',
    hasThinking: true,
  },
  {
    id: CODEX_MODEL_MAP.gpt51CodexMax,
    get label() {
      return 'GPT-5.1-Codex-Max';
    },
    get description() {
      return translate('Optimized for long-horizon, agentic coding tasks in Codex.');
    },
    get badge() {
      return translate('Premium');
    },
    provider: 'codex',
    hasThinking: true,
  },
  {
    id: CODEX_MODEL_MAP.gpt51CodexMini,
    get label() {
      return 'GPT-5.1-Codex-Mini';
    },
    get description() {
      return translate('Smaller, more cost-effective version for faster workflows.');
    },
    get badge() {
      return translate('Speed');
    },
    provider: 'codex',
    hasThinking: false,
  },
  {
    id: CODEX_MODEL_MAP.gpt52,
    get label() {
      return 'GPT-5.2';
    },
    get description() {
      return translate('Best general agentic model for tasks across industries and domains.');
    },
    get badge() {
      return translate('Balanced');
    },
    provider: 'codex',
    hasThinking: true,
  },
  {
    id: CODEX_MODEL_MAP.gpt51,
    get label() {
      return 'GPT-5.1';
    },
    get description() {
      return translate('Great for coding and agentic tasks across domains.');
    },
    get badge() {
      return translate('Balanced');
    },
    provider: 'codex',
    hasThinking: true,
  },
];

/**
 * OpenCode models derived from OPENCODE_MODEL_CONFIGS
 */
export const OPENCODE_MODELS: ModelOption[] = OPENCODE_MODEL_CONFIGS.map((config) => ({
  id: config.id,
  get label() {
    return config.label;
  },
  get description() {
    return translate(config.description);
  },
  badge: config.tier === 'free' ? 'Free' : config.tier === 'premium' ? 'Premium' : undefined,
  provider: config.provider as ModelProvider,
}));

/**
 * Gemini models derived from GEMINI_MODEL_MAP
 * Model IDs already have 'gemini-' prefix (like Cursor models)
 */
export const GEMINI_MODELS: ModelOption[] = Object.entries(GEMINI_MODEL_MAP).map(
  ([id, config]) => ({
    id, // IDs already have gemini- prefix (e.g., 'gemini-2.5-flash')
    get label() {
      return config.label;
    },
    get description() {
      return translate(config.description);
    },
    badge: config.supportsThinking ? 'Thinking' : 'Speed',
    provider: 'gemini' as ModelProvider,
    hasThinking: config.supportsThinking,
  })
);

/**
 * Copilot models derived from COPILOT_MODEL_MAP
 * Model IDs already have 'copilot-' prefix
 */
export const COPILOT_MODELS: ModelOption[] = Object.entries(COPILOT_MODEL_MAP).map(
  ([id, config]) => ({
    id, // IDs already have copilot- prefix (e.g., 'copilot-gpt-4o')
    get label() {
      return config.label;
    },
    get description() {
      return translate(config.description);
    },
    badge: config.supportsVision ? 'Vision' : 'Standard',
    provider: 'copilot' as ModelProvider,
    hasThinking: false,
  })
);

/**
 * All available models (Claude + Cursor + Codex + OpenCode + Gemini + Copilot)
 */
export const ALL_MODELS: ModelOption[] = [
  ...CLAUDE_MODELS,
  ...CURSOR_MODELS,
  ...CODEX_MODELS,
  ...OPENCODE_MODELS,
  ...GEMINI_MODELS,
  ...COPILOT_MODELS,
];

export const THINKING_LEVELS: ThinkingLevel[] = [
  'none',
  'low',
  'medium',
  'high',
  'ultrathink',
  'adaptive',
];

export const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  get none() {
    return translate('None');
  },
  get low() {
    return translate('Low');
  },
  get medium() {
    return translate('Med');
  },
  get high() {
    return translate('High');
  },
  get ultrathink() {
    return translate('Ultra');
  },
  get adaptive() {
    return translate('Adaptive');
  },
};

/**
 * Reasoning effort levels for Codex/OpenAI models
 * All models support reasoning effort levels
 */
export const REASONING_EFFORT_LEVELS: ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  get none() {
    return translate('None');
  },
  get minimal() {
    return translate('Min');
  },
  get low() {
    return translate('Low');
  },
  get medium() {
    return translate('Med');
  },
  get high() {
    return translate('High');
  },
  get xhigh() {
    return translate('XHigh');
  },
};

// Profile icon mapping
export const PROFILE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Brain,
  Zap,
  Scale,
  Cpu,
  Rocket,
  Sparkles,
  Anthropic: AnthropicIcon,
  Cursor: CursorIcon,
  Codex: OpenAIIcon,
  OpenCode: OpenCodeIcon,
  Gemini: GeminiIcon,
  Copilot: CopilotIcon,
};
