import { useRef, useState } from 'react';
import type { CliConnectionProvider, ProviderConnectionTarget } from '@automaker/contracts';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { getHttpApiClient } from '@/lib/http-api-client';
import { translate, useUiLocale } from '@/lib/i18n';

function ProviderConnectionButton({
  provider,
  onRefresh,
  action,
}: {
  provider: CliConnectionProvider;
  onRefresh: () => void;
  action: 'disconnect' | 'reconnect';
}) {
  useUiLocale();
  const [target, setTarget] = useState<ProviderConnectionTarget>();
  const [pending, setPending] = useState<'inspect' | 'mutate'>();
  const busy = useRef(false);
  const report = (error: unknown) =>
    toast.error(translate(action === 'disconnect' ? 'Disconnect failed' : 'Reconnect failed'), {
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
    setPending('mutate');
    try {
      const setup = getHttpApiClient().setup;
      if (action === 'disconnect') {
        await setup.disconnectProvider(provider, { confirmed: true, target });
        toast.success(translate('Disconnected from Automaker'));
      } else {
        const response = await setup.reconnectProvider(provider, { confirmed: true, target });
        if (response.requiresManualAuth) {
          toast.info(translate('Connected to Automaker; CLI login may still be required.'), {
            description: response.message,
          });
        } else toast.success(translate('Connected to Automaker'));
      }
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
          : pending === 'mutate'
            ? translate(action === 'disconnect' ? 'Disconnecting...' : 'Reconnecting...')
            : translate(
                action === 'disconnect' ? 'Disconnect from Automaker' : 'Reconnect to Automaker'
              )}
      </Button>
      <ConfirmDialog
        open={!!target && target.provider === provider}
        onOpenChange={(open) => {
          if (!open) setTarget(undefined);
        }}
        onConfirm={() => void disconnect()}
        title={translate(action === 'disconnect' ? 'Disconnect provider?' : 'Reconnect provider?')}
        description={translate(
          action === 'disconnect'
            ? 'This disconnects the provider from this Automaker application only. CLI credentials are not removed. Existing runs are not stopped.'
            : 'This reconnects the provider to this Automaker application only. It does not run CLI login or verify credentials.'
        )}
        confirmText={translate(action === 'disconnect' ? 'Disconnect' : 'Reconnect')}
        confirmVariant={action === 'disconnect' ? 'destructive' : 'default'}
      >
        {target && (
          <div className="text-xs space-y-1 break-all" data-testid={`provider-${action}-target`}>
            <p>{target.provider}</p>
            <p>{target.workingDirectory}</p>
            <p>{target.instanceId}</p>
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}

type ConnectionButtonProps = { provider: CliConnectionProvider; onRefresh: () => void };
export function ProviderDisconnectButton(props: ConnectionButtonProps) {
  return <ProviderConnectionButton {...props} action="disconnect" />;
}
export function ProviderReconnectButton(props: ConnectionButtonProps) {
  return <ProviderConnectionButton {...props} action="reconnect" />;
}
