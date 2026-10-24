import { describe, expect, it } from 'vitest';
import { ProviderDisconnectRequestSchema, ProviderDisconnectResponseSchema } from '../src/index.js';

const target = {
  kind: 'host-application',
  provider: 'claude',
  workingDirectory: '/backend',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
};
describe('provider disconnect transport contract', () => {
  it('requires explicit confirmation of a concrete host application instance', () => {
    expect(ProviderDisconnectRequestSchema.parse({ confirmed: true, target })).toEqual({
      confirmed: true,
      target,
    });
  });
  it.each([
    {},
    { target },
    { confirmed: false, target },
    { confirmed: 'true', target },
    { confirmed: true },
    { confirmed: true, target: { ...target, kind: 'ssh' } },
    { confirmed: true, target: { ...target, instanceId: '' } },
    { confirmed: true, target, environmentId: 'remote' },
    { confirmed: true, target: { ...target, projectPath: '/other' } },
  ])('rejects implicit or ambiguous target mutation: %s', (value) => {
    expect(ProviderDisconnectRequestSchema.safeParse(value).success).toBe(false);
  });
  it('requires the actual target and disconnected state in the response', () => {
    expect(
      ProviderDisconnectResponseSchema.safeParse({ success: true, message: 'done' }).success
    ).toBe(false);
    expect(
      ProviderDisconnectResponseSchema.parse({
        success: true,
        message: 'done',
        connected: false,
        target,
      }).target
    ).toEqual(target);
  });
});
