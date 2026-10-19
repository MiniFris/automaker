import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DockerConnectionDiagnostic,
  DockerPreparationResult,
  ExecutionEnvironmentProfile,
  ExecutionEnvironmentSelection,
  ExecutionEnvironmentSettings as EnvironmentSettings,
  ExecutionEnvironmentSettingsResponse,
} from '@automaker/types';
import { getHttpApiClient } from '@/lib/http-api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SSHEnvironmentSetup } from './ssh-environment-setup';
import { RemoteProviderSetup } from './remote-provider-setup';

export const ENVIRONMENT_SETTINGS_QUERY_KEY = ['settings', 'execution-environments'] as const;
const selectStyle = 'rounded-md border bg-background p-2 text-sm w-full';
function selectionValue(selection: ExecutionEnvironmentSelection | null): string {
  return selection?.mode === 'profile'
    ? `profile:${selection.profileId}`
    : (selection?.mode ?? 'inherit');
}
function parseSelection(value: string): ExecutionEnvironmentSelection | null {
  if (value === 'inherit') return null;
  return value.startsWith('profile:')
    ? { mode: 'profile', profileId: value.slice(8) }
    : { mode: value as 'local' | 'auto' };
}

export function ExecutionEnvironmentSettings({ projectPath }: { projectPath?: string }) {
  const query = useQuery({
    queryKey: [...ENVIRONMENT_SETTINGS_QUERY_KEY, projectPath ?? null],
    queryFn: async () => {
      const result = await getHttpApiClient().executionEnvironments.inspect(projectPath);
      if (!result.success)
        throw new Error(result.error || 'Unable to load execution environments.');
      return result;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  if (query.isPending) return <p>Loading execution environments…</p>;
  if (query.error || !query.data)
    return (
      <div role="alert">
        <p>Unable to load execution environments.</p>
        <Button onClick={() => void query.refetch()}>Retry</Button>
      </div>
    );
  // A different project gets a new editor; late responses cannot save to the next project.
  return (
    <EnvironmentEditor key={projectPath ?? 'global'} data={query.data} projectPath={projectPath} />
  );
}

function EnvironmentEditor({
  data,
  projectPath,
}: {
  data: ExecutionEnvironmentSettingsResponse;
  projectPath?: string;
}) {
  const client = useQueryClient();
  const [config, setConfig] = useState<EnvironmentSettings>(data.settings);
  const [selection, setSelection] = useState(
    selectionValue(projectPath ? data.projectOverride : data.settings.default)
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [diagnostic, setDiagnostic] = useState<DockerConnectionDiagnostic | null>(null);
  const [acceptedLocalRisk, setAcceptedLocalRisk] = useState(false);
  const [preparation, setPreparation] = useState<DockerPreparationResult | null>(null);
  const [acceptedPreparation, setAcceptedPreparation] = useState(false);
  useEffect(() => {
    setConfig(data.settings);
    setSelection(selectionValue(projectPath ? data.projectOverride : data.settings.default));
    setDiagnostic(null);
    setAcceptedLocalRisk(false);
    setPreparation(null);
    setAcceptedPreparation(false);
  }, [data, projectPath]);
  const api = getHttpApiClient().executionEnvironments;
  const selected = parseSelection(selection);
  const effective = projectPath && selected === null ? config.default : selected;
  const profile =
    effective?.mode === 'profile'
      ? config.profiles.find((item) => item.id === effective.profileId)
      : undefined;
  const docker = effective?.mode === 'auto' || profile?.type === 'docker';
  const resolvedLabel = data.resolved.profile?.name ?? data.resolved.type;
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Environment operation failed. Check the server connection and retry.'
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    await action(async () => {
      const result = projectPath
        ? await api.saveProject(projectPath, selected)
        : await api.saveGlobal({ ...config, default: selected! });
      if (!result.success) {
        setMessage(result.error || 'Environment settings could not be saved.');
        return;
      }
      client.setQueryData([...ENVIRONMENT_SETTINGS_QUERY_KEY, projectPath ?? null], result);
      await client.invalidateQueries({ queryKey: ENVIRONMENT_SETTINGS_QUERY_KEY });
      setMessage(
        'Environment configuration saved. Local requires explicit confirmation. Existing sessions/tasks keep their pinned environment. Docker prepares automatically; SSH requires host trust and an explicit authoritative remote checkout.'
      );
    });
  }
  async function checkDocker(profileId?: string) {
    setDiagnostic(null);
    await action(async () => {
      const result = await api.checkDocker(profileId);
      if (!result.success || !result.diagnostic) {
        setMessage(result.error || 'Docker check failed.');
        return;
      }
      setDiagnostic(result.diagnostic);
    });
  }
  function choose(value: string) {
    setSelection(value);
    setDiagnostic(null);
    setMessage('');
    const candidate = parseSelection(value) ?? config.default;
    const target =
      candidate.mode === 'profile'
        ? config.profiles.find((item) => item.id === candidate.profileId)
        : undefined;
    if (candidate.mode === 'auto') void checkDocker();
    else if (target?.type === 'docker') {
      if (
        JSON.stringify(target) !==
        JSON.stringify(data.settings.profiles.find((item) => item.id === target.id))
      )
        setMessage('Save this Docker profile before checking its connection.');
      else void checkDocker(target.id);
    }
  }
  function updateProfile(id: string, profile: ExecutionEnvironmentProfile) {
    setDiagnostic(null);
    setConfig((value) => ({
      ...value,
      profiles: value.profiles.map((item) => (item.id === id ? profile : item)),
    }));
  }
  function addProfile(type: 'docker' | 'ssh') {
    const id =
      globalThis.crypto?.randomUUID?.() ??
      `env-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const profile: ExecutionEnvironmentProfile =
      type === 'docker'
        ? { id, name: 'Project Docker', type }
        : {
            id,
            name: 'Development server',
            type,
            host: '',
            port: 22,
            username: '',
            basePath: '/projects',
          };
    setConfig((value) => ({ ...value, profiles: [...value.profiles, profile] }));
  }
  return (
    <section className="space-y-5" data-testid="execution-environment-settings">
      <div>
        <h2 className="text-xl font-semibold">Execution Environment</h2>
        <p className="text-sm text-muted-foreground">
          {projectPath
            ? 'Override the global default for this project, or inherit it.'
            : 'Choose a global default and reusable Docker / SSH profiles.'}
        </p>
      </div>
      <div
        role="note"
        className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
      >
        Direct provider supports confirmed Local and managed per-project Docker. Auto prefers
        Docker; Local fallback requires separate confirmation and is only allowed before Docker
        preparation. Explicit Docker/SSH and pinned runs never downgrade. Direct supports Docker/SSH
        chat/tools and Kanban/AutoMode with pinned worktrees, context, tests, Verify, Commit and
        feature shell hooks. Managed merge is fast-forward only; no push or sync. Git UI reads,
        stage/unstage, commit and worktree creation use the selected target. Advanced/network/PR Git
        actions and project-wide hooks are not migrated. Integrated terminals use prepared
        Docker/SSH targets (Linux/Python 3); backend restart closes the shell rather than replaying
        commands. Manual tests use the same prepared Docker/SSH target and stream logs; pinned Local
        manual tests also use the Linux/Python 3 supervisor. Managed dev servers and HTTP/WebSocket
        previews use the captured target with separate authenticated preview ports; cookies, service
        workers and cross-origin backend requests are not supported in this preview MVP. Cursor,
        Gemini and OpenCode support Docker/SSH chat and Kanban via remote CLI. Install and
        authenticate the CLI inside that environment; server credentials are not copied.
        Gemini/OpenCode read-only approval planning is not supported. Claude/Codex/Copilot support
        Docker/SSH chat and Kanban after target SDK setup. Old Docker features without workspace
        metadata require a new feature; no automatic migration occurs. Direct text-only queries do
        not execute tools. Provider sign-in/model discovery elsewhere in Settings still describes
        the Automaker server, not the remote CLI installation.
      </div>
      <p>
        Saved selection: <strong>{resolvedLabel}</strong> (
        {data.resolved.source === 'global' ? 'global default' : 'project override'}).
      </p>
      {data.resolved.type === 'auto' && (
        <section
          className="rounded-lg border p-4 space-y-3"
          aria-label="Auto fallback confirmation"
        >
          <p>
            Auto does not silently execute on the server. Optional Local fallback grants the agent
            the full filesystem, credentials, network and process rights of the Automaker OS user
            (including root if the server runs as root). It applies only to new, unbound runs when
            Docker connection or mapping preflight fails, never after preparation/command failure.
          </p>
          {data.localConsent?.autoFallbackConfirmed ? (
            <>
              <p>
                Auto Local fallback confirmed ({data.localConsent.autoFallbackScope} scope). The
                actual environment is pinned for the session/task.
              </p>
              {(!projectPath || data.localConsent.autoFallbackScope === 'project') && (
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    void action(async () => {
                      const result = await api.revokeAutoFallback(projectPath);
                      if (!result.success) {
                        setMessage(result.error || 'Could not revoke Auto fallback.');
                        return;
                      }
                      client.setQueryData(
                        [...ENVIRONMENT_SETTINGS_QUERY_KEY, projectPath ?? null],
                        result
                      );
                      await client.invalidateQueries({ queryKey: ENVIRONMENT_SETTINGS_QUERY_KEY });
                    })
                  }
                >
                  Revoke Auto Local fallback
                </Button>
              )}
              {projectPath && data.localConsent.autoFallbackScope === 'global' && (
                <p>Global fallback confirmation is inherited. Revoke it in Global Settings.</p>
              )}
            </>
          ) : (
            <>
              <Label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={acceptedLocalRisk}
                  onChange={(event) => setAcceptedLocalRisk(event.target.checked)}
                  disabled={busy}
                />
                I accept full Local access if Docker preflight is unavailable
              </Label>
              <Button
                disabled={busy || !acceptedLocalRisk}
                onClick={() =>
                  void action(async () => {
                    const result = await api.confirmAutoFallback(projectPath);
                    if (!result.success) {
                      setMessage(result.error || 'Could not confirm Auto fallback.');
                      return;
                    }
                    client.setQueryData(
                      [...ENVIRONMENT_SETTINGS_QUERY_KEY, projectPath ?? null],
                      result
                    );
                    await client.invalidateQueries({ queryKey: ENVIRONMENT_SETTINGS_QUERY_KEY });
                  })
                }
              >
                Allow Auto Local fallback
              </Button>
            </>
          )}
        </section>
      )}
      {(data.resolved.type === 'docker' || data.resolved.type === 'auto') && (
        <section className="rounded-lg border p-4 space-y-3" aria-label="Managed Docker setup">
          <h3 className="font-medium">Managed Docker setup</h3>
          <p>
            1. Check Engine access below. 2. Prepare the versioned Node/Git build image and test
            create/start/exec/remove without host mounts.{' '}
            {projectPath
              ? '3. Verify bidirectional access to this project and create/reuse its container.'
              : '3. Open Project Settings to verify that project’s shared storage.'}
          </p>
          <p>
            The first run also prepares Docker automatically. Project files/dependencies are shared
            directly, not copied. A container is reused across internal worktrees and stops after 15
            idle minutes. The agent receives no Docker socket or Automaker credentials. This is not
            whole-application isolation yet.
          </p>
          <p>
            First preparation can take several minutes and needs registry/package-network access and
            disk space. Named-volume subpaths require Engine 26+ and a compatible Docker CLI.
            Projects must live in dedicated shared storage; external worktrees are not mounted
            automatically.
          </p>
          <Label className="flex gap-2">
            <input
              type="checkbox"
              checked={acceptedPreparation}
              disabled={busy}
              onChange={(event) => setAcceptedPreparation(event.target.checked)}
            />
            Allow image download/build and temporary probe containers
            {projectPath ? ', plus this project container and temporary storage-check files' : ''}
          </Label>
          <Button
            disabled={busy || !acceptedPreparation}
            onClick={() =>
              void action(async () => {
                setPreparation(null);
                const result = await api.prepareDocker(
                  projectPath,
                  data.resolved.profile?.type === 'docker' ? data.resolved.profile.id : undefined
                );
                if (!result.success || !result.preparation) {
                  setMessage(result.error || 'Docker preparation failed.');
                  return;
                }
                setPreparation(result.preparation);
              })
            }
          >
            {busy ? 'Preparing Docker…' : 'Prepare and verify saved Docker environment'}
          </Button>
          {preparation && (
            <div role="status">
              <p>{preparation.message}</p>
              <p>
                Lifecycle: {preparation.containerLifecycle}. Project storage:{' '}
                {preparation.projectStorage}.
              </p>
            </div>
          )}
        </section>
      )}
      {data.resolved.type === 'local' && (
        <section
          className="rounded-lg border border-destructive/40 p-4 space-y-3"
          aria-label="Local execution confirmation"
        >
          <h3 className="font-medium">Local execution — no additional sandbox</h3>
          <p className="text-sm">
            The agent can read, modify and delete files, access credentials/environment variables,
            use the network, install dependencies and execute commands with the permissions of the
            Automaker server user. There is no automatic privilege elevation: if the server already
            runs as root/Administrator, the agent inherits that access. Docker installation only
            limits it to what the Automaker container can access, including mounted volumes.
          </p>
          {data.localConsent?.legacy && (
            <p className="text-sm">
              Migration: legacy Direct permissions remain active until you explicitly enable Local.
              Existing pinned sessions/tasks are not upgraded; create a new session/task to use the
              new environment.
            </p>
          )}
          {data.localConsent?.confirmed ? (
            <>
              <p>Local access confirmed ({data.localConsent.scope} scope).</p>
              {!projectPath || data.localConsent.scope === 'project' ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const result = await api.revokeLocal(projectPath);
                      if (!result.success) {
                        setMessage(result.error || 'Could not revoke Local access.');
                        return;
                      }
                      client.setQueryData(
                        [...ENVIRONMENT_SETTINGS_QUERY_KEY, projectPath ?? null],
                        result
                      );
                      await client.invalidateQueries({ queryKey: ENVIRONMENT_SETTINGS_QUERY_KEY });
                      setMessage(
                        'Local confirmation revoked. Already running requests keep their grant until completion; later requests are blocked.'
                      );
                    })
                  }
                >
                  Revoke Local confirmation
                </Button>
              ) : (
                <p className="text-sm">
                  Global confirmation is inherited. Revoke it in Global Settings if needed.
                </p>
              )}
            </>
          ) : (
            <>
              <Label className="flex gap-2 items-start">
                <input
                  type="checkbox"
                  checked={acceptedLocalRisk}
                  onChange={(event) => setAcceptedLocalRisk(event.target.checked)}
                  disabled={busy}
                />
                I understand and accept unrestricted Local execution for{' '}
                {projectPath ? 'this project' : 'all projects using Local'}.
              </Label>
              <p className="text-sm text-muted-foreground">
                Check the box, then click Enable Local execution to save your confirmation on the
                server. It persists across page reloads and container updates with the same data
                volume and OS user.
              </p>
              <Button
                disabled={busy || !acceptedLocalRisk}
                onClick={() =>
                  void action(async () => {
                    const result = await api.confirmLocal(projectPath);
                    if (!result.success) {
                      setMessage(result.error || 'Local confirmation failed.');
                      return;
                    }
                    client.setQueryData(
                      [...ENVIRONMENT_SETTINGS_QUERY_KEY, projectPath ?? null],
                      result
                    );
                    await client.invalidateQueries({ queryKey: ENVIRONMENT_SETTINGS_QUERY_KEY });
                    setMessage(
                      'Local access confirmed on the server. New Direct sessions/tasks can use Local. Existing bindings remain unchanged.'
                    );
                  })
                }
              >
                Enable Local execution
              </Button>
            </>
          )}
        </section>
      )}
      {data.resolved.profile?.type === 'ssh' && (
        <SSHEnvironmentSetup
          key={`${data.resolved.profile.id}:${projectPath ?? 'global'}`}
          profile={data.resolved.profile}
          status={data.ssh}
          projectPath={projectPath}
        />
      )}
      {data.resolved.type === 'missing-profile' && (
        <p role="alert">
          The selected profile no longer exists. Select another profile or inherit the global
          default. There is no local fallback.
        </p>
      )}
      {['docker', 'auto', 'ssh'].includes(data.resolved.type) &&
        (projectPath ? (
          <RemoteProviderSetup
            key={`${projectPath}:${JSON.stringify(data.resolved)}`}
            projectPath={projectPath}
          />
        ) : (
          <p className="text-sm">
            Open a project’s Execution Environment settings to install SDK providers and configure
            credentials on its inherited or overridden target.
          </p>
        ))}
      <fieldset disabled={busy} className="space-y-4">
        <Label htmlFor="execution-selection">
          {projectPath ? 'Project execution environment' : 'Default execution environment'}
        </Label>
        <select
          id="execution-selection"
          className={selectStyle}
          value={selection}
          onChange={(event) => choose(event.target.value)}
        >
          {projectPath && <option value="inherit">Inherit global default</option>}
          <option value="local">Local — Automaker server environment</option>
          <option value="auto">
            Auto — prefer managed Docker; local fallback requires confirmation
          </option>
          {config.profiles.map((item) => (
            <option key={item.id} value={`profile:${item.id}`}>
              {item.name} ({item.type === 'docker' ? 'Docker' : 'SSH'})
            </option>
          ))}
          {selection.startsWith('profile:') && effective?.mode === 'profile' && !profile && (
            <option value={selection}>Missing profile: {effective.profileId}</option>
          )}
        </select>
        <p className="text-sm text-muted-foreground">
          Local uses the server OS user, not root elevation. In a container installation, Local
          means the Automaker container. SSH is remote execution, not isolation by itself.
        </p>
        {!projectPath && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => addProfile('docker')}>
                Add Docker profile
              </Button>
              <Button variant="outline" onClick={() => addProfile('ssh')}>
                Add SSH profile
              </Button>
            </div>
            {config.profiles.map((item) => (
              <section
                className="space-y-3 rounded-lg border p-4"
                key={item.id}
                aria-label={`${item.type} profile ${item.name}`}
              >
                <h3 className="font-medium">{item.type === 'docker' ? 'Docker' : 'SSH'} profile</h3>
                <Label htmlFor={`env-name-${item.id}`}>Profile name</Label>
                <Input
                  id={`env-name-${item.id}`}
                  value={item.name}
                  onChange={(event) =>
                    updateProfile(item.id, { ...item, name: event.target.value })
                  }
                />
                {item.type === 'docker' ? (
                  <>
                    <Label htmlFor={`env-context-${item.id}`}>Docker context (optional)</Label>
                    <Input
                      id={`env-context-${item.id}`}
                      placeholder="Server's configured context"
                      value={item.context ?? ''}
                      onChange={(event) => {
                        const { context: _context, ...rest } = item;
                        updateProfile(
                          item.id,
                          event.target.value ? { ...rest, context: event.target.value } : rest
                        );
                      }}
                    />
                    <p className="text-sm text-muted-foreground">
                      The context must exist on the Automaker server. Leave empty to use its Docker
                      CLI configuration. No image ID or manually created project container is
                      required.
                    </p>
                    <Button
                      variant="outline"
                      disabled={
                        !data.settings.profiles.some((saved) => saved.id === item.id) ||
                        JSON.stringify(item) !==
                          JSON.stringify(
                            data.settings.profiles.find((saved) => saved.id === item.id)
                          )
                      }
                      onClick={() => void checkDocker(item.id)}
                    >
                      Check saved Docker connection
                    </Button>
                  </>
                ) : (
                  <>
                    <Label htmlFor={`env-host-${item.id}`}>SSH host</Label>
                    <Input
                      id={`env-host-${item.id}`}
                      value={item.host}
                      onChange={(event) =>
                        updateProfile(item.id, { ...item, host: event.target.value })
                      }
                    />
                    <Label htmlFor={`env-port-${item.id}`}>SSH port</Label>
                    <Input
                      id={`env-port-${item.id}`}
                      type="number"
                      min={1}
                      max={65535}
                      value={item.port}
                      onChange={(event) =>
                        updateProfile(item.id, { ...item, port: Number(event.target.value) })
                      }
                    />
                    <Label htmlFor={`env-user-${item.id}`}>SSH user</Label>
                    <Input
                      id={`env-user-${item.id}`}
                      value={item.username}
                      onChange={(event) =>
                        updateProfile(item.id, { ...item, username: event.target.value })
                      }
                    />
                    <Label htmlFor={`env-path-${item.id}`}>Remote projects base path</Label>
                    <Input
                      id={`env-path-${item.id}`}
                      value={item.basePath}
                      onChange={(event) =>
                        updateProfile(item.id, { ...item, basePath: event.target.value })
                      }
                    />
                    <p className="text-sm text-muted-foreground">
                      Save and select this profile to configure host trust, credentials and remote
                      checkout. No connection is made by viewing or saving settings.
                    </p>
                    <Label htmlFor={`env-key-${item.id}`}>
                      SSH credential ID (empty = server ssh-agent)
                    </Label>
                    <Input
                      id={`env-key-${item.id}`}
                      value={item.credentialId ?? ''}
                      onChange={(event) => {
                        const { credentialId: _credentialId, ...rest } = item;
                        updateProfile(
                          item.id,
                          event.target.value ? { ...rest, credentialId: event.target.value } : rest
                        );
                      }}
                    />
                  </>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    if (
                      !window.confirm(
                        'Remove this profile? Projects selecting it will require a new selection; they will not fall back to Local.'
                      )
                    )
                      return;
                    setConfig((value) => ({
                      ...value,
                      profiles: value.profiles.filter((saved) => saved.id !== item.id),
                    }));
                    setDiagnostic(null);
                  }}
                >
                  Remove profile
                </Button>
              </section>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save()}>Save environment configuration</Button>
          {docker && (
            <Button
              variant="outline"
              disabled={
                profile?.type === 'docker' &&
                (!data.settings.profiles.some((saved) => saved.id === profile.id) ||
                  JSON.stringify(profile) !==
                    JSON.stringify(data.settings.profiles.find((saved) => saved.id === profile.id)))
              }
              onClick={() => void checkDocker(profile?.type === 'docker' ? profile.id : undefined)}
            >
              Check Docker access
            </Button>
          )}
        </div>
      </fieldset>
      {message && <p role="status">{message}</p>}
      {diagnostic && (
        <div role="status" className="rounded-lg border p-4 space-y-3">
          <h3 className="font-medium">Docker connection: {diagnostic.status}</h3>
          <p>{diagnostic.message}</p>
          <p>
            Container lifecycle: not tested. Project storage: not tested. Isolated execution is not
            enabled by this check.
          </p>
          <ul className="list-disc pl-5 space-y-2">
            {diagnostic.remediation.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            {diagnostic.documentation.map((link) => (
              <a
                key={link.url}
                className="underline"
                href={link.url}
                target="_blank"
                rel="noreferrer"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
