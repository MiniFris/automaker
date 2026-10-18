import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getHttpApiClient } from '@/lib/http-api-client';

/** Do not mount controller file readers/autosave for a remote Git checkout. */
export function SourceEditorEnvironmentGate({
  path,
  children,
}: {
  path?: string;
  children: ReactNode;
}) {
  const query = useQuery({
    queryKey: ['git-environment', path],
    enabled: !!path,
    refetchInterval: 10000,
    queryFn: () => getHttpApiClient().executionEnvironments.inspectGit(path!),
  });
  if (!path) return children;
  if (query.isPending)
    return (
      <p role="status" className="p-4">
        Checking source editor environment…
      </p>
    );
  if (query.error || !query.data?.success || !query.data.executionEnvironment)
    return (
      <p role="alert" className="p-4">
        Source editor environment is unavailable. Controller file readers and autosave were not
        started. Check Execution Environment settings.
      </p>
    );
  if (query.data.executionEnvironment.type === 'ssh')
    return (
      <aside role="alert" className="p-4">
        This checkout is on SSH at <code>{query.data.executionEnvironment.runtimeCwd}</code>. The
        source editor still uses the Automaker server filesystem and is not available for this
        remote checkout. Use Worktree → Changes/Commits for target-side Git inspection, or edit on
        the SSH host. No local copy or autosave was opened.
      </aside>
    );
  return children;
}
