import { translate } from '@/lib/i18n';
import { getHttpApiClient } from './http-api-client';

export async function verifyCodexWithConsent(authMethod: 'cli' | 'api_key', apiKey?: string) {
  const api = getHttpApiClient().setup;
  const { target } = await api.getCodexVerificationTarget(authMethod);
  if (
    !window.confirm(
      translate(
        'Run a Codex verification query? This may incur charges. No tools are enabled. CLI credentials may be refreshed.\nMethod: {method}\nModel: {model}\nEndpoint: {endpoint}\nBackend: {directory}\nInstance: {instance}\nCLI profile: {profile}',
        {
          method: authMethod,
          model: target.model,
          endpoint: target.endpoint,
          directory: target.workingDirectory,
          instance: target.instanceId,
          profile: target.credentialDirectory || '-',
        }
      )
    )
  )
    return undefined;
  return api.verifyCodexAuth({ confirmed: true, target, ...(apiKey !== undefined && { apiKey }) });
}
