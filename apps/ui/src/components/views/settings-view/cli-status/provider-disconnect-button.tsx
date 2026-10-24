import { useRef, useState } from 'react';
import type { CliConnectionProvider, ProviderConnectionTarget } from '@automaker/contracts';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { getHttpApiClient } from '@/lib/http-api-client';
import { translate, useUiLocale } from '@/lib/i18n';

export function ProviderDisconnectButton({
  provider,
  onRefresh,
}: {
  provider: CliConnectionProvider;
  onRefresh: () => void;
}) {
  useUiLocale();
  const [target, setTarget] = useState<ProviderConnectionTarget>();
  const [pending, setPending] = useState<'inspect' | 'disconnect'>();
  const busy = useRef(false);
  const report = (error: unknown) =>
    toast.error(translate('Disconnect failed'), {
      description: error instanceof Error ? error.message : translate('Unknown error'),
    });
  const inspect = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending('inspect');
    try {
      const result = await getHttpApiClient().setup.getProviderConnectionTarget(provider);
      setTarget(result.target);
    } catch (error) {
      report(error);
    } finally {
      busy.current = false;
      setPending(undefined);
    }
  };
  const disconnect = async () => {
    if (!target || busy.current || target.provider !== provider) return;
    busy.current = true;
    setPending('disconnect');
    try {
      await getHttpApiClient().setup.disconnectProvider(provider, { confirmed: true, target });
      toast.success(translate('Disconnected from Automaker'));
      onRefresh();
    } catch (error) {
      report(error);
    } finally {
      busy.current = false;
      setPending(undefined);
    }
  };
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void inspect()}
        disabled={!!pending}
        className="mt-3 h-8 text-xs"
      >
        {pending === 'inspect'
          ? translate('Inspecting target...')
          : pending === 'disconnect'
            ? translate('Disconnecting...')
            : translate('Disconnect from Automaker')}
      </Button>
      <ConfirmDialog
        open={!!target && target.provider === provider}
        onOpenChange={(open) => {
          if (!open) setTarget(undefined);
        }}
        onConfirm={() => void disconnect()}
        title={translate('Disconnect provider?')}
        description={translate(
          'This disconnects the provider from this Automaker application only. CLI credentials are not removed. Existing runs are not stopped.'
        )}
        confirmText={translate('Disconnect')}
        confirmVariant="destructive"
      >
        {target && (
          <div className="text-xs space-y-1 break-all" data-testid="provider-disconnect-target">
            <p>{target.provider}</p>
            <p>{target.workingDirectory}</p>
            <p>{target.instanceId}</p>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
