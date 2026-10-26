import type { OutputLocale } from '@automaker/types';

/** Application-owned values. HTTP validation/defaults stay at the transport boundary. */
export interface AddSuggestionInput {
  projectPath: string;
  suggestion: {
    category:
      | 'feature'
      | 'technical'
      | 'ux-ui'
      | 'dx'
      | 'growth'
      | 'security'
      | 'performance'
      | 'accessibility'
      | 'analytics';
    title: string;
    description: string;
    id?: string | undefined;
    rationale?: string | undefined;
    relatedFiles?: string[] | undefined;
    priority?: 'low' | 'medium' | 'high' | undefined;
  };
}

export interface ConvertInput {
  projectPath: string;
  ideaId: string;
  keepIdea?: boolean | undefined;
  column?: string | undefined;
  dependencies?: string[] | undefined;
  tags?: string[] | undefined;
}

export interface GenerateSuggestionsInput {
  outputLocale?: OutputLocale;
  projectPath: string;
  promptId: string;
  category:
    | 'feature'
    | 'technical'
    | 'ux-ui'
    | 'dx'
    | 'growth'
    | 'security'
    | 'performance'
    | 'accessibility'
    | 'analytics';
  count?: number | undefined;
  contextSources?:
    | {
        useContextFiles: boolean;
        useMemoryFiles: boolean;
        useExistingFeatures: boolean;
        useExistingIdeas: boolean;
        useAppSpec: boolean;
      }
    | undefined;
}

export interface IdeaCreateInput {
  projectPath: string;
  idea: {
    title: string;
    description: string;
    category:
      | 'feature'
      | 'technical'
      | 'ux-ui'
      | 'dx'
      | 'growth'
      | 'security'
      | 'performance'
      | 'accessibility'
      | 'analytics';
    status?: 'ready' | 'archived' | 'raw' | 'refined' | undefined;
    impact?: 'low' | 'medium' | 'high' | undefined;
    effort?: 'low' | 'medium' | 'high' | undefined;
    conversationId?: string | undefined;
    sourcePromptId?: string | undefined;
    userStories?: string[] | undefined;
    notes?: string | undefined;
  };
}

export interface IdeaGetInput {
  projectPath: string;
  ideaId: string;
}

export interface IdeaUpdateInput {
  projectPath: string;
  ideaId: string;
  updates: {
    title?: string | undefined;
    description?: string | undefined;
    category?:
      | 'feature'
      | 'technical'
      | 'ux-ui'
      | 'dx'
      | 'growth'
      | 'security'
      | 'performance'
      | 'accessibility'
      | 'analytics'
      | undefined;
    status?: 'ready' | 'archived' | 'raw' | 'refined' | undefined;
    impact?: 'low' | 'medium' | 'high' | undefined;
    effort?: 'low' | 'medium' | 'high' | undefined;
    userStories?: string[] | undefined;
    notes?: string | undefined;
  };
}

export interface ProjectInput {
  projectPath: string;
}

export interface SessionGetInput {
  projectPath: string;
  sessionId: string;
}

export interface SessionMessageInput {
  outputLocale?: OutputLocale;
  sessionId: string;
  message: string;
  options?:
    | {
        imagePaths?: string[] | undefined;
        model?: string | undefined;
        providerId?: string | undefined;
      }
    | undefined;
}

export interface SessionStartInput {
  outputLocale?: OutputLocale;
  projectPath: string;
  options?:
    | {
        promptId?: string | undefined;
        promptCategory?:
          | 'feature'
          | 'technical'
          | 'ux-ui'
          | 'dx'
          | 'growth'
          | 'security'
          | 'performance'
          | 'accessibility'
          | 'analytics'
          | undefined;
        initialMessage?: string | undefined;
      }
    | undefined;
}

export interface SessionStopInput {
  sessionId: string;
  projectPath?: string | undefined;
}
