import { describe, expect, it } from 'vitest';
import {
  API_CONTRACT_VERSION,
  AppSpecCreateSchema,
  BacklogApplySchema,
  FeatureUpdateSchema,
  SessionCreateSchema,
} from '../src/index.js';

describe('project domain transport contracts', () => {
  it('publishes an explicit API contract version', () => {
    expect(API_CONTRACT_VERSION).toBe('1');
  });

  it('applies defaults from the same schemas consumed by the server', () => {
    expect(
      AppSpecCreateSchema.parse({ projectPath: '/project', projectOverview: 'Overview' })
    ).toMatchObject({ generateFeatures: false, analyzeProject: true });
  });

  it('rejects unknown fields and empty mutations', () => {
    expect(
      SessionCreateSchema.safeParse({ name: 'Session', projectPath: '/project', extra: true })
        .success
    ).toBe(false);
    expect(
      FeatureUpdateSchema.safeParse({
        projectPath: '/project',
        featureId: 'feature-1',
        updates: {},
      }).success
    ).toBe(false);
  });

  it('validates backlog approval payloads', () => {
    expect(
      BacklogApplySchema.parse({
        projectPath: '/project',
        plan: { changes: [], summary: 'Approved', dependencyUpdates: [] },
      }).plan
    ).toEqual({ changes: [], summary: 'Approved', dependencyUpdates: [] });
  });
});
