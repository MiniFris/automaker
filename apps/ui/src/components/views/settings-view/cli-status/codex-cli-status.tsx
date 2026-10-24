import { translate, useUiLocale } from '@/lib/i18n';
import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { SkeletonPulse } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { CheckCircle2, AlertCircle, RefreshCw, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CliStatus } from '../shared/types';
import type { CodexAuthStatus } from '@/store/setup-store';
import { OpenAIIcon } from '@/components/ui/provider-icon';
import { getElectronAPI } from '@/lib/electron';
import { toast } from 'sonner';
import { ProviderDisconnectButton } from './provider-disconnect-button';

interface CliStatusProps {
  status: CliStatus | null;
  authStatus?: CodexAuthStatus | null;
  isChecking: boolean;
  onRefresh: () => void;
}

function getAuthMethodLabel(method: string): string {
  switch (method) {
    case 'api_key':
      return translate('API Key');
    case 'api_key_env':
      return translate('API Key (Environment)');
    case 'cli_authenticated':
    case 'oauth':
      return translate('CLI Authentication');
    default:
      return method || translate('Unknown');
  }
}

function CodexCliStatusSkeleton() {
  useUiLocale();
  return (
    <div
      className={cn(
        'rounded-2xl overflow-hidden',
        'border border-border/50',
        'bg-gradient-to-br from-card/90 via-card/70 to-card/80 backdrop-blur-xl',
        'shadow-sm shadow-black/5'
      )}
    >
      <div className="p-6 border-b border-border/50 bg-gradient-to-r from-transparent via-accent/5 to-transparent">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <SkeletonPulse className="w-9 h-9 rounded-xl" />
            <SkeletonPulse className="h-6 w-36" />
          </div>
          <SkeletonPulse className="w-9 h-9 rounded-lg" />
        </div>
        <div className="ml-12">
          <SkeletonPulse className="h-4 w-80" />
        </div>
      </div>
      <div className="p-6 space-y-4">
        {/* Installation status skeleton */}
        <div className="flex items-center gap-3 p-4 rounded-xl border border-border/30 bg-muted/10">
          <SkeletonPulse className="w-10 h-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <SkeletonPulse className="h-4 w-40" />
            <SkeletonPulse className="h-3 w-32" />
            <SkeletonPulse className="h-3 w-48" />
          </div>
        </div>
        {/* Auth status skeleton */}
        <div className="flex items-center gap-3 p-4 rounded-xl border border-border/30 bg-muted/10">
          <SkeletonPulse className="w-10 h-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <SkeletonPulse className="h-4 w-28" />
            <SkeletonPulse className="h-3 w-36" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function CodexCliStatus({ status, authStatus, isChecking, onRefresh }: CliStatusProps) {
  useUiLocale();
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const handleSignIn = useCallback(async () => {
    setIsAuthenticating(true);
    try {
      const api = getElectronAPI();
      // Check if authCodex method exists on the API
      const authCodex = (api.setup as Record<string, unknown> | undefined)?.authCodex as
        | (() => Promise<{ success: boolean; error?: string }>)
        | undefined;
      if (!authCodex) {
        toast.error(translate('Authentication Failed'), {
          description: translate('Codex authentication is not available'),
        });
        return;
      }
      const result = await authCodex();

      if (result.success) {
        toast.success(translate('Signed In'), {
          description: translate('Successfully authenticated Codex CLI'),
        });
        onRefresh();
      } else if (result.error) {
        toast.error(translate('Authentication Failed'), {
          description: result.error,
        });
      }
    } catch (error) {
      toast.error(translate('Authentication Failed'), {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsAuthenticating(false);
    }
  }, [onRefresh]);

  if (!status) return <CodexCliStatusSkeleton />;

  return (
    <div
      className={cn(
        'rounded-2xl overflow-hidden',
        'border border-border/50',
        'bg-gradient-to-br from-card/90 via-card/70 to-card/80 backdrop-blur-xl',
        'shadow-sm shadow-black/5'
      )}
    >
      <div className="p-6 border-b border-border/50 bg-gradient-to-r from-transparent via-accent/5 to-transparent">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-600/10 flex items-center justify-center border border-brand-500/20">
              <OpenAIIcon className="w-5 h-5 text-brand-500" />
            </div>
            <h2 className="text-lg font-semibold text-foreground tracking-tight">
              {translate('Codex CLI')}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            disabled={isChecking}
            data-testid="refresh-codex-cli"
            title={translate('Refresh Codex CLI detection')}
            className={cn(
              'h-9 w-9 rounded-lg',
              'hover:bg-accent/50 hover:scale-105',
              'transition-all duration-200'
            )}
          >
            {isChecking ? <Spinner size="sm" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground/80 ml-12">
          {translate('Codex CLI powers OpenAI models for coding and automation workflows.')}
        </p>
      </div>
      <div className="p-6 space-y-4">
        {status.success && status.status === 'installed' ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center border border-emerald-500/20 shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-400">
                  {translate('Codex CLI Installed')}
                </p>
                <div className="text-xs text-emerald-400/70 mt-1.5 space-y-0.5">
                  {status.method && (
                    <p>
                      {translate('Method: ')}
                      <span className="font-mono">{status.method}</span>
                    </p>
                  )}
                  {status.version && (
                    <p>
                      {translate('Version: ')}
                      <span className="font-mono">{status.version}</span>
                    </p>
                  )}
                  {status.path && (
                    <p className="truncate" title={status.path}>
                      {translate('Path: ')}
                      <span className="font-mono text-[10px]">{status.path}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
            {/* Authentication Status */}
            {authStatus?.authenticated ? (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center border border-emerald-500/20 shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-emerald-400">
                    {translate('Authenticated')}
                  </p>
                  <div className="text-xs text-emerald-400/70 mt-1.5">
                    <p>
                      {translate('Method:')}{' '}
                      <span className="font-mono">{getAuthMethodLabel(authStatus.method)}</span>
                    </p>
                  </div>
                  <ProviderDisconnectButton provider="codex" onRefresh={onRefresh} />
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center border border-amber-500/20 shrink-0 mt-0.5">
                  <XCircle className="w-5 h-5 text-amber-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-400">
                    {translate('Not Authenticated')}
                  </p>
                  <p className="text-xs text-amber-400/70 mt-1">
                    {translate('Click Sign In below to get authentication instructions.')}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSignIn}
                    disabled={isAuthenticating}
                    className="mt-3 h-8 text-xs"
                  >
                    {isAuthenticating ? translate('Requesting...') : translate('Sign In')}
                  </Button>
                </div>
              </div>
            )}

            {status.recommendation && (
              <p className="text-xs text-muted-foreground/70 ml-1">{status.recommendation}</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center border border-amber-500/20 shrink-0 mt-0.5">
                <AlertCircle className="w-5 h-5 text-amber-500" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-400">
                  {translate('Codex CLI Not Detected')}
                </p>
                <p className="text-xs text-amber-400/70 mt-1">
                  {status.recommendation ||
                    translate('Install Codex CLI to unlock OpenAI models with tool support.')}
                </p>
              </div>
            </div>
            {status.installCommands && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-foreground/80">
                  {translate('Installation Commands:')}
                </p>
                <div className="space-y-2">
                  {status.installCommands.npm && (
                    <div className="p-3 rounded-xl bg-accent/30 border border-border/50">
                      <p className="text-[10px] text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">
                        {translate('npm')}
                      </p>
                      <code className="text-xs text-foreground/80 font-mono break-all">
                        {status.installCommands.npm}
                      </code>
                    </div>
                  )}
                  {status.installCommands.macos && (
                    <div className="p-3 rounded-xl bg-accent/30 border border-border/50">
                      <p className="text-[10px] text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">
                        {translate('macOS/Linux')}
                      </p>
                      <code className="text-xs text-foreground/80 font-mono break-all">
                        {status.installCommands.macos}
                      </code>
                    </div>
                  )}
                  {status.installCommands.windows && (
                    <div className="p-3 rounded-xl bg-accent/30 border border-border/50">
                      <p className="text-[10px] text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">
                        {translate('Windows (PowerShell)')}
                      </p>
                      <code className="text-xs text-foreground/80 font-mono break-all">
                        {status.installCommands.windows}
                      </code>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
