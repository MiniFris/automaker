import { getUiLocale } from '../i18n';
import type { HttpDomainTransport } from './transport';
import type {
  IdeationAPI,
  IdeaCategory,
  AnalysisSuggestion,
  StartSessionOptions,
  CreateIdeaInput,
  UpdateIdeaInput,
  ConvertToFeatureOptions,
} from '../electron';
import type {
  IdeationContextSources,
  IdeationStreamEvent,
  IdeationAnalysisEvent,
} from '@automaker/types';
import type { EventCallback } from '../http-api-client';

export function createIdeationClient(
  transport: Pick<HttpDomainTransport, 'post' | 'get' | 'subscribeToEvent'>
): IdeationAPI {
  return {
    startSession: (projectPath: string, options?: StartSessionOptions) =>
      transport.post('/api/ideation/session/start', {
        projectPath,
        options,
        outputLocale: getUiLocale(),
      }),

    getSession: (projectPath: string, sessionId: string) =>
      transport.post('/api/ideation/session/get', { projectPath, sessionId }),

    sendMessage: (
      sessionId: string,
      message: string,
      options?: { imagePaths?: string[]; model?: string }
    ) =>
      transport.post('/api/ideation/session/message', {
        sessionId,
        message,
        options,
        outputLocale: getUiLocale(),
      }),

    stopSession: (sessionId: string) => transport.post('/api/ideation/session/stop', { sessionId }),

    listIdeas: (projectPath: string) => transport.post('/api/ideation/ideas/list', { projectPath }),

    createIdea: (projectPath: string, idea: CreateIdeaInput) =>
      transport.post('/api/ideation/ideas/create', { projectPath, idea }),

    getIdea: (projectPath: string, ideaId: string) =>
      transport.post('/api/ideation/ideas/get', { projectPath, ideaId }),

    updateIdea: (projectPath: string, ideaId: string, updates: UpdateIdeaInput) =>
      transport.post('/api/ideation/ideas/update', { projectPath, ideaId, updates }),

    deleteIdea: (projectPath: string, ideaId: string) =>
      transport.post('/api/ideation/ideas/delete', { projectPath, ideaId }),

    analyzeProject: (projectPath: string) =>
      transport.post('/api/ideation/analyze', { projectPath }),

    generateSuggestions: (
      projectPath: string,
      promptId: string,
      category: IdeaCategory,
      count?: number,
      contextSources?: IdeationContextSources
    ) =>
      transport.post('/api/ideation/suggestions/generate', {
        outputLocale: getUiLocale(),
        projectPath,
        promptId,
        category,
        count,
        contextSources,
      }),

    convertToFeature: (projectPath: string, ideaId: string, options?: ConvertToFeatureOptions) =>
      transport.post('/api/ideation/convert', { projectPath, ideaId, ...options }),

    addSuggestionToBoard: (
      projectPath: string,
      suggestion: AnalysisSuggestion
    ): Promise<{ success: boolean; featureId?: string; error?: string }> =>
      transport.post('/api/ideation/add-suggestion', { projectPath, suggestion }),

    getPrompts: () => transport.get('/api/ideation/prompts'),

    onStream: (callback: (event: IdeationStreamEvent) => void): (() => void) => {
      return transport.subscribeToEvent('ideation:stream', callback as EventCallback);
    },

    onAnalysisEvent: (callback: (event: IdeationAnalysisEvent) => void): (() => void) => {
      return transport.subscribeToEvent('ideation:analysis', callback as EventCallback);
    },
  };
}
