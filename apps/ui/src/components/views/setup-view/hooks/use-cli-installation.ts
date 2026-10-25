import { translate } from '@/lib/i18n';
import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { createLogger } from '@automaker/utils/logger';
import type { ModelProvider } from '@automaker/types';
import type { CliStatus } from '@/store/setup-store';
import type { ProviderConnectionTarget } from '@automaker/contracts';

const logger = createLogger('CliInstallation');

interface InstallApiResult {
  success: boolean;
  message?: string;
  error?: string;
  requiresManualInstall?: boolean;
  installationPerformed?: boolean;
  installCommand?: string;
  target?: ProviderConnectionTarget;
}

interface InstallProgressEvent {
  cli?: string;
  data?: string;
  type?: string;
}
interface UseCliInstallationOptions {
  cliType: ModelProvider;
  installApi: (signal?: AbortSignal) => Promise<InstallApiResult>;
  onProgressEvent?: (
    callback: (progress: InstallProgressEvent) => void
  ) => (() => void) | undefined;
  onSuccess?: () => void | Promise<void>;
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
  const [installProgress, setInstallProgress] = useState<{ output: string[] }>({ output: [] });
  const running = useRef(false);
  const mounted = useRef(true);
  const subscription = useRef<(() => void) | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  const cleanup = useCallback(() => {
    const unsubscribe = subscription.current;
    subscription.current = undefined;
    try {
      unsubscribe?.();
    } catch {
      logger.warn('Failed to release CLI progress subscription');
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      cleanup();
    };
  }, [cleanup]);

  const install = useCallback(async () => {
    if (running.current || !mounted.current) return;
    running.current = true;
    const operation = new AbortController();
    controller.current = operation;
    setIsInstalling(true);
    setInstallProgress({ output: [] });
    try {
      subscription.current = onProgressEvent?.((progress) => {
        if (
          mounted.current &&
          running.current &&
          controller.current === operation &&
          progress.cli === cliType
        ) {
          setInstallProgress((previous) => ({
            output: [
              ...previous.output,
              (progress.data || progress.type || '').slice(0, 8192),
            ].slice(-1000),
          }));
        }
      });
      const result = await installApi(operation.signal);
      if (!mounted.current) return;
      if (result.requiresManualInstall || result.installationPerformed === false) {
        const output = [
          translate('No installer was run.'),
          ...(result.target
            ? [
                translate('Backend application: {value1}', {
                  value1: result.target.workingDirectory,
                }),
              ]
            : []),
          ...(result.installCommand ? [result.installCommand] : []),
          result.message ||
            result.error ||
            translate('Run the install command shown above on the backend host.'),
        ];
        setInstallProgress({ output });
        toast.info(translate('Manual CLI installation required'), {
          description: translate('Run the command on the backend host, then refresh CLI status.'),
        });
        return;
      }
      if (!result.success) {
        toast.error(translate('Installation failed'), { description: result.error });
        return;
      }
      // A successful HTTP response or a completion event cannot prove installation.
      // Refresh status once; only an explicit performed result AND detection qualify.
      await onSuccess?.();
      if (!mounted.current) return;
      if (result.installationPerformed === true && getStoreState?.()?.installed === true) {
        toast.success(
          translate('{value1} CLI installed and detected successfully', { value1: cliType })
        );
      } else {
        toast.info(translate('CLI installation could not be confirmed'), {
          description: translate('Refresh CLI status after completing the installation.'),
        });
      }
    } catch (error) {
      if (mounted.current) {
        logger.error(`Failed to install ${cliType}:`, error);
        toast.error(translate('Installation failed'));
      }
    } finally {
      cleanup();
      controller.current = undefined;
      running.current = false;
      if (mounted.current) setIsInstalling(false);
    }
  }, [cliType, installApi, onProgressEvent, onSuccess, getStoreState, cleanup]);
  return { isInstalling, installProgress, install };
}
