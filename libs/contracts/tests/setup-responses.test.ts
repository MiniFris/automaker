import { expect, it } from 'vitest';
import { z } from 'zod';
import {
  SetupModelsResponseSchema,
  SetupAuthenticatedProvidersResponseSchema,
  SetupPlatformResponseSchema,
  SetupCursorPermissionsReadResponseSchema,
  SetupCursorPermissionsExampleResponseSchema,
  SetupInstallationStatusResponseSchema,
  ProviderInstallGuidanceSchema,
} from '../src/domains/setup-responses.js';

const target = {
  kind: 'host-cursor-permissions',
  provider: 'cursor',
  scope: 'global',
  instanceId: '00000000-0000-4000-8000-000000000000',
  workingDirectory: '/fixture',
  configPath: '/fixture/cursor.json',
};
it('types model/provider catalogs and preserves historical nullable optional extensions', () => {
  const value = {
    success: true,
    models: [
      {
        id: 'model',
        name: 'Model',
        modelString: 'model',
        provider: 'fixture',
        description: 'Description',
        contextWindow: null,
        tier: 'historical-tier',
        extension: { kept: true },
      },
    ],
    count: 1,
    cached: false,
    extension: null,
  };
  expect(SetupModelsResponseSchema.parse(value)).toEqual(value);
  expect(SetupModelsResponseSchema.safeParse({ success: true }).success).toBe(false);
  expect(
    SetupAuthenticatedProvidersResponseSchema.parse({
      success: true,
      providers: [],
      authenticated: [],
    })
  ).toEqual({ success: true, providers: [], authenticated: [] });
});
it('keeps persisted permission read values opaque rather than imposing mutation DTOs', () => {
  const permissions = { allow: [1, null], deny: [], extension: { kept: true } };
  const response = {
    success: true,
    globalPermissions: permissions,
    projectPermissions: null,
    effectivePermissions: permissions,
    activeProfile: 'custom',
    hasProjectConfig: false,
    availableProfiles: [],
    globalTarget: target,
    extension: null,
  };
  expect(SetupCursorPermissionsReadResponseSchema.parse(response)).toEqual(response);
  expect(SetupCursorPermissionsReadResponseSchema.safeParse({ success: true }).success).toBe(false);
});
it('retains manual install success:false and exports JSON schemas without claiming installation', () => {
  const connection = {
    kind: 'host-application',
    instanceId: target.instanceId,
    provider: 'claude',
    workingDirectory: '/fixture',
  };
  expect(
    ProviderInstallGuidanceSchema.parse({
      success: false,
      error: 'Manual instructions',
      requiresManualInstall: true,
      installationPerformed: false,
      installCommand: 'fixture',
      target: connection,
    }).installationPerformed
  ).toBe(false);
  for (const schema of [
    SetupModelsResponseSchema,
    SetupAuthenticatedProvidersResponseSchema,
    SetupPlatformResponseSchema,
    SetupCursorPermissionsReadResponseSchema,
    SetupCursorPermissionsExampleResponseSchema,
    SetupInstallationStatusResponseSchema,
  ])
    expect(z.toJSONSchema(schema, { io: 'output' })).toBeTypeOf('object');
});
