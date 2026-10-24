import { expect, it } from 'vitest';
import { ProviderInstallGuidanceSchema } from '../src/index.js';

const guidance = {
  success: true,
  requiresManualInstall: true,
  installationPerformed: false,
  installCommand: 'npm install -g @openai/codex',
  target: {
    kind: 'host-application',
    provider: 'codex',
    workingDirectory: '/backend',
    instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
  },
};
it.each([true, false])('preserves legacy success=%s without claiming installation', (success) => {
  expect(ProviderInstallGuidanceSchema.parse({ ...guidance, success })).toEqual({
    ...guidance,
    success,
  });
});
it.each([
  { installationPerformed: true },
  { requiresManualInstall: false },
  { target: undefined },
  { installCommand: '' },
  { installed: true },
])('rejects ambiguous or performed-install responses: %s', (override) => {
  expect(ProviderInstallGuidanceSchema.safeParse({ ...guidance, ...override }).success).toBe(false);
});
