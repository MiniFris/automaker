import { translate, useUiLocale } from '@/lib/i18n';
import { useQuery } from '@tanstack/react-query';
import { getHttpApiClient } from '@/lib/http-api-client';

/** Metadata inspection only; never prepares/connects to a runtime on mount. */
export function GitEnvironmentStatus({ path }: { path: string }) {
  useUiLocale();
  const { data, error } = useQuery({
    queryKey: ['git-environment', path],
    refetchInterval: 10000,
    queryFn: () => getHttpApiClient().executionEnvironments.inspectGit(path),
  });
  if (error || data?.success === false)
    return (
      <p role="alert" className="text-xs">
        {translate('Git environment unavailable: ')}
        {data?.error || translate('check saved project settings.')}{' '}
        {translate(' No server fallback is used.')}
      </p>
    );
  if (!data?.executionEnvironment) return null;
  const env = data.executionEnvironment;
  return (
    <aside
      aria-label={translate('Git execution environment')}
      className="text-xs text-muted-foreground basis-full"
    >
      {translate('Git: ')}
      {env.type}
      {env.pinned
        ? translate(' — pinned workspace')
        : translate(' — saved project selection')} · <code>{env.runtimeCwd}</code>.
      {env.type !== 'local' &&
        translate(
          ' Paths in this selector are controller aliases. Git commands run on target; remote refs are cached (no automatic fetch). Stage/Commit/Create are supported; advanced Git/network/PR actions are not migrated. Integrated terminal, manual tests and managed dev/preview follow their captured targets (Linux/Python 3). Preview uses separate authenticated ports without controller cookies; target-cookie apps, service workers and external browser backend requests are not supported yet. SSH editor is separate; do not treat an SSH alias as a server checkout.'
        )}
    </aside>
  );
}
