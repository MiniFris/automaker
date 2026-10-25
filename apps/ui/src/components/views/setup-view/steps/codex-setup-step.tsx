// @ts-nocheck - Codex setup wizard with Electron API integration
import { useLocalizedMemo } from '@/lib/i18n';
import { translate } from '@/lib/i18n';
import { verifyCodexWithConsent } from '@/lib/codex-verification-consent';
import { useUiLocale } from '@/lib/i18n';
import { useCallback } from 'react';
import { useSetupStore } from '@/store/setup-store';
import { getElectronAPI } from '@/lib/electron';
import { CliSetupStep } from './cli-setup-step';
import type { CodexAuthStatus } from '@/store/setup-store';

interface CodexSetupStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function CodexSetupStep({ onNext, onBack, onSkip }: CodexSetupStepProps) {
  useUiLocale();
  const {
    codexCliStatus,
    codexAuthStatus,
    setCodexCliStatus,
    setCodexAuthStatus,
    setCodexInstallProgress,
  } = useSetupStore();

  const statusApi = useCallback(
    () => getElectronAPI().setup?.getCodexStatus() || Promise.reject(),
    []
  );

  const installApi = useCallback(
    (signal?: AbortSignal) => getElectronAPI().setup?.installCodex(signal) || Promise.reject(),
    []
  );

  const verifyAuthApi = useCallback(
    (method: 'cli' | 'api_key', apiKey?: string) => verifyCodexWithConsent(method, apiKey),
    []
  );

  const config = useLocalizedMemo(
    () => ({
      cliType: 'codex' as const,
      displayName: translate('Codex'),
      cliLabel: translate('Codex CLI'),
      cliDescription: translate('Use Codex CLI login'),
      apiKeyLabel: translate('OpenAI API Key'),
      apiKeyDescription: translate('Optional API key for Codex'),
      apiKeyProvider: 'openai' as const,
      apiKeyPlaceholder: 'sk-...',
      apiKeyDocsUrl: 'https://platform.openai.com/api-keys',
      apiKeyDocsLabel: 'Get one from OpenAI',
      apiKeyHelpText: "Don't have an API key?",
      installCommands: {
        macos: 'npm install -g @openai/codex',
        windows: 'npm install -g @openai/codex',
      },
      cliLoginCommand: 'codex login',
      testIds: {
        installButton: 'install-codex-button',
        verifyCliButton: 'verify-codex-cli-button',
        verifyApiKeyButton: 'verify-codex-api-key-button',
        apiKeyInput: 'openai-api-key-input',
        saveApiKeyButton: 'save-openai-key-button',
        deleteApiKeyButton: 'delete-openai-key-button',
        nextButton: 'codex-next-button',
      },
      buildCliAuthStatus: (_previous: CodexAuthStatus | null) => ({
        authenticated: true,
        method: 'cli_authenticated',
        hasAuthFile: true,
      }),
      buildApiKeyAuthStatus: (_previous: CodexAuthStatus | null) => ({
        authenticated: true,
        method: 'api_key',
        hasApiKey: true,
      }),
      buildClearedAuthStatus: (_previous: CodexAuthStatus | null) => ({
        authenticated: false,
        method: 'none',
      }),
      statusApi,
      installApi,
      verifyAuthApi,
    }),
    [installApi, statusApi, verifyAuthApi]
  );

  return (
    <CliSetupStep
      config={config}
      state={{
        cliStatus: codexCliStatus,
        authStatus: codexAuthStatus,
        setCliStatus: setCodexCliStatus,
        setAuthStatus: setCodexAuthStatus,
        setInstallProgress: setCodexInstallProgress,
        getStoreState: () => useSetupStore.getState().codexCliStatus,
      }}
      onNext={onNext}
      onBack={onBack}
      onSkip={onSkip}
    />
  );
}
