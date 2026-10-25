import { canAttemptCliProvider } from '@/lib/provider-readiness';
import { translate, useUiLocale } from '@/lib/i18n';
import { useState, useEffect, useCallback } from 'react';
import { createLogger } from '@automaker/utils/logger';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useSetupStore } from '@/store/setup-store';
import { getElectronAPI } from '@/lib/electron';
import {
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  ExternalLink,
  Copy,
  RefreshCw,
  AlertTriangle,
  XCircle,
  Terminal,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { StatusBadge } from '../components';

const logger = createLogger('OpencodeSetupStep');

interface OpencodeSetupStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

interface OpencodeCliStatus {
  installed: boolean;
  version?: string | null;
  path?: string | null;
  auth?: {
    authenticated: boolean;
    authenticationChecked?: boolean;
    method: string;
  };
  installCommand?: string;
  loginCommand?: string;
}

export function OpencodeSetupStep({ onNext, onBack, onSkip }: OpencodeSetupStepProps) {
  useUiLocale();
  const { opencodeCliStatus, setOpencodeCliStatus } = useSetupStore();
  const [isChecking, setIsChecking] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const checkStatus = useCallback(async () => {
    setIsChecking(true);
    try {
      const api = getElectronAPI();
      if (!api.setup?.getOpencodeStatus) {
        return;
      }
      const result = await api.setup.getOpencodeStatus();
      if (result.success) {
        // Derive install command from platform-specific options or use npm fallback
        const installCommand =
          result.installCommands?.npm ||
          result.installCommands?.macos ||
          result.installCommands?.linux;
        const status: OpencodeCliStatus = {
          installed: result.installed ?? false,
          version: result.version ?? null,
          path: result.path ?? null,
          auth: result.auth,
          installCommand,
          loginCommand: 'opencode auth login',
        };
        setOpencodeCliStatus(status);

        if (result.auth?.authenticated) {
          toast.success(translate('OpenCode CLI is ready!'));
        }
      }
    } catch (error) {
      logger.error('Failed to check OpenCode status:', error);
    } finally {
      setIsChecking(false);
    }
  }, [setOpencodeCliStatus]);

  useEffect(() => {
    checkStatus();
    // Cleanup polling on unmount
  }, [checkStatus]);

  const copyCommand = (command: string) => {
    navigator.clipboard.writeText(command);
    toast.success(translate('Command copied to clipboard'));
  };

  const handleLogin = async () => {
    setIsLoggingIn(true);

    try {
      // Copy login command to clipboard and show instructions
      const loginCommand = opencodeCliStatus?.loginCommand || 'opencode auth login';
      await navigator.clipboard.writeText(loginCommand);
      toast.info(translate('Login command copied! Paste in terminal to authenticate.'));

      // Poll for auth status
      setIsLoggingIn(false);
    } catch (error) {
      logger.error('Login failed:', error);
      toast.error(translate('Failed to start login process'));
      setIsLoggingIn(false);
    }
  };

  const isReady = canAttemptCliProvider(opencodeCliStatus, opencodeCliStatus?.auth);

  const getStatusBadge = () => {
    if (isChecking) {
      return <StatusBadge status="checking" label={translate('Checking...')} />;
    }
    if (opencodeCliStatus?.installed && opencodeCliStatus.auth?.authenticationChecked === false)
      return <StatusBadge status="unverified" label={translate('Authentication not checked')} />;
    if (opencodeCliStatus?.auth?.authenticated) {
      return <StatusBadge status="authenticated" label={translate('Ready')} />;
    }
    if (opencodeCliStatus?.installed) {
      return <StatusBadge status="unverified" label={translate('Not Logged In')} />;
    }
    return <StatusBadge status="not_installed" label={translate('Not Installed')} />;
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-xl bg-green-500/10 flex items-center justify-center mx-auto mb-4">
          <Terminal className="w-8 h-8 text-green-500" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">
          {translate('OpenCode CLI Setup')}
        </h2>
        <p className="text-muted-foreground">
          {translate('Optional - Use OpenCode as an AI provider')}
        </p>
      </div>

      {/* Info Banner */}
      <Card className="bg-green-500/10 border-green-500/20">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-foreground">{translate('This step is optional')}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {translate(
                  'Configure OpenCode CLI for access to free tier models and connected providers. You can skip this and use other providers, or configure it later in Settings.'
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status Card */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Terminal className="w-5 h-5" />
              {translate('OpenCode CLI Status')}
              <Badge variant="outline" className="ml-2">
                {translate('Optional')}
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              {getStatusBadge()}
              <Button variant="ghost" size="sm" onClick={checkStatus} disabled={isChecking}>
                {isChecking ? <Spinner size="sm" /> : <RefreshCw className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          <CardDescription>
            {opencodeCliStatus?.installed
              ? opencodeCliStatus.auth?.authenticationChecked === false
                ? translate('Authentication not checked')
                : opencodeCliStatus.auth?.authenticated
                  ? translate('Authenticated via {value1}{value2}', {
                      value1:
                        opencodeCliStatus.auth.method === 'api_key' ? 'API Key' : 'Browser Login',
                      value2: opencodeCliStatus.version ? ` (v${opencodeCliStatus.version})` : '',
                    })
                  : translate('Installed but not authenticated')
              : translate('Not installed on your system')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Success State */}
          {isReady && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <div>
                <p className="font-medium text-foreground">{translate('OpenCode CLI is ready!')}</p>
                <p className="text-sm text-muted-foreground">
                  {translate('You can use OpenCode models for AI tasks.')}
                  {opencodeCliStatus?.version && (
                    <span className="ml-1">
                      {translate('Version: ')}
                      {opencodeCliStatus.version}
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Not Installed */}
          {!opencodeCliStatus?.installed && !isChecking && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/30 border border-border">
                <XCircle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-foreground">
                    {translate('OpenCode CLI not found')}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {translate(
                      'Install the OpenCode CLI to use free tier models and connected providers.'
                    )}
                  </p>
                </div>
              </div>

              <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
                <p className="font-medium text-foreground text-sm">
                  {translate('Install OpenCode CLI:')}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono text-foreground overflow-x-auto">
                    {opencodeCliStatus?.installCommand || 'npm install -g opencode'}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      copyCommand(opencodeCliStatus?.installCommand || 'npm install -g opencode')
                    }
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <a
                  href="https://github.com/opencode-ai/opencode"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-sm text-brand-500 hover:underline mt-2"
                >
                  {translate('View installation docs')}
                  <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </div>
            </div>
          )}

          {/* Installed but not authenticated */}
          {opencodeCliStatus?.installed &&
            !opencodeCliStatus?.auth?.authenticated &&
            !isChecking && (
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-foreground">
                      {translate('OpenCode CLI not authenticated')}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {translate('Run the login command to authenticate with OpenCode.')}
                    </p>
                  </div>
                </div>

                <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
                  <p className="text-sm text-muted-foreground">
                    {translate(
                      'Run the login command in your terminal, then complete authentication in your browser:'
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono text-foreground">
                      {opencodeCliStatus?.loginCommand || 'opencode auth login'}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        copyCommand(opencodeCliStatus?.loginCommand || 'opencode auth login')
                      }
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <Button
                    onClick={handleLogin}
                    disabled={isLoggingIn}
                    className="w-full bg-brand-500 hover:bg-brand-600 text-white"
                  >
                    {isLoggingIn ? (
                      <>
                        <Spinner size="sm" variant="foreground" className="mr-2" />
                        {translate('Waiting for login...')}
                      </>
                    ) : (
                      translate('Copy Command & Wait for Login')
                    )}
                  </Button>
                </div>
              </div>
            )}

          {/* Loading State */}
          {isChecking && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <Spinner size="md" />
              <div>
                <p className="font-medium text-foreground">
                  {translate('Checking OpenCode CLI status...')}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack} className="text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-2" />
          {translate('Back')}
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onSkip} className="text-muted-foreground">
            {isReady ? translate('Skip') : translate('Skip for now')}
          </Button>
          <Button
            onClick={onNext}
            className="bg-brand-500 hover:bg-brand-600 text-white"
            data-testid="opencode-next-button"
          >
            {isReady ? translate('Continue') : translate('Continue without OpenCode')}
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>

      {/* Info note */}
      <p className="text-xs text-muted-foreground text-center">
        {translate('You can always configure OpenCode later in Settings')}
      </p>
    </div>
  );
}
