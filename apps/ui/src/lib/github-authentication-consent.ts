import { translate } from '@/lib/i18n';
import { getHttpApiClient } from './http-api-client';

export async function verifyGithubWithConsent() {
  const api = getHttpApiClient().setup;
  const { target } = await api.getGithubAuthenticationTarget();
  if (
    !window.confirm(
      translate(
        'Check GitHub authentication? This contacts GitHub using this backend CLI. The CLI may refresh credentials.\nHost: {host}\nCLI: {cli}\nBackend: {directory}\nInstance: {instance}',
        {
          host: target.hostname,
          cli: target.cliPath || '-',
          directory: target.workingDirectory,
          instance: target.instanceId,
        }
      )
    )
  )
    return undefined;
  return api.verifyGithubAuth({ confirmed: true, target });
}
