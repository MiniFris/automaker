import { translate, useUiLocale } from '@/lib/i18n';
import { useState, useEffect, useCallback } from 'react';
import { createLogger } from '@automaker/utils/logger';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  Github,
  XCircle,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { StatusBadge } from '../components';

const logger = createLogger('GitHubSetupStep');

interface GitHubSetupStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function GitHubSetupStep({ onNext, onBack, onSkip }: GitHubSetupStepProps) {
  useUiLocale();
  const { ghCliStatus, setGhCliStatus } = useSetupStore();
  const [isChecking, setIsChecking] = useState(false);

  const checkStatus = useCallback(async () => {
    setIsChecking(true);
    try {
      const api = getElectronAPI();
      if (!api.setup?.getGhStatus) {
        return;
      }
      const result = await api.setup.getGhStatus();
      if (result.success) {
        setGhCliStatus({
          installed: result.installed,
          authenticated: result.authenticated,
          version: result.version,
          path: result.path,
          user: result.user,
        });
      }
    } catch (error) {
      logger.error('Failed to check gh status:', error);
    } finally {
      setIsChecking(false);
    }
  }, [setGhCliStatus]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const copyCommand = (command: string) => {
    navigator.clipboard.writeText(command);
    toast.success(translate('Command copied to clipboard'));
  };

  const isReady = ghCliStatus?.installed && ghCliStatus?.authenticated;

  const getStatusBadge = () => {
    if (isChecking) {
      return <StatusBadge status="checking" label={translate('Checking...')} />;
    }
    if (ghCliStatus?.authenticated) {
      return <StatusBadge status="authenticated" label={translate('Ready')} />;
    }
    if (ghCliStatus?.installed) {
      return <StatusBadge status="unverified" label={translate('Not Logged In')} />;
    }
    return <StatusBadge status="not_installed" label={translate('Not Installed')} />;
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-xl bg-zinc-800 flex items-center justify-center mx-auto mb-4">
          <Github className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">{translate('GitHub CLI Setup')}</h2>
        <p className="text-muted-foreground">
          {translate('Optional - Used for creating pull requests')}
        </p>
      </div>

      {/* Info Banner */}
      <Card className="bg-amber-500/10 border-amber-500/20">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-foreground">{translate('This step is optional')}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {translate(
                  'The GitHub CLI allows you to create pull requests directly from the app. Without it, you can still create PRs manually in your browser.'
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
              <Github className="w-5 h-5" />
              {translate('GitHub CLI Status')}
            </CardTitle>
            <div className="flex items-center gap-2">
              {getStatusBadge()}
              <Button variant="ghost" size="sm" onClick={checkStatus} disabled={isChecking}>
                {isChecking ? <Spinner size="sm" /> : <RefreshCw className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          <CardDescription>
            {ghCliStatus?.installed
              ? ghCliStatus.authenticated
                ? translate('Logged in{value1}', {
                    value1: ghCliStatus.user ? ` as ${ghCliStatus.user}` : '',
                  })
                : translate('Installed but not logged in')
              : translate('Not installed on your system')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Success State */}
          {isReady && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <div>
                <p className="font-medium text-foreground">{translate('GitHub CLI is ready!')}</p>
                <p className="text-sm text-muted-foreground">
                  {translate('You can create pull requests directly from the app.')}
                  {ghCliStatus?.version && (
                    <span className="ml-1">
                      {translate('Version: ')}
                      {ghCliStatus.version}
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Not Installed */}
          {!ghCliStatus?.installed && !isChecking && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/30 border border-border">
                <XCircle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-foreground">{translate('GitHub CLI not found')}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {translate('Install the GitHub CLI to enable PR creation from the app.')}
                  </p>
                </div>
              </div>

              <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
                <p className="font-medium text-foreground text-sm">
                  {translate('Installation Commands:')}
                </p>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{translate('macOS (Homebrew)')}</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono text-foreground">
                      brew install gh
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyCommand('brew install gh')}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{translate('Windows (winget)')}</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono text-foreground">
                      winget install GitHub.cli
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyCommand('winget install GitHub.cli')}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{translate('Linux (apt)')}</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono text-foreground overflow-x-auto">
                      sudo apt install gh
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyCommand('sudo apt install gh')}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <a
                  href="https://cli.github.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-sm text-brand-500 hover:underline mt-2"
                >
                  {translate('View all installation options')}
                  <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </div>
            </div>
          )}

          {/* Installed but not authenticated */}
          {ghCliStatus?.installed && !ghCliStatus?.authenticated && !isChecking && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-foreground">
                    {translate('GitHub CLI not logged in')}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {translate('Run the login command to authenticate with GitHub.')}
                  </p>
                </div>
              </div>

              <div className="space-y-2 p-4 rounded-lg bg-muted/30 border border-border">
                <p className="text-sm text-muted-foreground">
                  {translate('Run this command in your terminal:')}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono text-foreground">
                    gh auth login
                  </code>
                  <Button variant="ghost" size="icon" onClick={() => copyCommand('gh auth login')}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Loading State */}
          {isChecking && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <Spinner size="md" />
              <div>
                <p className="font-medium text-foreground">
                  {translate('Checking GitHub CLI status...')}
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
            data-testid="github-next-button"
          >
            {isReady ? translate('Continue') : translate('Continue without GitHub CLI')}
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}
