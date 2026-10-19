import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { isDirectModel, isRemoteCliModel, isRemoteSdkModel } from '@automaker/types';
import { getHttpApiClient } from '@/lib/http-api-client';
import { Button } from '@/components/ui/button';

/** Metadata-only inspection: opening a feature must never create/connect to a workspace. */
export function FeatureEnvironmentStatus({
  projectPath,
  featureId,
  model,
}: {
  projectPath: string;
  featureId: string;
  model?: string;
}) {
  const [accepted, setAccepted] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const { data, error } = useQuery({
    queryKey: ['feature-environment', projectPath, featureId],
    enabled: isDirectModel(model) || isRemoteCliModel(model) || isRemoteSdkModel(model),
    refetchInterval: 10000,
    queryFn: () => getHttpApiClient().executionEnvironments.inspectFeature(projectPath, featureId),
  });
  if (!isDirectModel(model) && !isRemoteCliModel(model) && !isRemoteSdkModel(model)) return null;
  if (error) return <p role="alert">Feature execution environment could not be inspected.</p>;
  if (!data) return null;
  if (!data.success) return <p role="alert">{data.error || 'Feature environment unavailable.'}</p>;
  const binding = data.binding;
  const workspace = binding?.sshWorkspace ?? binding?.featureWorkspace;
  const reviewTarget = JSON.stringify([
    projectPath,
    featureId,
    binding?.id,
    binding?.runtimeCwd,
    workspace,
  ]);
  return (
    <aside
      className="rounded-lg border p-3 text-sm space-y-1"
      aria-label="Feature execution environment"
    >
      <p>
        Execution environment:{' '}
        {binding
          ? `${binding.type}${binding.fallbackReason ? ' (Auto fallback)' : ''} — pinned`
          : `${data.selectedType} — not started, no binding yet`}
        .
      </p>
      {binding?.featurePreparation && (
        <p role="alert">
          Feature workspace preparation is incomplete. Start/resume the feature to inspect its
          pinned intent. Verify, Commit and hooks will not create or repair it implicitly.
        </p>
      )}
      {binding && (binding.type === 'ssh' || binding.featureWorkspace) && (
        <>
          <p>
            Remote workspace: <code className="break-all">{binding.runtimeCwd}</code>
          </p>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={accepted === reviewTarget}
              onChange={(event) => setAccepted(event.target.checked ? reviewTarget : '')}
            />
            I reviewed the remote commits and allow fast-forward merge into the pinned target branch
          </label>
          <Button
            disabled={accepted !== reviewTarget || busy}
            variant="outline"
            onClick={() =>
              void (async () => {
                setBusy(true);
                setMessage('');
                try {
                  const result = await getHttpApiClient().autoMode.mergeEnvironmentFeature(
                    projectPath,
                    featureId
                  );
                  if (!result.success) throw new Error(result.error || 'Remote merge failed.');
                  setMessage('Remote fast-forward merge completed. Nothing was pushed.');
                  setAccepted('');
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : 'Remote merge failed.');
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            Merge remote feature (fast-forward only)
          </Button>
          {message && <p role="status">{message}</p>}
          {workspace && (
            <p>
              Feature branch: <code>{workspace.branch}</code> → <code>{workspace.baseBranch}</code>.
            </p>
          )}
          <p>
            Agent, pipeline, Verify, Commit and feature shell hooks use {binding.type}.
            {binding.type === 'ssh'
              ? ' Local project files are not synchronized.'
              : binding.type === 'docker'
                ? ' Docker shares project files with the server; commands run inside the container.'
                : ' Auto Local fallback uses server-user permissions in its pinned worktree.'}{' '}
            Git UI reads, Stage/Commit and Create use the selected target; advanced Git/network/PR
            actions are not migrated. Integrated terminal and manual tests follow their inspected
            target (Linux/Python 3). Managed dev/preview is available on separate authenticated
            ports, without controller cookies or port changes to pinned containers. Cookie apps,
            service workers and external browser backend requests are not supported yet. Merge is
            remote fast-forward only; nothing is pushed.
          </p>
        </>
      )}
    </aside>
  );
}
