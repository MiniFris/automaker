import { expect, it } from 'vitest';
import { CloneTemplateResponseSchema } from '../src/domains/templates.js';
import {
  WorkspaceConfigResponseSchema,
  WorkspaceDirectoriesResponseSchema,
} from '../src/domains/workspace.js';

it('preserves workspace diagnostic variants and extensions while requiring their actual payload', () => {
  for (const value of [
    { success: true, configured: true, workspaceDir: '/root', defaultDir: '/root' },
    { success: true, configured: false, defaultDir: null },
    { success: true, configured: false, error: 'Unavailable directory' },
  ]) {
    const extended = { ...value, extension: { retained: true } };
    expect(WorkspaceConfigResponseSchema.parse(extended)).toEqual(extended);
  }
  for (const invalid of [
    { success: true, configured: true, defaultDir: '/root' },
    { success: true, configured: false },
    { success: true, configured: false, defaultDir: '/root', error: 123 },
    { success: true, configured: false, error: 'Error', workspaceDir: 123 },
  ])
    expect(WorkspaceConfigResponseSchema.safeParse(invalid).success).toBe(false);
});

it('validates directory and clone records without narrowing paths or dropping extensions', () => {
  const value = { success: true, directories: [{ name: 'a', path: 'C:\\a', extension: true }] };
  expect(WorkspaceDirectoriesResponseSchema.parse(value)).toEqual(value);
  expect(
    WorkspaceDirectoriesResponseSchema.safeParse({ success: true, directories: [{ name: 'a' }] })
      .success
  ).toBe(false);
  expect(
    CloneTemplateResponseSchema.parse({
      success: true,
      projectName: 'a',
      projectPath: '/a',
      extension: true,
    })
  ).toEqual({ success: true, projectName: 'a', projectPath: '/a', extension: true });
  expect(CloneTemplateResponseSchema.safeParse({ success: true, projectPath: '/a' }).success).toBe(
    false
  );
});
