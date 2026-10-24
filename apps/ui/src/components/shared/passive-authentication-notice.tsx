import { translate, useUiLocale } from '@/lib/i18n';

export function PassiveAuthenticationNotice({
  hasCredentialsHint,
  hasConfigFile,
}: {
  hasCredentialsHint?: boolean;
  hasConfigFile?: boolean;
}) {
  useUiLocale();
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm">
      <p className="font-medium">{translate('Authentication not checked')}</p>
      <p className="mt-1 text-muted-foreground">
        {hasCredentialsHint || hasConfigFile
          ? translate(
              'Local credentials or configuration detected. This does not verify your account or provider access.'
            )
          : translate(
              'No local credentials or configuration detected. CLI login is performed separately.'
            )}
      </p>
      <p className="mt-1 text-muted-foreground">
        {translate('Refreshing status does not run authentication commands.')}
      </p>
    </div>
  );
}
