import { UnavailableDomainError } from '../../core/errors/domain-errors.js';
import type { GithubRemote } from './github-read.port.js';
export function githubUrlHost(value: string): string | undefined {
  const scp = /^(?:[^@\s]+@)([^:\s/]+):/.exec(value);
  if (scp) return scp[1].toLowerCase();
  try {
    const url = new URL(value);
    return ['https:', 'ssh:'].includes(url.protocol) ? url.host.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}
export function githubHost(remote: GithubRemote): string {
  const host = remote.hostname || (remote.remoteUrl && githubUrlHost(remote.remoteUrl));
  if (
    !host ||
    !/^[a-z0-9][a-z0-9.-]*(?::[1-9][0-9]{0,4})?$/i.test(host) ||
    host.length > 253 ||
    (host.includes(':') && Number(host.split(':')[1]) > 65535)
  )
    throw new UnavailableDomainError('GitHub repository host could not be confirmed.');
  return host.toLowerCase();
}
