import { PassiveAuthenticationNotice } from '@/components/shared/passive-authentication-notice';
import { ProviderDisconnectButton, ProviderReconnectButton } from './provider-connection-button';

export function PassiveAuthStatus({
  provider,
  hasCredentialsHint,
  hasConfigFile,
  onRefresh,
}: {
  provider: 'claude' | 'codex' | 'opencode';
  hasCredentialsHint?: boolean;
  hasConfigFile?: boolean;
  onRefresh: () => void;
}) {
  return (
    <div data-testid="passive-auth-status" className="space-y-3">
      <PassiveAuthenticationNotice
        hasCredentialsHint={hasCredentialsHint}
        hasConfigFile={hasConfigFile}
      />
      <div className="flex flex-wrap gap-2">
        <ProviderReconnectButton provider={provider} onRefresh={onRefresh} />
        <ProviderDisconnectButton provider={provider} onRefresh={onRefresh} />
      </div>
    </div>
  );
}
