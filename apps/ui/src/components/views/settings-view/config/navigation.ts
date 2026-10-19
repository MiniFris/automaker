import { translate } from '@/lib/i18n';
import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Key,
  Bot,
  SquareTerminal,
  Palette,
  Settings2,
  Volume2,
  FlaskConical,
  Workflow,
  Plug,
  MessageSquareText,
  User,
  Shield,
  GitBranch,
  Code2,
  Webhook,
  FileCode2,
  FileText,
} from 'lucide-react';
import {
  AnthropicIcon,
  CursorIcon,
  OpenAIIcon,
  OpenCodeIcon,
  GeminiIcon,
  CopilotIcon,
} from '@/components/ui/provider-icon';
import type { SettingsViewId } from '../hooks/use-settings-view';

export interface NavigationItem {
  id: SettingsViewId;
  label: string;
  icon: LucideIcon | React.ComponentType<{ className?: string }>;
  subItems?: NavigationItem[];
}

export interface NavigationGroup {
  label: string;
  items: NavigationItem[];
}

// Global settings organized into groups
export const GLOBAL_NAV_GROUPS: NavigationGroup[] = [
  {
    get label() {
      return translate('Model & Prompts');
    },
    items: [
      {
        id: 'defaults',
        get label() {
          return translate('Feature Defaults');
        },
        icon: FlaskConical,
      },
      {
        id: 'model-defaults',
        get label() {
          return translate('Model Defaults');
        },
        icon: Workflow,
      },
      {
        id: 'worktrees',
        get label() {
          return translate('Worktrees');
        },
        icon: GitBranch,
      },
      {
        id: 'execution-environment',
        get label() {
          return translate('Execution Environment');
        },
        icon: SquareTerminal,
      },
      {
        id: 'prompts',
        get label() {
          return translate('Prompt Customization');
        },
        icon: MessageSquareText,
      },
      {
        id: 'templates',
        get label() {
          return translate('Templates');
        },
        icon: FileText,
      },
      {
        id: 'api-keys',
        get label() {
          return translate('API Keys');
        },
        icon: Key,
      },
      {
        id: 'providers',
        get label() {
          return translate('AI Providers');
        },
        icon: Bot,
        subItems: [
          {
            id: 'direct-provider',
            get label() {
              return translate('Direct API (OpenAI-compatible)');
            },
            icon: OpenAIIcon,
          },
          {
            id: 'claude-provider',
            get label() {
              return translate('Claude');
            },
            icon: AnthropicIcon,
          },
          {
            id: 'cursor-provider',
            get label() {
              return translate('Cursor');
            },
            icon: CursorIcon,
          },
          {
            id: 'codex-provider',
            get label() {
              return translate('Codex');
            },
            icon: OpenAIIcon,
          },
          {
            id: 'opencode-provider',
            get label() {
              return translate('OpenCode');
            },
            icon: OpenCodeIcon,
          },
          {
            id: 'gemini-provider',
            get label() {
              return translate('Gemini');
            },
            icon: GeminiIcon,
          },
          {
            id: 'copilot-provider',
            get label() {
              return translate('Copilot');
            },
            icon: CopilotIcon,
          },
        ],
      },
      {
        id: 'mcp-servers',
        get label() {
          return translate('MCP Servers');
        },
        icon: Plug,
      },
    ],
  },
  {
    get label() {
      return translate('Interface');
    },
    items: [
      {
        id: 'appearance',
        get label() {
          return translate('Appearance');
        },
        icon: Palette,
      },
      {
        id: 'editor',
        get label() {
          return translate('File Editor');
        },
        icon: FileCode2,
      },
      {
        id: 'terminal',
        get label() {
          return translate('Terminal');
        },
        icon: SquareTerminal,
      },
      {
        id: 'keyboard',
        get label() {
          return translate('Keyboard Shortcuts');
        },
        icon: Settings2,
      },
      {
        id: 'audio',
        get label() {
          return translate('Audio');
        },
        icon: Volume2,
      },
      {
        id: 'event-hooks',
        get label() {
          return translate('Event Hooks');
        },
        icon: Webhook,
      },
    ],
  },
  {
    get label() {
      return translate('Account & Security');
    },
    items: [
      {
        id: 'account',
        get label() {
          return translate('Account');
        },
        icon: User,
      },
      {
        id: 'security',
        get label() {
          return translate('Security');
        },
        icon: Shield,
      },
    ],
  },
  {
    get label() {
      return translate('Advanced');
    },
    items: [
      {
        id: 'developer',
        get label() {
          return translate('Developer');
        },
        icon: Code2,
      },
    ],
  },
];

// Flat list of all global nav items for backwards compatibility
export const GLOBAL_NAV_ITEMS: NavigationItem[] = GLOBAL_NAV_GROUPS.flatMap((group) => group.items);

// Legacy export for backwards compatibility
export const NAV_ITEMS: NavigationItem[] = GLOBAL_NAV_ITEMS;
