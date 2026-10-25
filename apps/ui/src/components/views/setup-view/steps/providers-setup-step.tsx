import { translate, useUiLocale } from '@/lib/i18n';
import { GEMINI_CLI_INSTALL_COMMAND } from '@automaker/contracts';
import { canAttemptCliProvider } from '@/lib/provider-readiness';
import { PassiveAuthenticationNotice } from '@/components/shared/passive-authentication-notice';
import { CursorSetupPanel } from '@/components/shared/cursor-setup-panel';
import { GeminiCredentialsForm } from '@/components/shared/gemini-credentials-form';
import { getHttpApiClient } from '@/lib/http-api-client';
import { verifyClaudeWithConsent } from '@/lib/claude-verification-consent';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useSetupStore } from '@/store/setup-store';
import { useAppStore } from '@/store/app-store';
import { getElectronAPI } from '@/lib/electron';
import {
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Key,
  ExternalLink,
  Copy,
  RefreshCw,
  Download,
  XCircle,
  Trash2,
  AlertTriangle,
  Terminal,
  AlertCircle,
} from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  AnthropicIcon,
  CursorIcon,
  OpenAIIcon,
  OpenCodeIcon,
  GeminiIcon,
  CopilotIcon,
} from '@/components/ui/provider-icon';
import { TerminalOutput } from '../components';
import { useCliInstallation, useTokenSave } from '../hooks';
import { DirectSettingsTab } from '@/components/views/settings-view/providers/direct-settings-tab';
import { useDirectEndpoints } from '@/hooks/queries/use-direct-endpoints';

interface ProvidersSetupStepProps {
  onNext: () => void;
  onBack: () => void;
}

type ProviderTab = 'claude' | 'cursor' | 'codex' | 'opencode' | 'gemini' | 'copilot' | 'direct';

