import { translate } from '@/lib/i18n';
import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { getElectronAPI } from '@/lib/electron';
import { createLogger } from '@automaker/utils/logger';

const logger = createLogger('TokenSave');

interface UseTokenSaveOptions {
  provider: string; // e.g., "anthropic_oauth_token", "anthropic", "openai"
  onSuccess?: () => void;
}

export function useTokenSave({ provider, onSuccess }: UseTokenSaveOptions) {
  const [isSaving, setIsSaving] = useState(false);

  const saveToken = useCallback(
    async (tokenValue: string) => {
      if (!tokenValue.trim()) {
        toast.error(translate('Please enter a valid token'));
        return false;
      }

      setIsSaving(true);
      try {
        const api = getElectronAPI();
        const setupApi = api.setup;

        if (setupApi?.storeApiKey) {
          const result = await setupApi.storeApiKey(provider, tokenValue);
          logger.info(`Store result for ${provider}:`, result);

          if (result.success) {
            const tokenType = provider.includes('oauth') ? 'subscription token' : 'API key';
            toast.success(translate('{value1} saved successfully', { value1: tokenType }));
            onSuccess?.();
            return true;
          } else {
            toast.error(translate('Failed to save token'), { description: result.error });
            return false;
          }
        } else {
          toast.error(translate('Credential API is not available'));
          return false;
        }
      } catch (error) {
        logger.error(`Failed to save ${provider}:`, error);
        toast.error(translate('Failed to save token'));
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [provider, onSuccess]
  );

  return { isSaving, saveToken };
}
