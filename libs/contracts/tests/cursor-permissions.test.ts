import { expect, it } from 'vitest';
import {
  CursorProfileRequestSchema,
  CursorCustomPermissionsRequestSchema,
  CursorDeletePermissionsRequestSchema,
  CursorPermissionsTargetResponseSchema,
} from '../src/index.js';

const target = {
  kind: 'host-cursor-permissions',
  provider: 'cursor',
  scope: 'global',
  configPath: '/profile/cli-config.json',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  workingDirectory: '/backend',
};
it('requires a versioned read-only preview before consent', () => {
  expect(
    CursorPermissionsTargetResponseSchema.parse({ success: true, protocolVersion: 1, target })
      .target
  ).toEqual(target);
  expect(CursorPermissionsTargetResponseSchema.safeParse({ success: true, target }).success).toBe(
    false
  );
});
it.each([
  {},
  { confirmed: false, target, profileId: 'strict' },
  { confirmed: true, target, profileId: 'custom' },
  { confirmed: true, target: { ...target, scope: 'docker' }, profileId: 'strict' },
  { confirmed: true, target, profileId: 'strict', projectPath: '/other' },
  { confirmed: true, target: { ...target, scope: 'project' }, profileId: 'strict' },
])('rejects ambiguous target/confirmation: %s', (input) => {
  expect(CursorProfileRequestSchema.safeParse(input).success).toBe(false);
});
it('limits custom and delete to confirmed project targets', () => {
  expect(
    CursorCustomPermissionsRequestSchema.safeParse({
      confirmed: true,
      target,
      permissions: { allow: [], deny: [] },
    }).success
  ).toBe(false);
  expect(CursorDeletePermissionsRequestSchema.safeParse({ confirmed: true, target }).success).toBe(
    false
  );
  const project = {
    ...target,
    scope: 'project',
    projectPath: '/project',
    configPath: '/project/.cursor/cli.json',
  };
  expect(
    CursorCustomPermissionsRequestSchema.safeParse({
      confirmed: true,
      target: project,
      permissions: { allow: [1], deny: [] },
    }).success
  ).toBe(false);
  expect(
    CursorCustomPermissionsRequestSchema.parse({
      confirmed: true,
      target: project,
      permissions: { allow: [], deny: [] },
    }).target
  ).toEqual(project);
  expect(
    CursorDeletePermissionsRequestSchema.parse({ confirmed: true, target: project }).target
  ).toEqual(project);
});