// ============================================================================
// Claude Content
// ============================================================================
function ClaudeContent() {
  useUiLocale();
  const {
    claudeCliStatus,
    claudeAuthStatus,
    setClaudeCliStatus,
    setClaudeAuthStatus,
    setClaudeInstallProgress,
    setClaudeIsVerifying,
  } = useSetupStore();
  const { setApiKeys, apiKeys } = useAppStore();

  const [apiKey, setApiKey] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isDeletingApiKey, setIsDeletingApiKey] = useState(false);
  const verificationBusy = useRef(false);

  const installApi = useCallback(
    (signal?: AbortSignal) => getElectronAPI().setup?.installClaude(signal) || Promise.reject(),
    []
  );
  const getStoreState = useCallback(() => useSetupStore.getState().claudeCliStatus, []);

  // Billable verification is only requested by an explicit user action.
  const verifyAuth = useCallback(async () => {
    if (verificationBusy.current) return;
    verificationBusy.current = true;
    setIsVerifying(true);
    setClaudeIsVerifying(true); // Update store for parent to see
    setVerificationError(null);
    try {
      const api = getElectronAPI();
      if (!api.setup?.verifyClaudeAuth) {
        return;
      }
      const result = await verifyClaudeWithConsent('cli');
      if (!result) return;
      const hasLimitReachedError =
        result.error?.toLowerCase().includes('limit reached') ||
        result.error?.toLowerCase().includes('rate limit');

      if (result.authenticated && !hasLimitReachedError) {
        // Use getState() to avoid dependency on claudeAuthStatus
        const currentAuthStatus = useSetupStore.getState().claudeAuthStatus;
        setClaudeAuthStatus({
          authenticated: true,
          method: 'cli_authenticated',
          hasCredentialsFile: currentAuthStatus?.hasCredentialsFile || false,
        });
        toast.success(translate('Claude CLI authenticated!'));
      } else if (hasLimitReachedError) {
        setVerificationError('Rate limit reached. Please try again later.');
      } else if (result.error) {
        setVerificationError(result.error);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Verification failed';
      setVerificationError(errorMessage);
    } finally {
      verificationBusy.current = false;
      setIsVerifying(false);
      setClaudeIsVerifying(false); // Update store when done
    }
  }, [setClaudeAuthStatus, setClaudeIsVerifying]);

  // Passive status never starts a billable SDK query.
  const checkStatus = useCallback(async () => {
    setIsChecking(true);
    setVerificationError(null);
    try {
      const api = getElectronAPI();
      if (!api.setup?.getClaudeStatus) return;
      const result = await api.setup.getClaudeStatus();
      if (result.success) {
        setClaudeCliStatus({
          installed: result.installed ?? false,
          version: result.version ?? null,
          path: result.path ?? null,
          method: 'none',
        });

        if (result.installed) {
          toast.success(translate('Claude CLI installed!'));
        }
      }
    } catch {
      // Ignore errors
    } finally {
      setIsChecking(false);
    }
  }, [setClaudeCliStatus]);

  const onInstallSuccess = useCallback(() => {
    return checkStatus();
  }, [checkStatus]);

  const { isInstalling, installProgress, install } = useCliInstallation({
    cliType: 'claude',
    installApi,
    onProgressEvent: getElectronAPI().setup?.onInstallProgress,
    onSuccess: onInstallSuccess,
    getStoreState,
  });

  const { isSaving: isSavingApiKey, saveToken: saveApiKeyToken } = useTokenSave({
    provider: 'anthropic',
    onSuccess: () => {
      setClaudeAuthStatus({
        authenticated: true,
        method: 'api_key',
        hasCredentialsFile: false,
        apiKeyValid: true,
      });
      setApiKeys({ ...apiKeys, anthropic: apiKey });
      toast.success(translate('API key saved successfully!'));
    },
  });

  const deleteApiKey = useCallback(async () => {
    setIsDeletingApiKey(true);
    try {
      const api = getElectronAPI();
      if (!api.setup?.deleteApiKey) {
        toast.error(translate('Delete API not available'));
        return;
      }
      const result = await api.setup.deleteApiKey('anthropic');
      if (result.success) {
        setApiKey('');
        setApiKeys({ ...apiKeys, anthropic: '' });
        // Use getState() to avoid dependency on claudeAuthStatus
        const currentAuthStatus = useSetupStore.getState().claudeAuthStatus;
        setClaudeAuthStatus({
          authenticated: false,
          method: 'none',
          hasCredentialsFile: currentAuthStatus?.hasCredentialsFile || false,
        });
        // Reset verification guard so next check can verify again
        toast.success(translate('API key deleted successfully'));
      }
    } catch {
      toast.error(translate('Failed to delete API key'));
    } finally {
      setIsDeletingApiKey(false);
    }
  }, [apiKeys, setApiKeys, setClaudeAuthStatus]);

  useEffect(() => {
    setClaudeInstallProgress({ isInstalling, output: installProgress.output });
  }, [isInstalling, installProgress, setClaudeInstallProgress]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const copyCommand = (command: string) => {
    navigator.clipboard.writeText(command);
    toast.success(translate('Command copied to clipboard'));
  };

  const hasApiKey =
    !!apiKeys.anthropic ||
    claudeAuthStatus?.method === 'api_key' ||
    claudeAuthStatus?.method === 'api_key_env';

  const isCliAuthenticated = claudeAuthStatus?.method === 'cli_authenticated';
  const isReady = claudeCliStatus?.installed && claudeAuthStatus?.authenticated;

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <AnthropicIcon className="w-5 h-5" />
            {translate('Claude CLI Status')}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={checkStatus}
            disabled={isChecking || isVerifying}
          >
            {isChecking || isVerifying ? <Spinner size="sm" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
        <CardDescription>
          {claudeCliStatus?.installed
            ? claudeAuthStatus?.authenticationChecked === false
              ? translate('Authentication not checked')
              : claudeAuthStatus?.authenticated
                ? translate('Authenticated{value1}', {
                    value1: claudeCliStatus.version ? ` (v${claudeCliStatus.version})` : '',
                  })
                : isVerifying
                  ? translate('Verifying authentication...')
                  : translate('Installed but not authenticated')
            : translate('Not installed on your system')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Success State - CLI Ready */}
        {isReady && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <div>
                <p className="font-medium text-foreground">{translate('CLI Installed')}</p>
                <p className="text-sm text-muted-foreground">
                  {claudeCliStatus?.version &&
                    translate('Version: {value1}', { value1: claudeCliStatus.version })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <p className="font-medium text-foreground">
                {isCliAuthenticated
                  ? translate('CLI Authenticated')
                  : translate('API Key Configured')}
              </p>
            </div>
          </div>
        )}

        {/* Checking/Verifying State */}
        {(isChecking || isVerifying) && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <Spinner size="md" />
            <p className="font-medium text-foreground">
              {isChecking
                ? translate('Checking Claude CLI status...')
                : translate('Verifying authentication...')}
            </p>
          </div>
        )}

        {claudeCliStatus?.installed && !isChecking && (
          <Button disabled={isVerifying} onClick={verifyAuth}>
            {translate('Verify Claude connection')}
          </Button>
        )}

        {/* Not Installed */}
        {!claudeCliStatus?.installed && !isChecking && !isVerifying && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/30 border border-border">
              <XCircle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-foreground">{translate('Claude CLI not found')}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {translate('Install Claude CLI to use Claude Code subscription.')}
                </p>
              </div>
            </div>
            <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
              <p className="font-medium text-foreground text-sm">
                {translate('Install Claude CLI:')}
              </p>
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">
                  {translate('macOS / Linux')}
                </Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono text-foreground overflow-x-auto">
                    curl -fsSL https://claude.ai/install.sh | bash
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyCommand('curl -fsSL https://claude.ai/install.sh | bash')}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              {installProgress.output.length > 0 && (
                <TerminalOutput lines={installProgress.output} />
              )}
              <Button
                onClick={install}
                disabled={isInstalling}
                className="w-full bg-brand-500 hover:bg-brand-600 text-white"
              >
                {isInstalling ? (
                  <>
                    <Spinner size="sm" variant="foreground" className="mr-2" />
                    {translate('Loading instructions...')}
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    {translate('Show installation instructions')}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Installed but not authenticated */}
        {claudeCliStatus?.installed &&
          !claudeAuthStatus?.authenticated &&
          !isChecking &&
          !isVerifying && (
            <div className="space-y-4">
              {/* Show CLI installed toast */}
              <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <div>
                  <p className="font-medium text-foreground">{translate('CLI Installed')}</p>
                  <p className="text-sm text-muted-foreground">
                    {claudeCliStatus?.version &&
                      translate('Version: {value1}', { value1: claudeCliStatus.version })}
                  </p>
                </div>
              </div>

              {/* Error state */}
              {verificationError && (
                <div className="flex items-start gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                  <XCircle className="w-5 h-5 text-red-500 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">
                      {translate('Authentication failed')}
                    </p>
                    <p className="text-sm text-red-400 mt-1">{verificationError}</p>
                  </div>
                </div>
              )}

              {/* Not authenticated warning */}
              <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-foreground">
                    {translate('Claude CLI not authenticated')}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {translate('Run ')}
                    <code className="bg-muted px-1 rounded">claude login</code>{' '}
                    {translate(' in your terminal or provide an API key below.')}
                  </p>
                </div>
              </div>

              {/* API Key alternative */}
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="api-key" className="border-border">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3">
                      <Key className="w-5 h-5 text-muted-foreground" />
                      <span className="font-medium">
                        {translate('Use Anthropic API Key instead')}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-4 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="anthropic-key" className="text-foreground">
                        {translate('Anthropic API Key')}
                      </Label>
                      <Input
                        id="anthropic-key"
                        type="password"
                        placeholder="sk-ant-..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="bg-input border-border text-foreground"
                      />
                      <p className="text-xs text-muted-foreground">
                        {translate("Don't have an API key?")}{' '}
                        <a
                          href="https://console.anthropic.com/settings/keys"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand-500 hover:underline"
                        >
                          {translate('Get one from Anthropic Console')}
                          <ExternalLink className="w-3 h-3 inline ml-1" />
                        </a>
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => saveApiKeyToken(apiKey)}
                        disabled={isSavingApiKey || !apiKey.trim()}
                        className="flex-1 bg-brand-500 hover:bg-brand-600 text-white"
                      >
                        {isSavingApiKey ? (
                          <Spinner size="sm" variant="foreground" />
                        ) : (
                          translate('Save API Key')
                        )}
                      </Button>
                      {hasApiKey && (
                        <Button
                          onClick={deleteApiKey}
                          disabled={isDeletingApiKey}
                          variant="outline"
                          className="border-red-500/50 text-red-500 hover:bg-red-500/10"
                        >
                          {isDeletingApiKey ? (
                            <Spinner size="sm" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Cursor Content
// ============================================================================
function CursorContent() {
  return <CursorSetupPanel />;
}

// ============================================================================
// Codex Content
// ============================================================================
function CodexContent() {
  useUiLocale();
  const { codexCliStatus, codexAuthStatus, setCodexCliStatus, setCodexAuthStatus } =
    useSetupStore();
  const { setApiKeys, apiKeys } = useAppStore();
  const [isChecking, setIsChecking] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const checkStatus = useCallback(async () => {
    setIsChecking(true);
    try {
      const api = getElectronAPI();
      if (!api.setup?.getCodexStatus) return;
      const result = await api.setup.getCodexStatus();
      if (result.success) {
        setCodexCliStatus({
          installed: result.installed ?? false,
          version: result.version ?? null,
          path: result.path ?? null,
          method: 'none',
        });
        if (result.auth) {
          const validMethods = ['api_key_env', 'api_key', 'cli_authenticated', 'none'] as const;
          type CodexAuthMethod = (typeof validMethods)[number];
          const method: CodexAuthMethod = validMethods.includes(
            result.auth.method as CodexAuthMethod
          )
            ? (result.auth.method as CodexAuthMethod)
            : 'cli_authenticated';
          setCodexAuthStatus({
            authenticated: result.auth.authenticated,
            authenticationChecked: result.auth.authenticationChecked,
            method,
          });
          if (result.auth.authenticationChecked !== false && result.auth.authenticated)
            toast.success(translate('Codex CLI is ready!'));
        }
      }
    } catch {
      // Ignore
    } finally {
      setIsChecking(false);
    }
  }, [setCodexCliStatus, setCodexAuthStatus]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const copyCommand = (command: string) => {
    navigator.clipboard.writeText(command);
    toast.success(translate('Command copied to clipboard'));
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) return;
    setIsSaving(true);
    try {
      const api = getElectronAPI();
      if (!api.setup?.saveApiKey) {
        toast.error(translate('Save API not available'));
        return;
      }
      const result = await api.setup.saveApiKey('openai', apiKey);
      if (result.success) {
        setApiKeys({ ...apiKeys, openai: apiKey });
        setCodexAuthStatus({
          authenticated: false,
          authenticationChecked: false,
          method: 'api_key',
        });
        toast.success(translate('API key saved successfully!'));
      }
    } catch {
      toast.error(translate('Failed to save API key'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      await navigator.clipboard.writeText('codex login');
      toast.info(translate('Login command copied! Paste in terminal to authenticate.'));

      setIsLoggingIn(false);
    } catch {
      toast.error(translate('Failed to start login process'));
      setIsLoggingIn(false);
    }
  };

  const isReady = codexCliStatus?.installed && codexAuthStatus?.authenticated;

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <OpenAIIcon className="w-5 h-5" />
            {translate('Codex CLI Status')}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={checkStatus} disabled={isChecking}>
            {isChecking ? <Spinner size="sm" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
        <CardDescription>
          {codexCliStatus?.installed
            ? codexAuthStatus?.authenticationChecked === false
              ? translate('Authentication not checked')
              : codexAuthStatus?.authenticated
                ? translate('Authenticated{value1}', {
                    value1: codexCliStatus.version ? ` (v${codexCliStatus.version})` : '',
                  })
                : translate('Installed but not authenticated')
            : translate('Not installed on your system')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isReady && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <div>
                <p className="font-medium text-foreground">{translate('CLI Installed')}</p>
                <p className="text-sm text-muted-foreground">
                  {codexCliStatus?.version &&
                    translate('Version: {value1}', { value1: codexCliStatus.version })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <p className="font-medium text-foreground">
                {codexAuthStatus?.method === 'api_key'
                  ? translate('API Key Configured')
                  : translate('Authenticated')}
              </p>
            </div>
          </div>
        )}

        {!codexCliStatus?.installed && !isChecking && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/30 border border-border">
              <XCircle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-foreground">{translate('Codex CLI not found')}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {translate('Install the Codex CLI to use OpenAI models.')}
                </p>
              </div>
            </div>
            <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
              <p className="font-medium text-foreground text-sm">
                {translate('Install Codex CLI:')}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono text-foreground overflow-x-auto">
                  npm install -g @openai/codex
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copyCommand('npm install -g @openai/codex')}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {codexCliStatus?.installed && !codexAuthStatus?.authenticated && !isChecking && (
          <div className="space-y-4">
            {/* Show CLI installed toast */}
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <div>
                <p className="font-medium text-foreground">{translate('CLI Installed')}</p>
                <p className="text-sm text-muted-foreground">
                  {codexCliStatus?.version &&
                    translate('Version: {value1}', { value1: codexCliStatus.version })}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-foreground">
                  {translate('Codex CLI not authenticated')}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {translate('Run the login command or provide an API key below.')}
                </p>
              </div>
            </div>

            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="cli" className="border-border">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-3">
                    <Terminal className="w-5 h-5 text-muted-foreground" />
                    <span className="font-medium">{translate('Codex CLI Login')}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono text-foreground">
                      codex login
                    </code>
                    <Button variant="ghost" size="icon" onClick={() => copyCommand('codex login')}>
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
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="api-key" className="border-border">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-3">
                    <Key className="w-5 h-5 text-muted-foreground" />
                    <span className="font-medium">{translate('OpenAI API Key')}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-4 space-y-4">
                  <div className="space-y-2">
                    <Input
                      type="password"
                      placeholder="sk-..."
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="bg-input border-border text-foreground"
                    />
                    <p className="text-xs text-muted-foreground">
                      <a
                        href="https://platform.openai.com/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-500 hover:underline"
                      >
                        {translate('Get an API key from OpenAI')}
                        <ExternalLink className="w-3 h-3 inline ml-1" />
                      </a>
                    </p>
                  </div>
                  <Button
                    onClick={handleSaveApiKey}
                    disabled={isSaving || !apiKey.trim()}
                    className="w-full bg-brand-500 hover:bg-brand-600 text-white"
                  >
                    {isSaving ? (
                      <Spinner size="sm" variant="foreground" />
                    ) : (
                      translate('Save API Key')
                    )}
                  </Button>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}

        {isChecking && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <Spinner size="md" />
            <p className="font-medium text-foreground">
              {translate('Checking Codex CLI status...')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// OpenCode Content
// ============================================================================
function OpencodeContent() {
  useUiLocale();
  const { opencodeCliStatus, setOpencodeCliStatus } = useSetupStore();
  const [isChecking, setIsChecking] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const checkStatus = useCallback(async () => {
    setIsChecking(true);
    try {
      const api = getElectronAPI();
      if (!api.setup?.getOpencodeStatus) return;
      const result = await api.setup.getOpencodeStatus();
      if (result.success) {
        // Derive install command from platform-specific options or use npm fallback
        const installCommand =
          result.installCommands?.npm ||
          result.installCommands?.macos ||
          result.installCommands?.linux;
        setOpencodeCliStatus({
          installed: result.installed ?? false,
          version: result.version ?? null,
          path: result.path ?? null,
          auth: result.auth,
          installCommand,
          loginCommand: 'opencode auth login',
        });
        if (result.auth?.authenticated) {
          toast.success(translate('OpenCode CLI is ready!'));
        }
      }
    } catch {
      // Ignore
    } finally {
      setIsChecking(false);
    }
  }, [setOpencodeCliStatus]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const copyCommand = (command: string) => {
    navigator.clipboard.writeText(command);
    toast.success(translate('Command copied to clipboard'));
  };

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const loginCommand = opencodeCliStatus?.loginCommand || 'opencode auth login';
      await navigator.clipboard.writeText(loginCommand);
      toast.info(translate('Login command copied! Paste in terminal to authenticate.'));

      setIsLoggingIn(false);
    } catch {
      toast.error(translate('Failed to start login process'));
      setIsLoggingIn(false);
    }
  };

  const isReady = opencodeCliStatus?.installed && opencodeCliStatus?.auth?.authenticated;

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <OpenCodeIcon className="w-5 h-5" />
            {translate('OpenCode CLI Status')}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={checkStatus} disabled={isChecking}>
            {isChecking ? <Spinner size="sm" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
        <CardDescription>
          {opencodeCliStatus?.installed
            ? opencodeCliStatus.auth?.authenticationChecked === false
              ? translate('Authentication not checked')
              : opencodeCliStatus.auth?.authenticated
                ? translate('Authenticated{value1}', {
                    value1: opencodeCliStatus.version ? ` (v${opencodeCliStatus.version})` : '',
                  })
                : translate('Installed but not authenticated')
            : translate('Not installed on your system')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isReady && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <div>
                <p className="font-medium text-foreground">{translate('CLI Installed')}</p>
                <p className="text-sm text-muted-foreground">
                  {opencodeCliStatus?.version &&
                    translate('Version: {value1}', { value1: opencodeCliStatus.version })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <p className="font-medium text-foreground">{translate('Authenticated')}</p>
            </div>
          </div>
        )}

        {!opencodeCliStatus?.installed && !isChecking && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/30 border border-border">
              <XCircle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-foreground">{translate('OpenCode CLI not found')}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {translate(
                    'Install the OpenCode CLI for free tier models and connected providers.'
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
                  {opencodeCliStatus?.installCommand ||
                    'curl -fsSL https://opencode.ai/install | bash'}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    copyCommand(
                      opencodeCliStatus?.installCommand ||
                        'curl -fsSL https://opencode.ai/install | bash'
                    )
                  }
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {opencodeCliStatus?.installed && !opencodeCliStatus?.auth?.authenticated && !isChecking && (
          <div className="space-y-4">
            {/* Show CLI installed toast */}
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <div>
                <p className="font-medium text-foreground">{translate('CLI Installed')}</p>
                <p className="text-sm text-muted-foreground">
                  {opencodeCliStatus?.version &&
                    translate('Version: {value1}', { value1: opencodeCliStatus.version })}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-foreground">
                  {translate('OpenCode CLI not authenticated')}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {translate('Run the login command to authenticate.')}
                </p>
              </div>
            </div>
            <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
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

        {isChecking && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <Spinner size="md" />
            <p className="font-medium text-foreground">
              {translate('Checking OpenCode CLI status...')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Gemini Content
// ============================================================================
function GeminiContent() {
  useUiLocale();
  const { geminiCliStatus, setGeminiCliStatus } = useSetupStore();
  const [isChecking, setIsChecking] = useState(false);

  const checkStatus = useCallback(async () => {
    setIsChecking(true);
    try {
      const result = await getHttpApiClient().setup.getGeminiStatus();
      setGeminiCliStatus({
        installed: result.installed,
        connected: result.connected,
        version: result.version,
        path: result.path,
        auth: result.auth,
        installCommand: result.installCommand,
        loginCommand: result.loginCommand,
      });
    } catch {
      toast.error(translate('Failed to fetch Gemini CLI status'));
    } finally {
      setIsChecking(false);
    }
  }, [setGeminiCliStatus]);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const copyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      toast.info(
        translate(
          'Login command copied. Run it in your terminal; status refresh does not verify authentication.'
        )
      );
    } catch {
      toast.error(translate('Failed to copy login command'));
    }
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <GeminiIcon className="w-5 h-5" />
            {translate('Gemini CLI Status')}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void checkStatus()}
            disabled={isChecking}
            data-testid="refresh-gemini-setup"
            aria-label={translate('Refresh Gemini CLI detection')}
          >
            {isChecking ? <Spinner size="sm" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
        <CardDescription>
          {geminiCliStatus?.installed
            ? translate('Installed; authentication not checked')
            : translate('Not installed on your system')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <PassiveAuthenticationNotice
          hasCredentialsHint={
            geminiCliStatus?.auth?.hasApiKey || geminiCliStatus?.auth?.hasVertexConfig
          }
          hasConfigFile={geminiCliStatus?.auth?.hasConfigFile}
        />
        {!geminiCliStatus?.installed && !isChecking && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <p>{translate('Install the Gemini CLI to use Google Gemini models.')}</p>
            <code>{geminiCliStatus?.installCommand || GEMINI_CLI_INSTALL_COMMAND}</code>
          </div>
        )}
        <div className="space-y-3 rounded-lg border border-border p-4">
          <p className="font-medium">{translate('Google OAuth Login')}</p>
          <code>{geminiCliStatus?.loginCommand || 'gemini'}</code>
          <Button
            variant="outline"
            onClick={() => void copyCommand(geminiCliStatus?.loginCommand || 'gemini')}
          >
            {translate('Copy login command')}
          </Button>
        </div>
        <GeminiCredentialsForm
          configured={!!geminiCliStatus?.auth?.hasApiKey}
          onChanged={checkStatus}
        />
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Copilot Content
// ============================================================================
function CopilotContent() {
  useUiLocale();
  const { copilotCliStatus, setCopilotCliStatus } = useSetupStore();
  const [isChecking, setIsChecking] = useState(false);

  const checkStatus = useCallback(async () => {
    setIsChecking(true);
    try {
      const api = getElectronAPI();
      if (!api.setup?.getCopilotStatus) return;
      const result = await api.setup.getCopilotStatus();
      if (result.success) {
        setCopilotCliStatus({
          installed: result.installed ?? false,
          version: result.version,
          path: result.path,
          auth: result.auth,
          installCommand: result.installCommand,
          loginCommand: result.loginCommand,
        });
        if (result.auth?.authenticated) {
          toast.success(translate('Copilot CLI is ready!'));
        }
      }
    } catch {
      // Ignore
    } finally {
      setIsChecking(false);
    }
  }, [setCopilotCliStatus]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const copyCommand = (command: string) => {
    navigator.clipboard.writeText(command);
    toast.success(translate('Command copied to clipboard'));
  };

  const handleLogin = async () => {
    try {
      await navigator.clipboard.writeText(copilotCliStatus?.loginCommand || 'gh auth login');
      toast.info(
        translate(
          'Login command copied. Run it in your terminal; status refresh does not verify authentication.'
        )
      );
    } catch {
      toast.error(translate('Failed to copy login command'));
    }
  };

  const isReady = copilotCliStatus?.installed && copilotCliStatus?.auth?.authenticated;

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <CopilotIcon className="w-5 h-5" />
            {translate('GitHub Copilot CLI Status')}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={checkStatus} disabled={isChecking}>
            {isChecking ? <Spinner size="sm" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
        <CardDescription>
          {copilotCliStatus?.installed
            ? copilotCliStatus.auth?.authenticationChecked === false
              ? translate('Installed; authentication not checked')
              : copilotCliStatus.auth?.authenticated
                ? translate('Authenticated{value1}', {
                    value1: copilotCliStatus.version ? ` (v${copilotCliStatus.version})` : '',
                  })
                : translate('Installed but not authenticated')
            : translate('Not installed on your system')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isReady && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <div>
                <p className="font-medium text-foreground">{translate('SDK Installed')}</p>
                <p className="text-sm text-muted-foreground">
                  {copilotCliStatus?.version &&
                    translate('Version: {value1}', { value1: copilotCliStatus.version })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <div>
                <p className="font-medium text-foreground">{translate('Authenticated')}</p>
                {copilotCliStatus?.auth?.login && (
                  <p className="text-sm text-muted-foreground">
                    {translate('Logged in as ')}
                    {copilotCliStatus.auth.login}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {!copilotCliStatus?.installed && !isChecking && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/30 border border-border">
              <XCircle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-foreground">{translate('Copilot CLI not found')}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {translate('Install the GitHub Copilot CLI to use Copilot models.')}
                </p>
              </div>
            </div>
            <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
              <p className="font-medium text-foreground text-sm">
                {translate('Install Copilot CLI:')}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono text-foreground overflow-x-auto">
                  {copilotCliStatus?.installCommand || 'npm install -g @github/copilot'}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    copyCommand(
                      copilotCliStatus?.installCommand || 'npm install -g @github/copilot'
                    )
                  }
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {copilotCliStatus?.installed && !copilotCliStatus?.auth?.authenticated && !isChecking && (
          <div className="space-y-4">
            {/* Show SDK installed toast */}
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              <div>
                <p className="font-medium text-foreground">{translate('SDK Installed')}</p>
                <p className="text-sm text-muted-foreground">
                  {copilotCliStatus?.version &&
                    translate('Version: {value1}', { value1: copilotCliStatus.version })}
                </p>
              </div>
            </div>

            <PassiveAuthenticationNotice
              hasCredentialsHint={copilotCliStatus.auth?.hasEnvToken}
              hasConfigFile={copilotCliStatus.auth?.hasConfigFile}
            />
            <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono text-foreground">
                  {copilotCliStatus?.loginCommand || 'gh auth login'}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copyCommand(copilotCliStatus?.loginCommand || 'gh auth login')}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <Button
                onClick={handleLogin}
                className="w-full bg-brand-500 hover:bg-brand-600 text-white"
              >
                {translate('Copy login command')}
              </Button>
            </div>
          </div>
        )}

        {isChecking && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <Spinner size="md" />
            <p className="font-medium text-foreground">
              {translate('Checking Copilot CLI status...')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Component
// ============================================================================
export function ProvidersSetupStep({ onNext, onBack }: ProvidersSetupStepProps) {
  useUiLocale();
  const { data: directSettings } = useDirectEndpoints();
  const hasConfiguredDirectEndpoint =
    directSettings?.endpoints.some(
      ({ endpoint, keyConfigured }) =>
        endpoint.enabled &&
        endpoint.protocol === 'chat-completions' &&
        endpoint.models.length > 0 &&
        keyConfigured
    ) ?? false;
  const [activeTab, setActiveTab] = useState<ProviderTab>('claude');
  const [isInitialChecking, setIsInitialChecking] = useState(true);
  const hasCheckedRef = useRef(false);

  const {
    claudeCliStatus,
    claudeAuthStatus,
    claudeIsVerifying,
    cursorCliStatus,
    codexCliStatus,
    codexAuthStatus,
    opencodeCliStatus,
    geminiCliStatus,
    copilotCliStatus,
    setClaudeCliStatus,
    setCursorCliStatus,
    setCodexCliStatus,
    setCodexAuthStatus,
    setOpencodeCliStatus,
    setGeminiCliStatus,
    setCopilotCliStatus,
  } = useSetupStore();

  // Check all providers on mount
  const checkAllProviders = useCallback(async () => {
    const api = getElectronAPI();

    // Check Claude - only check CLI status, let ClaudeContent handle auth verification
    const checkClaude = async () => {
      try {
        if (!api.setup?.getClaudeStatus) return;
        const result = await api.setup.getClaudeStatus();
        if (result.success) {
          setClaudeCliStatus({
            installed: result.installed ?? false,
            version: result.version ?? null,
            path: result.path ?? null,
            method: 'none',
          });
          // Note: Auth verification is handled by ClaudeContent component to avoid duplicate calls
        }
      } catch {
        // Ignore errors
      }
    };

    // Check Cursor
    const checkCursor = async () => {
      try {
        if (!api.setup?.getCursorStatus) return;
        const result = await api.setup.getCursorStatus();
        if (result.success) {
          setCursorCliStatus({
            installed: result.installed ?? false,
            connected: result.connected,
            version: result.version,
            path: result.path,
            auth: result.auth,
            installCommand: result.installCommand,
            loginCommand: result.loginCommand,
          });
        }
      } catch {
        // Ignore errors
      }
    };

    // Check Codex
    const checkCodex = async () => {
      try {
        if (!api.setup?.getCodexStatus) return;
        const result = await api.setup.getCodexStatus();
        if (result.success) {
          setCodexCliStatus({
            installed: result.installed ?? false,
            version: result.version ?? null,
            path: result.path ?? null,
            method: 'none',
          });
          if (result.auth) {
            const validMethods = ['api_key_env', 'api_key', 'cli_authenticated', 'none'] as const;
            type CodexAuthMethodType = (typeof validMethods)[number];
            const method: CodexAuthMethodType = validMethods.includes(
              result.auth.method as CodexAuthMethodType
            )
              ? (result.auth.method as CodexAuthMethodType)
              : 'cli_authenticated';
            setCodexAuthStatus({
              authenticated: result.auth.authenticated,
              authenticationChecked: result.auth.authenticationChecked,
              method,
            });
          }
        }
      } catch {
        // Ignore errors
      }
    };

    // Check OpenCode
    const checkOpencode = async () => {
      try {
        if (!api.setup?.getOpencodeStatus) return;
        const result = await api.setup.getOpencodeStatus();
        if (result.success) {
          // Derive install command from platform-specific options or use npm fallback
          const installCommand =
            result.installCommands?.npm ||
            result.installCommands?.macos ||
            result.installCommands?.linux;
          setOpencodeCliStatus({
            installed: result.installed ?? false,
            version: result.version ?? null,
            path: result.path ?? null,
            auth: result.auth,
            installCommand,
            loginCommand: 'opencode auth login',
          });
        }
      } catch {
        // Ignore errors
      }
    };

    // Check Gemini
    const checkGemini = async () => {
      try {
        if (!api.setup?.getGeminiStatus) return;
        const result = await api.setup.getGeminiStatus();
        if (result.success) {
          setGeminiCliStatus({
            installed: result.installed ?? false,
            version: result.version,
            path: result.path,
            auth: result.auth,
            installCommand: result.installCommand,
            loginCommand: result.loginCommand,
          });
        }
      } catch {
        // Ignore errors
      }
    };

    // Check Copilot
    const checkCopilot = async () => {
      try {
        if (!api.setup?.getCopilotStatus) return;
        const result = await api.setup.getCopilotStatus();
        if (result.success) {
          setCopilotCliStatus({
            installed: result.installed ?? false,
            version: result.version,
            path: result.path,
            auth: result.auth,
            installCommand: result.installCommand,
            loginCommand: result.loginCommand,
          });
        }
      } catch {
        // Ignore errors
      }
    };

    // Run all checks in parallel
    await Promise.all([
      checkClaude(),
      checkCursor(),
      checkCodex(),
      checkOpencode(),
      checkGemini(),
      checkCopilot(),
    ]);
    setIsInitialChecking(false);
  }, [
    setClaudeCliStatus,
    setCursorCliStatus,
    setCodexCliStatus,
    setCodexAuthStatus,
    setOpencodeCliStatus,
    setGeminiCliStatus,
    setCopilotCliStatus,
  ]);

  useEffect(() => {
    if (!hasCheckedRef.current) {
      hasCheckedRef.current = true;
      checkAllProviders();
    }
  }, [checkAllProviders]);

  // Determine status for each provider
  const isClaudeInstalled = claudeCliStatus?.installed === true;
  const isClaudeAuthenticated =
    claudeAuthStatus?.authenticated === true &&
    (claudeAuthStatus?.method === 'cli_authenticated' ||
      claudeAuthStatus?.method === 'api_key' ||
      claudeAuthStatus?.method === 'api_key_env');

  const isCursorInstalled = cursorCliStatus?.installed === true;
  // Passive host hints never establish account authentication.
  const isCursorAuthenticated = false;

  const isCodexInstalled = codexCliStatus?.installed === true;
  const isCodexAuthenticated = codexAuthStatus?.authenticated === true;

  const isOpencodeInstalled = opencodeCliStatus?.installed === true;
  const isOpencodeAuthenticated = opencodeCliStatus?.auth?.authenticated === true;

  const isGeminiInstalled = geminiCliStatus?.installed === true;
  const isGeminiAuthenticated =
    geminiCliStatus?.auth?.authenticationChecked === true &&
    geminiCliStatus.auth.authenticated === true;

  const isCopilotInstalled = copilotCliStatus?.installed === true;
  const isCopilotAuthenticated = copilotCliStatus?.auth?.authenticated === true;

  const hasAtLeastOneProvider =
    hasConfiguredDirectEndpoint ||
    canAttemptCliProvider(claudeCliStatus, claudeAuthStatus) ||
    isCursorAuthenticated ||
    canAttemptCliProvider(codexCliStatus, codexAuthStatus) ||
    canAttemptCliProvider(opencodeCliStatus, opencodeCliStatus?.auth) ||
    isGeminiAuthenticated ||
    isCopilotAuthenticated;

  type ProviderStatus =
    | 'not_installed'
    | 'installed_not_auth'
    | 'authenticated'
    | 'verifying'
    | 'unverified';

  const getProviderStatus = (
    installed: boolean,
    authenticated: boolean,
    isVerifying?: boolean
  ): ProviderStatus => {
    if (!installed) return 'not_installed';
    if (isVerifying) return 'verifying';
    if (!authenticated) return 'installed_not_auth';
    return 'authenticated';
  };

  const providers = [
    {
      id: 'claude' as const,
      label: translate('Claude'),
      icon: AnthropicIcon,
      status:
        isClaudeInstalled && !claudeIsVerifying && claudeAuthStatus?.authenticationChecked === false
          ? ('unverified' as const)
          : getProviderStatus(isClaudeInstalled, isClaudeAuthenticated, claudeIsVerifying),
      color: 'text-brand-500',
    },
    {
      id: 'cursor' as const,
      label: translate('Cursor'),
      icon: CursorIcon,
      status: isCursorInstalled ? ('unverified' as const) : ('not_installed' as const),
      color: 'text-blue-500',
    },
    {
      id: 'codex' as const,
      label: translate('Codex'),
      icon: OpenAIIcon,
      status:
        isCodexInstalled && codexAuthStatus?.authenticationChecked === false
          ? ('unverified' as const)
          : getProviderStatus(isCodexInstalled, isCodexAuthenticated),
      color: 'text-emerald-500',
    },
    {
      id: 'opencode' as const,
      label: translate('OpenCode'),
      icon: OpenCodeIcon,
      status:
        isOpencodeInstalled && opencodeCliStatus?.auth?.authenticationChecked === false
          ? ('unverified' as const)
          : getProviderStatus(isOpencodeInstalled, isOpencodeAuthenticated),
      color: 'text-green-500',
    },
    {
      id: 'gemini' as const,
      label: translate('Gemini'),
      icon: GeminiIcon,
      status:
        isGeminiInstalled && geminiCliStatus?.auth?.authenticationChecked === false
          ? ('unverified' as const)
          : getProviderStatus(isGeminiInstalled, isGeminiAuthenticated),
      color: 'text-blue-500',
    },
    {
      id: 'copilot' as const,
      label: translate('Copilot'),
      icon: CopilotIcon,
      status:
        isCopilotInstalled && copilotCliStatus?.auth?.authenticationChecked === false
          ? ('unverified' as const)
          : getProviderStatus(isCopilotInstalled, isCopilotAuthenticated),
      color: 'text-violet-500',
    },
  ];

  const renderStatusIcon = (status: ProviderStatus) => {
    switch (status) {
      case 'unverified':
        return (
          <AlertCircle
            aria-label={translate('Authentication not checked')}
            className="w-3 h-3 text-amber-500 absolute -top-1 -right-1.5 bg-background rounded-full"
          />
        );
      case 'authenticated':
        return (
          <CheckCircle2 className="w-3 h-3 text-green-500 absolute -top-1 -right-1.5 bg-background rounded-full" />
        );
      case 'verifying':
        return (
          <Spinner size="xs" className="absolute -top-1 -right-1.5 bg-background rounded-full" />
        );
      case 'installed_not_auth':
        return (
          <AlertCircle className="w-3 h-3 text-red-500 absolute -top-1 -right-1.5 bg-background rounded-full" />
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-2">
          {translate('AI Provider Setup')}
        </h2>
        <p className="text-muted-foreground">
          {translate('Configure at least one AI provider to continue')}
        </p>
      </div>

      {isInitialChecking && (
        <div className="flex items-center justify-center gap-2 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <Spinner size="md" />
          <p className="font-medium text-foreground">{translate('Checking provider status...')}</p>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ProviderTab)}>
        <TabsList className="flex w-full flex-wrap h-auto p-1">
          <TabsTrigger
            value="direct"
            className="relative flex flex-col items-center gap-1 py-3 px-2"
          >
            <OpenAIIcon className="w-5 h-5" />
            <span className="text-xs font-medium">{translate('Direct API (no CLI)')}</span>
          </TabsTrigger>
          {providers.map((provider) => {
            const Icon = provider.icon;
            return (
              <TabsTrigger
                key={provider.id}
                value={provider.id}
                className={cn(
                  'relative flex flex-col items-center gap-1 py-3 px-2',
                  'data-[state=active]:bg-muted'
                )}
              >
                <div className="relative">
                  <Icon
                    className={cn(
                      'w-5 h-5',
                      provider.status === 'authenticated'
                        ? provider.color
                        : provider.status === 'verifying'
                          ? 'text-blue-500'
                          : provider.status === 'installed_not_auth'
                            ? 'text-amber-500'
                            : 'text-muted-foreground'
                    )}
                  />
                  {!isInitialChecking && renderStatusIcon(provider.status)}
                </div>
                <span className="text-xs font-medium">{provider.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <div className="mt-6">
          <TabsContent value="direct" className="mt-0">
            <DirectSettingsTab />
          </TabsContent>
          <TabsContent value="claude" className="mt-0">
            <ClaudeContent />
          </TabsContent>
          <TabsContent value="cursor" className="mt-0">
            <CursorContent />
          </TabsContent>
          <TabsContent value="codex" className="mt-0">
            <CodexContent />
          </TabsContent>
          <TabsContent value="opencode" className="mt-0">
            <OpencodeContent />
          </TabsContent>
          <TabsContent value="gemini" className="mt-0">
            <GeminiContent />
          </TabsContent>
          <TabsContent value="copilot" className="mt-0">
            <CopilotContent />
          </TabsContent>
        </div>
      </Tabs>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack} className="text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-2" />
          {translate('Back')}
        </Button>
        <Button
          onClick={onNext}
          className={cn(
            'bg-brand-500 hover:bg-brand-600 text-white',
            !hasAtLeastOneProvider && 'opacity-50'
          )}
          data-testid="providers-next-button"
        >
          {hasAtLeastOneProvider ? translate('Continue') : translate('Skip for now')}
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>

      {!hasAtLeastOneProvider && (
        <p className="text-xs text-muted-foreground text-center">
          {translate('You can configure providers later in Settings')}
        </p>
      )}
    </div>
  );
}
