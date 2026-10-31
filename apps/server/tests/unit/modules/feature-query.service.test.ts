import { describe, expect, it, vi } from 'vitest';
import { FeatureQueryService } from '@/modules/features/feature-query.service.js';
import type { FeatureRepository } from '@/modules/features/feature.repository.js';

const feature = {
  id: 'feature-1',
  title: 'First feature',
  description: 'Description',
  status: 'pending',
} as never;

const createRepository = (): FeatureRepository => ({
  list: vi.fn().mockResolvedValue([feature]),
  get: vi.fn().mockResolvedValue(feature),
  getAgentConversation: vi.fn().mockResolvedValue([]),
  getAgentOutput: vi.fn().mockResolvedValue('agent output'),
  getRawOutput: vi.fn().mockResolvedValue('{"type":"result"}'),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  syncToAppSpec: vi.fn(),
});

describe('FeatureQueryService', () => {
  it('serves repository reads and starts orphan detection without delaying the response', async () => {
    const repository = createRepository();
    let finishDetection: (() => void) | undefined;
    const detection = new Promise<never>((resolve) => {
      finishDetection = resolve as never;
    });
    const autoMode = { detectOrphanedFeatures: vi.fn().mockReturnValue(detection) };
    const service = new FeatureQueryService(repository, {} as never, autoMode as never);

    await expect(service.list('/project')).resolves.toEqual({ success: true, features: [feature] });
    expect(autoMode.detectOrphanedFeatures).toHaveBeenCalledWith('/project', [feature]);
    await expect(service.get('/project', 'feature-1')).resolves.toEqual({
      success: true,
      feature,
    });
    await expect(service.agentOutput('/project', 'feature-1')).resolves.toEqual({
      success: true,
      content: 'agent output',
      conversation: [],
    });
    finishDetection?.();
  });

  it('returns a stable not-found error for an unknown feature', async () => {
    const repository = createRepository();
    vi.mocked(repository.get).mockResolvedValue(null);
    const service = new FeatureQueryService(
      repository,
      {} as never,
      { detectOrphanedFeatures: vi.fn() } as never
    );

    await expect(service.get('/project', 'missing')).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'NOT_FOUND',
    });
  });

  it('checks import conflicts using the repository and rejects malformed input', async () => {
    const repository = createRepository();
    const service = new FeatureQueryService(
      repository,
      {} as never,
      { detectOrphanedFeatures: vi.fn() } as never
    );
    const data = JSON.stringify(feature);

    await expect(service.conflicts({ projectPath: '/project', data })).resolves.toMatchObject({
      success: true,
      hasConflicts: true,
      totalFeatures: 1,
      conflictCount: 1,
    });
    await expect(
      service.conflicts({ projectPath: '/project', data: 'not valid yaml: [' })
    ).rejects.toMatchObject({ statusCode: 400, errorCode: 'VALIDATION_ERROR' });
  });
});
