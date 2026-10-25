import { translate } from '@/lib/i18n';
import { getHttpApiClient } from './http-api-client';

/** Read-only inspection followed by explicit user consent for one billable host query. */
export async function verifyClaudeWithConsent(authMethod: 'cli' | 'api_key', apiKey?: string) {
  const api = getHttpApiClient().setup;
  const { target } = await api.getClaudeVerificationTarget(authMethod);
  const approved = window.confirm(
    translate(
      'Run a Claude verification query? This may incur charges. No tools are enabled.\nMethod: {method}\nModel: {model}\nEndpoint: {endpoint}\nBackend: {directory}\nInstance: {instance}',
      {
        method: authMethod,
        model: target.model,
        endpoint: target.endpoint,
        directory: target.workingDirectory,
        instance: target.instanceId,
      }
    )
  );
  if (!approved) return undefined;
  return api.verifyClaudeAuth({ confirmed: true, target, ...(apiKey !== undefined && { apiKey }) });
}
