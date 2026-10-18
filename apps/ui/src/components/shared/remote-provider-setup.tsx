import { useState } from 'react';
import type { RemoteProviderStatus, RemoteSdkProvider } from '@automaker/types';
import { getHttpApiClient } from '@/lib/http-api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Explicit target-side operations only. No connection, installation or credential copy on mount. */
export function RemoteProviderSetup({ projectPath }: { projectPath: string }) {
  const [provider, setProvider] = useState<RemoteSdkProvider>('claude');
  const [status, setStatus] = useState<RemoteProviderStatus>();
  const [key, setKey] = useState(''),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const api = getHttpApiClient().executionEnvironments;
  async function action(
    operation: () => Promise<{ success: boolean; status?: RemoteProviderStatus; error?: string }>
  ) {
    setBusy(true);
    setMessage('');
    try {
      const result = await operation();
      if (!result.success || !result.status)
        throw new Error(result.error || 'Remote provider operation failed.');
      setStatus(result.status);
      setMessage('Target status updated. Credential presence is not a live model access check.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Remote provider operation failed.');
    } finally {
      setBusy(false);
      setKey('');
    }
  }
  return (
    <section aria-label="Remote providers" className="rounded-lg border p-4 space-y-3">
      <h3 className="font-medium">Remote providers — SDK setup</h3>
      <p className="text-sm">
        Install pinned Claude, Codex or Copilot SDKs inside the saved project Docker/SSH target. No
        sudo, global npm install or controller credential copying. The target needs npm and registry
        access. Existing runs keep their environment.
      </p>
      <fieldset disabled={busy} className="space-y-3">
        <Label htmlFor="remote-sdk-provider">SDK provider</Label>
        <select
          id="remote-sdk-provider"
          className="rounded-md border bg-background p-2"
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value as RemoteSdkProvider);
            setStatus(undefined);
            setKey('');
            setAccepted(false);
            setMessage('');
          }}
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
          <option value="copilot">Copilot</option>
        </select>
        <Button
          variant="outline"
          onClick={() => void action(() => api.inspectProvider(projectPath, provider))}
        >
          Inspect saved provider target
        </Button>
        {status && (
          <>
            <p>
              Target: {status.environment} — <code>{status.cwd}</code>
            </p>
            <p>
              SDK {status.packageVersion}: {status.installed ? 'installed' : 'not installed'}.
            </p>
            <p>
              Credentials: {status.credentialSource}; authentication: {status.authentication}.
            </p>
            <p className="text-xs break-all">Managed installation: {status.root}</p>
            <Label className="flex gap-2">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              I allow installing these SDK packages and managing credentials on this target OS
              user/container
            </Label>
            <Button
              disabled={!accepted}
              onClick={() =>
                void action(() => api.installProvider(projectPath, provider, status.targetId))
              }
            >
              Install pinned SDK on target
            </Button>
            <p className="text-sm">
              API keys/tokens are saved only on the target, in a private 0600 file, readable by that
              OS user and its agents. SSH credentials are shared by that remote user’s projects. Use
              HTTPS when connecting to Automaker. Existing target OAuth sessions can also be used;
              automatic browser/device login is not started here.
            </p>
            <Label htmlFor="remote-provider-key">Target API key / Copilot token</Label>
            <Input
              id="remote-provider-key"
              type="password"
              autoComplete="off"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <Button
              disabled={!accepted || !status.installed || !key.trim()}
              onClick={() =>
                void action(() => api.saveProviderKey(projectPath, provider, status.targetId, key))
              }
            >
              Save key on target
            </Button>
            <Button
              variant="outline"
              disabled={!accepted || !status.hasStoredKey}
              onClick={() =>
                void action(() => api.clearProviderKey(projectPath, provider, status.targetId))
              }
            >
              Remove managed target key
            </Button>
            <p className="text-sm">
              Claude/Codex/Copilot support Docker/SSH chat and Kanban with pinned feature
              workspaces. Copilot read-only planning and forwarded controller MCP/attachments are
              not supported.
            </p>
          </>
        )}
      </fieldset>
      {busy && (
        <p role="status">Working on the saved target… Installation may take up to 10 minutes.</p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
