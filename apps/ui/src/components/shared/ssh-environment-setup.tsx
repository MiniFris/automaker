import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  SSHHostKey,
  SSHDiagnostic,
  SSHEnvironmentProfile,
  SSHEnvironmentStatus,
} from '@automaker/types';
import { getHttpApiClient } from '@/lib/http-api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** Secrets are transient form state, never returned by the API or saved in browser storage. */
export function SSHEnvironmentSetup({
  profile,
  status,
  projectPath,
}: {
  profile: SSHEnvironmentProfile;
  status?: SSHEnvironmentStatus;
  projectPath?: string;
}) {
  const cache = useQueryClient();
  const api = getHttpApiClient().executionEnvironments;
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [candidate, setCandidate] = useState<SSHHostKey | null>(null),
    [verified, setVerified] = useState(false),
    [replace, setReplace] = useState(false);
  const [key, setKey] = useState(''),
    [passphrase, setPassphrase] = useState(''),
    [accepted, setAccepted] = useState(false);
  const [method, setMethod] = useState<'import' | 'clone' | 'existing'>('import'),
    [repositoryUrl, setRepositoryUrl] = useState(''),
    [remotePath, setRemotePath] = useState('');
  const [diagnostic, setDiagnostic] = useState<SSHDiagnostic | null>(null),
    [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    setCandidate(null);
    setVerified(false);
    setReplace(false);
    setKey('');
    setPassphrase('');
    setAccepted(false);
    setDiagnostic(null);
    setAcknowledged(false);
    setMethod('import');
    setRepositoryUrl('');
    setRemotePath('');
    setMessage('');
  }, [
    profile.id,
    profile.host,
    profile.port,
    profile.username,
    profile.basePath,
    profile.credentialId,
    projectPath,
  ]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
      await cache.invalidateQueries({ queryKey: ['settings', 'execution-environments'] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'SSH operation failed.');
    } finally {
      setBusy(false);
    }
  }
  function successful(result: { success: boolean; error?: string }) {
    if (!result.success) throw new Error(result.error || 'SSH operation failed.');
  }
  return (
    <section aria-label="SSH connection setup" className="rounded-lg border p-4 space-y-4">
      <h3 className="font-medium">
        SSH setup — {profile.username}@{profile.host}:{profile.port}
      </h3>
      <p>
        SSH grants the agent the remote OS user’s full filesystem, network and process rights. It is
        not a sandbox and never falls back to Local. Remote prerequisites: Linux, Node 22+ and Git.
        Server private keys and model API keys are not forwarded.
      </p>
      <fieldset disabled={busy} className="space-y-3">
        <h4>1. Verify the host</h4>
        <p>Confirmed fingerprint: {status?.trustedHost?.fingerprint ?? 'not confirmed'}</p>
        <Button
          variant="outline"
          onClick={() =>
            void action(async () => {
              const result = await api.scanSSH(profile.id);
              successful(result);
              setCandidate(result.hostKey!);
              setVerified(false);
              setReplace(false);
            })
          }
        >
          Inspect SSH host fingerprint
        </Button>
        {candidate && (
          <div className="space-y-2" role="status">
            <p>
              {candidate.algorithm}: <code className="break-all">{candidate.fingerprint}</code>
            </p>
            <p>
              Scanning does not prove identity. Compare with the server administrator or a trusted
              console before accepting.
            </p>
            <Label className="flex gap-2">
              <input
                type="checkbox"
                checked={verified}
                onChange={(event) => setVerified(event.target.checked)}
              />
              I independently verified this SSH fingerprint
            </Label>
            {status?.trustedHost && status.trustedHost.fingerprint !== candidate.fingerprint && (
              <Label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(event) => setReplace(event.target.checked)}
                />
                Replace the trusted host key; existing pinned sessions will remain blocked
              </Label>
            )}
            <Button
              disabled={
                !verified ||
                !!(
                  status?.trustedHost &&
                  status.trustedHost.fingerprint !== candidate.fingerprint &&
                  !replace
                )
              }
              onClick={() =>
                void action(async () => {
                  successful(await api.trustSSH(profile.id, candidate.fingerprint, replace));
                  setCandidate(null);
                  setMessage('SSH fingerprint confirmed. Existing runs are not migrated.');
                })
              }
            >
              Confirm SSH fingerprint
            </Button>
          </div>
        )}
        <h4>2. Configure authentication</h4>
        {profile.credentialId ? (
          <>
            <p>
              Server credential ID: {profile.credentialId}. Private key{' '}
              {status?.hasPrivateKey ? 'is saved' : 'is not saved'}. This credential may be shared
              by other profiles.
            </p>
            <Label htmlFor={`ssh-key-${profile.id}`}>SSH private key (server storage only)</Label>
            <Textarea
              id={`ssh-key-${profile.id}`}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Label htmlFor={`ssh-passphrase-${profile.id}`}>SSH key passphrase (optional)</Label>
            <Input
              id={`ssh-passphrase-${profile.id}`}
              type="password"
              value={passphrase}
              autoComplete="new-password"
              onChange={(event) => setPassphrase(event.target.value)}
            />
            <Button
              disabled={!key.trim()}
              onClick={() =>
                void action(async () => {
                  successful(await api.saveSSHKey(profile.id, key, passphrase));
                  setKey('');
                  setPassphrase('');
                  setMessage('SSH key saved on the server; it is never returned by the API.');
                })
              }
            >
              Save SSH private key
            </Button>
            {status?.hasPrivateKey && (
              <Button
                variant="outline"
                onClick={() =>
                  void action(async () => {
                    successful(await api.clearSSHKey(profile.id));
                    setMessage(
                      'Server SSH credential removed. Later connections using it are blocked.'
                    );
                  })
                }
              >
                Remove server SSH key
              </Button>
            )}
          </>
        ) : (
          <p>
            Uses the Automaker server’s ssh-agent (SSH_AUTH_SOCK):{' '}
            {status?.agentAvailable ? 'available' : 'not available'}. No agent forwarding. To upload
            a key instead, save a credential ID on the global SSH profile.
          </p>
        )}
        <Button
          variant="outline"
          onClick={() =>
            void action(async () => {
              const result = await api.checkSSH(profile.id, projectPath);
              successful(result);
              setDiagnostic(result.diagnostic!);
            })
          }
        >
          Check SSH connection and prerequisites
        </Button>
        <h4>3. Prepare the remote workspace</h4>
        <Label className="flex gap-2">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
          />
          I allow remote worker installation and full access as this SSH user
        </Label>
        <Button
          disabled={!accepted || !status?.trustedHost}
          onClick={() =>
            void action(async () => {
              successful(await api.prepareSSH(profile.id));
              setMessage('Versioned SSH worker prepared. No project was copied by this action.');
            })
          }
        >
          Prepare saved SSH worker
        </Button>
        {projectPath && (
          <>
            <p>
              The local project remains control-plane metadata. The remote checkout is
              authoritative: no background sync and no automatic push. New chat sessions use
              separate remote Git worktrees.
            </p>
            <Label htmlFor={`ssh-source-${profile.id}`}>Initial remote checkout</Label>
            <select
              className="rounded-md border bg-background p-2 text-sm w-full"
              id={`ssh-source-${profile.id}`}
              value={method}
              onChange={(event) => setMethod(event.target.value as typeof method)}
            >
              <option value="import">Explicitly transfer this local project once</option>
              <option value="clone">Clone a repository on the SSH host</option>
              <option value="existing">Use an existing clean remote Git checkout</option>
            </select>
            {method === 'import' && (
              <p>
                Transfer preserves Git history and creates a new remote snapshot commit containing
                local source changes/untracked/ignored files, which may include project secrets.
                node_modules, .worktrees and Automaker metadata are excluded. Nothing is pushed;
                install dependencies remotely. Pause local editing during this one-time transfer.
              </p>
            )}
            {method === 'clone' && (
              <>
                <Label htmlFor={`ssh-repo-${profile.id}`}>
                  Repository URL (HTTPS or ssh://, no embedded password)
                </Label>
                <Input
                  id={`ssh-repo-${profile.id}`}
                  value={repositoryUrl}
                  onChange={(event) => setRepositoryUrl(event.target.value)}
                />
                <p>
                  Repository authentication must already work on the remote host; the controller SSH
                  key is not forwarded to Git.
                </p>
              </>
            )}
            {method === 'existing' && (
              <>
                <Label htmlFor={`ssh-existing-${profile.id}`}>
                  Existing remote repository path
                </Label>
                <Input
                  id={`ssh-existing-${profile.id}`}
                  value={remotePath}
                  onChange={(event) => setRemotePath(event.target.value)}
                />
                <p>
                  Use a clean, writable Git repository root. Existing source is not overwritten.
                </p>
              </>
            )}
            <Button
              disabled={
                !accepted ||
                !status?.trustedHost ||
                (method === 'clone' && !repositoryUrl) ||
                (method === 'existing' && !remotePath)
              }
              onClick={() =>
                void action(async () => {
                  const source =
                    method === 'clone'
                      ? { method, repositoryUrl }
                      : method === 'existing'
                        ? { method, remotePath }
                        : { method };
                  successful(await api.prepareSSHProject(profile.id, projectPath, source));
                  setMessage(
                    'Authoritative remote checkout prepared. Start a new Direct, Cursor, Gemini or OpenCode chat/feature; existing bindings are unchanged. CLI providers require remote installation and authentication.'
                  );
                })
              }
            >
              Prepare authoritative SSH checkout
            </Button>
            {status?.project && (
              <div role="status">
                <p>
                  Remote checkout: <code className="break-all">{status.project.remotePath}</code> (
                  {status.project.preparing ? 'preparation incomplete' : 'prepared'}).
                </p>
                {status.project.stagingPath && (
                  <p>
                    Preparation staging: <code>{status.project.stagingPath}</code>. It is not
                    deleted automatically.
                  </p>
                )}
              </div>
            )}
            {!!status?.project?.pendingOperations && (
              <div role="alert" className="space-y-2">
                <p>
                  {status.project.pendingOperations} SSH operations have an unknown outcome. Inspect
                  remote files/processes first. Recovery checks completion/cancellation and does not
                  replay or roll back commands.
                </p>
                <Label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  I inspected the remote effects and acknowledge recovery
                </Label>
                <Button
                  disabled={!acknowledged}
                  onClick={() =>
                    void action(async () => {
                      successful(await api.recoverSSH(profile.id, projectPath));
                      setAcknowledged(false);
                      setMessage('SSH operation state recovered without command replay.');
                    })
                  }
                >
                  Verify and acknowledge SSH recovery
                </Button>
              </div>
            )}
          </>
        )}
      </fieldset>
      {busy && (
        <p role="status">SSH operation in progress… Initial transfers can take several minutes.</p>
      )}
      {diagnostic && (
        <div role="status">
          <p>
            SSH: {diagnostic.status}. {diagnostic.message}
          </p>
          <p>
            Worker: {diagnostic.worker}. Checkout: {diagnostic.project}.
          </p>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
