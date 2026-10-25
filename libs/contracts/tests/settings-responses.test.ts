import { expect, it } from 'vitest';
import { z } from 'zod';
import type { OpenAICompatibleEndpoint } from '@automaker/types';
import {
  SettingsStatusResponseSchema,
  SettingsDocumentResponseSchema,
  SettingsCredentialsResponseSchema,
  SettingsAgentsResponseSchema,
  SettingsTimeoutsResponseSchema,
  SettingsDirectResponseSchema,
  SettingsMigrationResponseSchema,
  SettingsDirectModelsResponseSchema,
  SettingsDirectTestResponseSchema,
  SettingsRetiredCredentialsResponseSchema,
} from '../src/domains/settings.js';

it('keeps settings documents intentionally extensible without restricting historical user fields', () => {
  const value = {
    success: true,
    settings: {
      theme: 'custom-theme',
      version: null,
      custom: [{ nested: null }, true],
      future: { anything: 'kept' },
    },
    extraEnvelope: null,
  };
  expect(SettingsDocumentResponseSchema.parse(value)).toEqual(value);
  expect(SettingsDocumentResponseSchema.safeParse({ success: true, settings: [] }).success).toBe(
    false
  );
  expect(SettingsDocumentResponseSchema.safeParse({ success: true }).success).toBe(false);
});

it('checks server-owned credential status and discovery primitives without stripping extensions', () => {
  const status = { configured: false, masked: '', extension: null };
  const value = {
    success: true,
    credentials: {
      anthropic: status,
      google: status,
      openai: status,
      zai: status,
      futureVendor: { enabled: null },
    },
  };
  expect(SettingsCredentialsResponseSchema.parse(value)).toEqual(value);
  expect(
    SettingsCredentialsResponseSchema.safeParse({ success: true, credentials: {} }).success
  ).toBe(false);
  const agents = {
    success: true,
    agents: [
      {
        name: 'agent',
        source: 'future-source',
        filePath: 'legacy path',
        definition: {
          description: 'Text',
          prompt: 'Prompt',
          model: null,
          tools: null,
          extension: [1],
        },
        extension: null,
      },
    ],
  };
  expect(SettingsAgentsResponseSchema.parse(agents)).toEqual(agents);
});

it('describes full direct endpoint/model/capability records and preserves compatible extension values', () => {
  const endpoint = {
    id: 'fixture',
    name: 'Fixture',
    enabled: false,
    baseUrl: 'https://offline.invalid/v1',
    protocol: 'chat-completions',
    auth: { type: 'none' },
    models: [
      {
        id: 'Model/Exact:Tag',
        displayName: 'Model',
        capabilities: { tools: true, streaming: false },
      },
    ],
  } satisfies OpenAICompatibleEndpoint;
  const value = {
    success: true,
    endpoints: [{ endpoint, keyConfigured: false }],
    agentSettings: { access: 'read-only' },
  };
  expect(SettingsDirectResponseSchema.parse(value)).toEqual(value);
  const legacy = {
    ...value,
    endpoints: [
      {
        endpoint: {
          ...endpoint,
          protocol: 'future-protocol',
          timeoutMs: null,
          extension: { kept: true },
        },
        keyConfigured: false,
        extension: null,
      },
    ],
    agentSettings: { shell: null, limits: null },
  };
  expect(SettingsDirectResponseSchema.parse(legacy)).toEqual(legacy);
  expect(
    SettingsDirectResponseSchema.safeParse({ success: true, endpoints: [{}], agentSettings: {} })
      .success
  ).toBe(false);
});

it('preserves the complete migration false variant rather than treating it as an HTTP error', () => {
  const value = {
    success: false,
    migratedGlobalSettings: true,
    migratedCredentials: false,
    credentialImportRequired: true,
    migratedProjectCount: 0,
    errors: ['Fixture migration issue'],
  };
  expect(SettingsMigrationResponseSchema.parse(value)).toEqual(value);
  expect(SettingsMigrationResponseSchema.safeParse({ success: false }).success).toBe(false);
});

it('exports every Settings response as JSON Schema with concrete payload requirements', () => {
  for (const schema of [
    SettingsStatusResponseSchema,
    SettingsDocumentResponseSchema,
    SettingsCredentialsResponseSchema,
    SettingsAgentsResponseSchema,
    SettingsTimeoutsResponseSchema,
    SettingsDirectResponseSchema,
    SettingsMigrationResponseSchema,
    SettingsDirectModelsResponseSchema,
    SettingsDirectTestResponseSchema,
    SettingsRetiredCredentialsResponseSchema,
  ])
    expect(z.toJSONSchema(schema, { io: 'output' })).toBeTypeOf('object');
  expect(
    SettingsDirectModelsResponseSchema.safeParse({ success: true, models: [42] }).success
  ).toBe(false);
  expect(
    SettingsTimeoutsResponseSchema.safeParse({
      success: true,
      timeouts: { requestTimeoutMs: null },
    }).success
  ).toBe(false);
});
