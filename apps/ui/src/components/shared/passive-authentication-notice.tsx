import { translate, useUiLocale } from '@/lib/i18n';

export function PassiveAuthenticationNotice({
  hasEnvToken,
  hasConfigFile,
}: {
  hasEnvToken?: boolean;
  hasConfigFile?: boolean;
}) {
  useUiLocale();
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm">
      <p className="font-medium">{translate('Authentication not checked')}</p>
      <p className="mt-1 text-muted-foreground">
        {hasEnvToken || hasConfigFile
          ? translate(
              'Local token or configuration detected. This does not verify your account or Copilot access.'
            )
          : translate(
              'No local token or configuration detected. CLI login is performed separately.'
            )}
      </p>
      <p className="mt-1 text-muted-foreground">
        {translate('Refreshing status does not run authentication commands or contact GitHub.')}
      </p>
    </div>
  );
}
