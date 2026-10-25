import { translate, useUiLocale } from '@/lib/i18n';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  useUiLocale();
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
      setMessage(error instanceof Error ? error.message : translate('SSH operation failed.'));
    } finally {
      setBusy(false);
    }
  }
  function successful(result: { success: boolean; error?: string }) {
    if (!result.success) throw new Error(result.error || 'SSH operation failed.');
  }
  return (
    <section
      aria-label={translate('SSH connection setup')}
      className="rounded-lg border p-4 space-y-4"
    >
      <h3 className="font-medium">
        {translate('SSH setup — ')}
        {profile.username}@{profile.host}:{profile.port}
      </h3>
      <p>
        {translate(
          'SSH grants the agent the remote OS user’s full filesystem, network and process rights. It is not a sandbox and never falls back to Local. Remote prerequisites: Linux, Node 22+ and Git. Server private keys and model API keys are not forwarded.'
        )}
      </p>
      <fieldset disabled={busy} className="space-y-3">
        <h4>{translate('1. Verify the host')}</h4>
        <p>
          {translate('Confirmed fingerprint: ')}
          {status?.trustedHost?.fingerprint ?? translate('not confirmed')}
        </p>
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
          {translate('Inspect SSH host fingerprint')}
        </Button>
        {candidate && (
          <div className="space-y-2" role="status">
            <p>
              {candidate.algorithm}: <code className="break-all">{candidate.fingerprint}</code>
            </p>
            <p>
              {translate(
                'Scanning does not prove identity. Compare with the server administrator or a trusted console before accepting.'
              )}
            </p>
            <Label className="flex gap-2">
              <input
                type="checkbox"
                checked={verified}
                onChange={(event) => setVerified(event.target.checked)}
              />
              {translate('I independently verified this SSH fingerprint')}
            </Label>
            {status?.trustedHost && status.trustedHost.fingerprint !== candidate.fingerprint && (
              <Label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(event) => setReplace(event.target.checked)}
                />
                {translate(
                  'Replace the trusted host key; existing pinned sessions will remain blocked'
                )}
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
                  setMessage(
                    translate('SSH fingerprint confirmed. Existing runs are not migrated.')
                  );
                })
              }
            >
              {translate('Confirm SSH fingerprint')}
            </Button>
          </div>
        )}
        <h4>{translate('2. Configure authentication')}</h4>
        {profile.credentialId ? (
          <>
            <p>
              {translate('Server credential ID: ')}
              {profile.credentialId}
              {translate('. Private key')}{' '}
              {status?.hasPrivateKey ? translate('is saved') : translate('is not saved')}
              {translate('. This credential may be shared by other profiles.')}
            </p>
            <Label htmlFor={`ssh-key-${profile.id}`}>
              {translate('SSH private key (server storage only)')}
            </Label>
            <Textarea
              id={`ssh-key-${profile.id}`}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Label htmlFor={`ssh-passphrase-${profile.id}`}>
              {translate('SSH key passphrase (optional)')}
            </Label>
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
                  setMessage(
                    translate('SSH key saved on the server; it is never returned by the API.')
                  );
                })
              }
            >
              {translate('Save SSH private key')}
            </Button>
            {status?.hasPrivateKey && (
              <Button
                variant="outline"
                onClick={() =>
                  void action(async () => {
                    successful(await api.clearSSHKey(profile.id));
                    setMessage(
                      translate(
                        'Server SSH credential removed. Later connections using it are blocked.'
                      )
                    );
                  })
                }
              >
                {translate('Remove server SSH key')}
              </Button>
            )}
          </>
        ) : (
          <p>
            {translate('Uses the Automaker server’s ssh-agent (SSH_AUTH_SOCK):')}{' '}
            {status?.agentAvailable ? translate('available') : translate('not available')}
            {translate(
              '. No agent forwarding. To upload a key instead, save a credential ID on the global SSH profile.'
            )}
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
          {translate('Check SSH connection and prerequisites')}
        </Button>
        <h4>{translate('3. Prepare the remote workspace')}</h4>
        <Label className="flex gap-2">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
          />
          {translate('I allow remote worker installation and full access as this SSH user')}
        </Label>
        <Button
          disabled={!accepted || !status?.trustedHost}
          onClick={() =>
            void action(async () => {
              successful(await api.prepareSSH(profile.id));
              setMessage(
                translate('Versioned SSH worker prepared. No project was copied by this action.')
              );
            })
          }
        >
          {translate('Prepare saved SSH worker')}
        </Button>
        {projectPath && (
          <>
            <p>
              {translate(
                'The local project remains control-plane metadata. The remote checkout is authoritative: no background sync and no automatic push. New chat sessions use separate remote Git worktrees.'
              )}
            </p>
            <Label htmlFor={`ssh-source-${profile.id}`}>
              {translate('Initial remote checkout')}
            </Label>
            <Select
              disabled={busy}
              value={method}
              onValueChange={(value) => setMethod(value as typeof method)}
            >
              <SelectTrigger id={`ssh-source-${profile.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="import">
                  {translate('Explicitly transfer this local project once')}
                </SelectItem>
                <SelectItem value="clone">
                  {translate('Clone a repository on the SSH host')}
                </SelectItem>
                <SelectItem value="existing">
                  {translate('Use an existing clean remote Git checkout')}
                </SelectItem>
              </SelectContent>
            </Select>
            {method === 'import' && (
              <p>
                {translate(
                  'Transfer preserves Git history and creates a new remote snapshot commit containing local source changes/untracked/ignored files, which may include project secrets. node_modules, .worktrees and Automaker metadata are excluded. Nothing is pushed; install dependencies remotely. Pause local editing during this one-time transfer.'
                )}
              </p>
            )}
            {method === 'clone' && (
              <>
                <Label htmlFor={`ssh-repo-${profile.id}`}>
                  {translate('Repository URL (HTTPS or ssh://, no embedded password)')}
                </Label>
                <Input
                  id={`ssh-repo-${profile.id}`}
                  value={repositoryUrl}
                  onChange={(event) => setRepositoryUrl(event.target.value)}
                />
                <p>
                  {translate(
                    'Repository authentication must already work on the remote host; the controller SSH key is not forwarded to Git.'
                  )}
                </p>
              </>
            )}
            {method === 'existing' && (
              <>
                <Label htmlFor={`ssh-existing-${profile.id}`}>
                  {translate('Existing remote repository path')}
                </Label>
                <Input
                  id={`ssh-existing-${profile.id}`}
                  value={remotePath}
                  onChange={(event) => setRemotePath(event.target.value)}
                />
                <p>
                  {translate(
                    'Use a clean, writable Git repository root. Existing source is not overwritten.'
                  )}
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
                    translate(
                      'Authoritative remote checkout prepared. Start a new Direct, Cursor, Gemini or OpenCode chat/feature; existing bindings are unchanged. CLI providers require remote installation and authentication.'
                    )
                  );
                })
              }
            >
              {translate('Prepare authoritative SSH checkout')}
            </Button>
            {status?.project && (
              <div role="status">
                <p>
                  {translate('Remote checkout: ')}
                  <code className="break-all">{status.project.remotePath}</code> (
                  {status.project.preparing
                    ? translate('preparation incomplete')
                    : translate('prepared')}
                  ).
                </p>
                {status.project.stagingPath && (
                  <p>
                    {translate('Preparation staging: ')}
                    <code>{status.project.stagingPath}</code>
                    {translate('. It is not deleted automatically.')}
                  </p>
                )}
              </div>
            )}
            {!!status?.project?.pendingOperations && (
              <div role="alert" className="space-y-2">
                <p>
                  {status.project.pendingOperations}{' '}
                  {translate(
                    ' SSH operations have an unknown outcome. Inspect remote files/processes first. Recovery checks completion/cancellation and does not replay or roll back commands.'
                  )}
                </p>
                <Label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  {translate('I inspected the remote effects and acknowledge recovery')}
                </Label>
                <Button
                  disabled={!acknowledged}
                  onClick={() =>
                    void action(async () => {
                      successful(await api.recoverSSH(profile.id, projectPath));
                      setAcknowledged(false);
                      setMessage(
                        translate('SSH operation state recovered without command replay.')
                      );
                    })
                  }
                >
                  {translate('Verify and acknowledge SSH recovery')}
                </Button>
              </div>
            )}
          </>
        )}
      </fieldset>
      {busy && (
        <p role="status">
          {translate('SSH operation in progress… Initial transfers can take several minutes.')}
        </p>
      )}
      {diagnostic && (
        <div role="status">
          <p>
            {translate('SSH: ')}
            {diagnostic.status}
            {translate('. ')}
            {diagnostic.message}
          </p>
          <p>
            {translate('Worker: ')}
            {diagnostic.worker}
            {translate('. Checkout: ')}
            {diagnostic.project}.
          </p>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
