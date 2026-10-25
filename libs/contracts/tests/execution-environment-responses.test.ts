import { expect, it } from 'vitest';
import { z } from 'zod';
import type {
  DockerConnectionDiagnostic,
  RemoteProviderStatus,
  SSHDiagnostic,
} from '@automaker/types';
import {
  ExecutionEnvironmentSettingsResponseSchema,
  ExecutionEnvironmentFeatureResponseSchema,
  ExecutionDockerDiagnosticResponseSchema,
  ExecutionDockerPreparationResponseSchema,
  ExecutionProviderStatusResponseSchema,
  ExecutionSSHScanResponseSchema,
  ExecutionSSHDiagnosticResponseSchema,
} from '../src/domains/execution-environment-responses.js';

it('keeps full nested configuration, consent, historical optional nulls and extensions', () => {
  const profile = {
    id: 'ssh',
    name: 'Fixture',
    type: 'ssh',
    host: 'offline.invalid',
    port: 22,
    username: 'fixture',
    basePath: '/remote',
    credentialId: null,
    extra: { kept: true },
  };
  const response = {
    success: true,
    settings: { default: { mode: 'local' }, profiles: [profile], extraSettings: [null] },
    projectOverride: null,
    resolved: {
      selection: { mode: 'profile', profileId: 'ssh' },
      source: 'project',
      type: 'ssh',
      profile,
      runtimeIntegrated: true,
    },
    localConsent: {
      warningVersion: 1,
      confirmed: false,
      scope: null,
      legacy: true,
      serverContainerized: false,
      autoFallbackScope: null,
    },
    ssh: {
      trustedHost: null,
      hasPrivateKey: false,
      agentAvailable: false,
      project: {
        remotePath: '/remote',
        pendingOperations: 0,
        preparing: true,
        stagingPath: null,
        extraProject: true,
      },
    },
    extraEnvelope: null,
  };
  expect(ExecutionEnvironmentSettingsResponseSchema.parse(response)).toEqual(response);
  expect(ExecutionEnvironmentSettingsResponseSchema.safeParse({ success: true }).success).toBe(
    false
  );
});

it('preserves minimal historical bindings as well as known optional descriptor fields', () => {
  const binding = {
    version: 1,
    id: 'binding',
    projectPath: '/fixture',
    cwd: null,
    docker: { context: null, mount: { subpath: null }, extension: { kept: true } },
    extraBinding: [null],
  };
  const response = { success: true, binding, selectedType: 'missing-profile' };
  expect(ExecutionEnvironmentFeatureResponseSchema.parse(response)).toEqual(response);
  expect(
    ExecutionEnvironmentFeatureResponseSchema.parse({
      success: true,
      binding: null,
      selectedType: 'local',
    }).binding
  ).toBeNull();
  expect(
    ExecutionEnvironmentFeatureResponseSchema.safeParse({
      success: true,
      binding: { version: 1 },
      selectedType: 'local',
    }).success
  ).toBe(false);
  const opaque = {
    ...binding,
    cwd: false,
    createdAt: 123,
    selection: { mode: 77 },
    docker: 'historical opaque value',
  };
  expect(
    ExecutionEnvironmentFeatureResponseSchema.parse({ ...response, binding: opaque }).binding
  ).toEqual(opaque);
});

it('does not reinterpret unavailable/unverified producer states as top-level errors', () => {
  const diagnostic: DockerConnectionDiagnostic = {
    status: 'unreachable',
    checkedAt: 'historical time',
    scope: 'connection-only',
    containerLifecycle: 'not-tested',
    projectStorage: 'not-tested',
    platform: 'linux',
    serverContainerized: false,
    message: 'Offline',
    remediation: ['Fixture'],
    documentation: [{ label: 'Fixture', url: 'historical link' }],
  };
  expect(ExecutionDockerDiagnosticResponseSchema.parse({ success: true, diagnostic })).toEqual({
    success: true,
    diagnostic,
  });
  const status: RemoteProviderStatus = {
    provider: 'claude',
    targetId: 'fixture',
    environment: 'ssh',
    cwd: '/remote',
    packageVersion: 'fixture',
    installed: false,
    root: '/remote',
    hasStoredKey: false,
    credentialSource: 'not-detected',
    authentication: 'not-detected',
  };
  expect(ExecutionProviderStatusResponseSchema.parse({ success: true, status })).toEqual({
    success: true,
    status,
  });
  const ssh: SSHDiagnostic = {
    status: 'trust-required',
    checkedAt: 'historical time',
    message: 'Confirm trust',
    worker: 'not-tested',
    project: 'not-tested',
  };
  expect(ExecutionSSHDiagnosticResponseSchema.parse({ success: true, diagnostic: ssh })).toEqual({
    success: true,
    diagnostic: ssh,
  });
});

it('exports all seven response families as JSON Schema and rejects malformed nested producers', () => {
  for (const schema of [
    ExecutionEnvironmentSettingsResponseSchema,
    ExecutionEnvironmentFeatureResponseSchema,
    ExecutionDockerDiagnosticResponseSchema,
    ExecutionDockerPreparationResponseSchema,
    ExecutionProviderStatusResponseSchema,
    ExecutionSSHScanResponseSchema,
    ExecutionSSHDiagnosticResponseSchema,
  ])
    expect(z.toJSONSchema(schema, { io: 'output' })).toBeTypeOf('object');
  expect(
    ExecutionProviderStatusResponseSchema.safeParse({
      success: true,
      status: { installed: 'wrong' },
    }).success
  ).toBe(false);
  expect(
    ExecutionDockerPreparationResponseSchema.safeParse({
      success: true,
      preparation: { connection: true },
    }).success
  ).toBe(false);
  expect(
    ExecutionSSHScanResponseSchema.safeParse({
      success: true,
      hostKey: { algorithm: 'ssh-ed25519', fingerprint: 42 },
    }).success
  ).toBe(false);
});
