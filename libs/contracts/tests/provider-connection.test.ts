import { describe, expect, it } from 'vitest';
import {
  ProviderDisconnectRequestSchema,
  ProviderDisconnectResponseSchema,
  ProviderConnectionTargetResponseSchema,
  ProviderReconnectRequestSchema,
  ProviderReconnectResponseSchema,
} from '../src/index.js';

const target = {
  kind: 'host-application',
  provider: 'claude',
  workingDirectory: '/backend',
  instanceId: '41f89322-63ec-40f7-90b1-ef76c55a47ee',
};
describe('provider disconnect transport contract', () => {
  it('does not accept an unversioned target preview as proof of reconnect support', () => {
    expect(
      ProviderConnectionTargetResponseSchema.safeParse({ success: true, target }).success
    ).toBe(false);
    expect(
      ProviderConnectionTargetResponseSchema.parse({ success: true, protocolVersion: 3, target })
        .protocolVersion
    ).toBe(3);
  });
  it('keeps application reconnect separate from verified CLI authentication', () => {
    expect(ProviderReconnectRequestSchema.safeParse({ confirmed: false, target }).success).toBe(
      false
    );
    expect(
      ProviderReconnectResponseSchema.parse({
        success: true,
        connected: true,
        target,
        message: 'connected',
        credentialStatus: 'present-unverified',
        wasAlreadyAuthenticated: true,
      }).credentialStatus
    ).toBe('present-unverified');
    expect(
      ProviderReconnectResponseSchema.safeParse({
        success: true,
        connected: true,
        target,
        message: 'connected',
      }).success
    ).toBe(false);
  });
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
