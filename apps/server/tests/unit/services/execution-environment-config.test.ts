import { describe, expect, it } from 'vitest';
import {
  defaultEnvironmentSettings,
  parseEnvironmentProfile,
  parseEnvironmentSelection,
  parseEnvironmentSettings,
  resolveEnvironment,
} from '@/services/execution-environment/config.js';

describe('execution environment configuration and inheritance', () => {
  const docker = { id: 'docker', name: 'Project Docker', type: 'docker', context: 'desktop-linux' };
  const ssh = {
    id: 'remote',
    name: 'Development server',
    type: 'ssh',
    host: 'dev.example.com',
    username: 'developer',
    port: 22,
    basePath: '/srv/projects',
  };
  it('preserves legacy local behavior when configuration is absent', () => {
    expect(resolveEnvironment(defaultEnvironmentSettings())).toEqual({
      selection: { mode: 'local' },
      source: 'global',
      type: 'local',
      runtimeIntegrated: false,
    });
  });
  it('inherits global SSH but permits an explicit project local override', () => {
    const config = parseEnvironmentSettings({
      default: { mode: 'profile', profileId: 'remote' },
      profiles: [docker, ssh],
    });
    expect(resolveEnvironment(config, null)).toMatchObject({
      source: 'global',
      type: 'ssh',
      profile: ssh,
    });
    expect(resolveEnvironment(config, { mode: 'local' })).toMatchObject({
      source: 'project',
      type: 'local',
    });
  });
  it('resolves project Docker independently of the global default', () => {
    const config = parseEnvironmentSettings({ default: { mode: 'local' }, profiles: [docker] });
    expect(resolveEnvironment(config, { mode: 'profile', profileId: 'docker' })).toMatchObject({
      type: 'docker',
      source: 'project',
      profile: docker,
    });
  });
  it('does not downgrade a deleted project profile to local', () => {
    expect(
      resolveEnvironment(defaultEnvironmentSettings(), { mode: 'profile', profileId: 'deleted' })
    ).toMatchObject({
      type: 'missing-profile',
      source: 'project',
      selection: { mode: 'profile', profileId: 'deleted' },
    });
  });
  it('returns detached configuration and resolved snapshots', () => {
    const input = { default: { mode: 'profile', profileId: 'docker' }, profiles: [{ ...docker }] };
    const parsed = parseEnvironmentSettings(input);
    const resolved = resolveEnvironment(parsed);
    input.profiles[0].name = 'Changed';
    parsed.profiles[0].name = 'Also changed';
    expect(resolved.profile?.name).toBe('Project Docker');
  });
  it('stores SSH references but no SSH secret material', () => {
    expect(parseEnvironmentProfile({ ...ssh, credentialId: 'key-reference' })).toMatchObject({
      credentialId: 'key-reference',
    });
  });
  it('supports IPv6 SSH hosts without interpreting them as CLI options', () => {
    expect(parseEnvironmentProfile({ ...ssh, host: '::1' })).toMatchObject({ host: '::1' });
  });
  it.each([
    null,
    [],
    {},
    { mode: 'docker' },
    { mode: 'profile' },
    { mode: 'profile', profileId: '--host=evil' },
    { mode: 'local', profileId: 'x' },
    { mode: 'auto', apiKey: 'secret' },
  ])('rejects invalid selection %j', (selection) => {
    expect(() => parseEnvironmentSelection(selection)).toThrow();
  });
  it.each([
    { ...docker, apiKey: 'secret' },
    { ...docker, context: '--host=tcp://evil' },
    { ...docker, context: 'x\nsecret' },
    { ...docker, host: 'unexpected' },
    { ...ssh, context: 'unexpected' },
    { ...ssh, privateKey: 'secret' },
    { ...ssh, password: 'secret' },
    { ...ssh, host: '-oProxyCommand=evil' },
    { ...ssh, username: 'x; id' },
    { ...ssh, port: 0 },
    { ...ssh, port: 65536 },
    { ...ssh, port: 22.5 },
    { ...ssh, basePath: 'relative/path' },
    { ...ssh, basePath: '/' },
    { ...ssh, basePath: '/srv/../data' },
    { ...ssh, name: '' },
  ])('rejects invalid profile %j', (profile) => {
    expect(() => parseEnvironmentProfile(profile)).toThrow();
  });
  it('rejects unknown defaults, duplicate IDs and oversized catalogs', () => {
    expect(() =>
      parseEnvironmentSettings({ default: { mode: 'profile', profileId: 'missing' }, profiles: [] })
    ).toThrow();
    expect(() =>
      parseEnvironmentSettings({ default: { mode: 'local' }, profiles: [docker, docker] })
    ).toThrow();
    expect(() =>
      parseEnvironmentSettings({
        default: { mode: 'local' },
        profiles: Array.from({ length: 101 }, (_, id) => ({ ...docker, id: `docker-${id}` })),
      })
    ).toThrow();
  });
});
