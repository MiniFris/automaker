import type { HttpDomainTransport } from './transport';
import type { SpecRegenerationAPI, SpecRegenerationEvent } from '../electron';
import type { EventCallback } from '../http-api-client';

export function createSpecRegenerationClient(
  transport: Pick<HttpDomainTransport, 'post' | 'get' | 'subscribeToEvent'>
): SpecRegenerationAPI {
  return {
    create: (
      projectPath: string,
      projectOverview: string,
      generateFeatures?: boolean,
      analyzeProject?: boolean,
      maxFeatures?: number
    ) =>
      transport.post('/api/spec-regeneration/create', {
        projectPath,
        projectOverview,
        generateFeatures,
        analyzeProject,
        maxFeatures,
      }),
    generate: (
      projectPath: string,
      projectDefinition: string,
      generateFeatures?: boolean,
      analyzeProject?: boolean,
      maxFeatures?: number
    ) =>
      transport.post('/api/spec-regeneration/generate', {
        projectPath,
        projectDefinition,
        generateFeatures,
        analyzeProject,
        maxFeatures,
      }),
    generateFeatures: (projectPath: string, maxFeatures?: number) =>
      transport.post('/api/spec-regeneration/generate-features', {
        projectPath,
        maxFeatures,
      }),
    sync: (projectPath: string) => transport.post('/api/spec-regeneration/sync', { projectPath }),
    stop: (projectPath?: string) => transport.post('/api/spec-regeneration/stop', { projectPath }),
    status: (projectPath?: string) =>
      transport.get(
        projectPath
          ? `/api/spec-regeneration/status?projectPath=${encodeURIComponent(projectPath)}`
          : '/api/spec-regeneration/status'
      ),
    onEvent: (callback: (event: SpecRegenerationEvent) => void) => {
      return transport.subscribeToEvent('spec-regeneration:event', callback as EventCallback);
    },
  };
}
