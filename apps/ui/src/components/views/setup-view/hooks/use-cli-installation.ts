import { translate } from '@/lib/i18n';
import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { createLogger } from '@automaker/utils/logger';
import type { ModelProvider } from '@automaker/types';
import type { CliStatus } from '@/store/setup-store';

const logger = createLogger('CliInstallation');

interface InstallApiResult {
  success: boolean;
  message?: string;
  error?: string;
}

interface InstallProgressEvent {
  cli?: string;
  data?: string;
  type?: string;
}

interface UseCliInstallationOptions {
  cliType: ModelProvider;
  installApi: () => Promise<InstallApiResult>;
  onProgressEvent?: (
    callback: (progress: InstallProgressEvent) => void
  ) => (() => void) | undefined;
  onSuccess?: () => void;
  getStoreState?: () => CliStatus | null;
}

export function useCliInstallation({
  cliType,
  installApi,
  onProgressEvent,
  onSuccess,
  getStoreState,
}: UseCliInstallationOptions) {
  const [isInstalling, setIsInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<{ output: string[] }>({
    output: [],
  });

  const install = useCallback(async () => {
    setIsInstalling(true);
    setInstallProgress({ output: [] });

    try {
      let unsubscribe: (() => void) | undefined;

      if (onProgressEvent) {
        unsubscribe = onProgressEvent((progress: InstallProgressEvent) => {
          if (progress.cli === cliType) {
            setInstallProgress((prev) => ({
              output: [...prev.output, progress.data || progress.type || ''],
            }));
          }
        });
      }

      const result = await installApi();
      unsubscribe?.();

      if (result.success) {
        if (cliType === 'claude' && onSuccess && getStoreState) {
          // Claude-specific: retry logic to detect installation
          let retries = 5;
          let detected = false;

          await new Promise((resolve) => setTimeout(resolve, 1500));

          for (let i = 0; i < retries; i++) {
            await onSuccess();
            await new Promise((resolve) => setTimeout(resolve, 300));

            const currentStatus = getStoreState();
            if (currentStatus?.installed) {
              detected = true;
              toast.success(
                translate('{value1} CLI installed and detected successfully', { value1: cliType })
              );
              break;
            }

            if (i < retries - 1) {
              await new Promise((resolve) => setTimeout(resolve, 2000 + i * 500));
            }
          }

          if (!detected) {
            toast.success(translate('{value1} CLI installation completed', { value1: cliType }), {
              description: translate(
                'The CLI was installed but may need a terminal restart to be detected. You can continue with authentication if you have a token.'
              ),
              duration: 7000,
            });
          }
        } else {
          toast.success(translate('{value1} CLI installed successfully', { value1: cliType }));
          onSuccess?.();
        }
      } else {
        toast.error(translate('Installation failed'), { description: result.error });
      }
    } catch (error) {
      logger.error(`Failed to install ${cliType}:`, error);
      toast.error(translate('Installation failed'));
    } finally {
      setIsInstalling(false);
    }
  }, [cliType, installApi, onProgressEvent, onSuccess, getStoreState]);

  return { isInstalling, installProgress, install };
}
