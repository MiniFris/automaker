import { isIP } from 'node:net';
import type {
  ExecutionEnvironmentProfile,
  ExecutionEnvironmentSelection,
  ExecutionEnvironmentSettings,
  ResolvedExecutionEnvironment,
} from '@automaker/types';

export class EnvironmentConfigurationError extends Error {}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new EnvironmentConfigurationError('Invalid execution environment configuration.');
  return value as Record<string, unknown>;
}

function text(value: unknown, max = 200): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new EnvironmentConfigurationError('Invalid execution environment field.');
  return value;
}

function id(value: unknown): string {
  const result = text(value, 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(result))
    throw new EnvironmentConfigurationError('Invalid environment profile ID.');
  return result;
}

export function parseEnvironmentSelection(input: unknown): ExecutionEnvironmentSelection {
  const value = record(input, ['mode', 'profileId']);
  if (value.mode === 'profile') return { mode: 'profile', profileId: id(value.profileId) };
  if ((value.mode === 'local' || value.mode === 'auto') && !Object.hasOwn(value, 'profileId'))
    return { mode: value.mode };
  throw new EnvironmentConfigurationError('Choose local, auto, or an environment profile.');
}

export function parseEnvironmentProfile(input: unknown): ExecutionEnvironmentProfile {
  const value = record(input, [
    'id',
    'name',
    'type',
    'context',
    'host',
    'port',
    'username',
    'basePath',
    'credentialId',
  ]);
  const common = { id: id(value.id), name: text(value.name) };
  if (value.type === 'docker') {
    record(value, ['id', 'name', 'type', 'context']);
    return {
      ...common,
      type: 'docker',
      ...(value.context !== undefined && { context: id(value.context) }),
    };
  }
  if (value.type === 'ssh') {
    record(value, ['id', 'name', 'type', 'host', 'port', 'username', 'basePath', 'credentialId']);
    const host = text(value.host, 253);
    const username = text(value.username, 100);
    const basePath = text(value.basePath, 4096);
    if (
      (!isIP(host) && !/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)) ||
      !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*\$?$/.test(username) ||
      !basePath.startsWith('/') ||
      basePath === '/' ||
      basePath.split('/').includes('..') ||
      !Number.isInteger(value.port) ||
      (value.port as number) < 1 ||
      (value.port as number) > 65535
    )
      throw new EnvironmentConfigurationError(
        'Invalid SSH host, user, port or absolute POSIX base path.'
      );
    return {
      ...common,
      type: 'ssh',
      host,
      username,
      port: value.port as number,
      basePath,
      ...(value.credentialId !== undefined && { credentialId: id(value.credentialId) }),
    };
  }
  throw new EnvironmentConfigurationError('Unsupported environment profile type.');
}

export function parseEnvironmentSettings(input: unknown): ExecutionEnvironmentSettings {
  const value = record(input, ['default', 'profiles']);
  if (!Array.isArray(value.profiles) || value.profiles.length > 100)
    throw new EnvironmentConfigurationError('At most 100 environment profiles are supported.');
  const profiles = value.profiles.map(parseEnvironmentProfile);
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length)
    throw new EnvironmentConfigurationError('Environment profile IDs must be unique.');
  const selection = parseEnvironmentSelection(value.default);
  if (
    selection.mode === 'profile' &&
    !profiles.some((profile) => profile.id === selection.profileId)
  )
    throw new EnvironmentConfigurationError('Default environment profile does not exist.');
  return { default: selection, profiles };
}

export function defaultEnvironmentSettings(): ExecutionEnvironmentSettings {
  return { default: { mode: 'local' }, profiles: [] };
}

export function resolveEnvironment(
  global: ExecutionEnvironmentSettings,
  override?: ExecutionEnvironmentSelection | null
): ResolvedExecutionEnvironment {
  const selection = parseEnvironmentSelection(override ?? global.default);
  const profile =
    selection.mode === 'profile'
      ? global.profiles.find((item) => item.id === selection.profileId)
      : undefined;
  return {
    selection,
    source: override == null ? 'global' : 'project',
    type: selection.mode === 'profile' ? (profile?.type ?? 'missing-profile') : selection.mode,
    ...(profile && { profile: parseEnvironmentProfile(profile) }),
    runtimeIntegrated: false,
  };
}
