import { spawn } from 'node:child_process';
import type { DockerConnectionDiagnostic, DockerConnectionStatus } from '@automaker/types';

export interface DockerCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  errorCode?: string;
  truncated?: boolean;
}
export type DockerDiagnosticRunner = (
  args: string[],
  signal: AbortSignal
) => Promise<DockerCommandResult>;

/** Read-only probe; no shell, elevation, image pulls, or container mutations. */
export const runDockerDiagnostic: DockerDiagnosticRunner = (args, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ code: null, stdout: '', stderr: '' });
      return;
    }
    const grouped = process.platform !== 'win32';
    const child = spawn('docker', args, {
      shell: false,
      detached: grouped,
      windowsHide: true,
      env: { ...process.env, DOCKER_CLI_HINTS: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let errorCode: string | undefined;
    let truncated = false;
    const stop = () => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* Already stopped or never started. */
      }
    };
    const consume = (chunk: Buffer, output: 'stdout' | 'stderr') => {
      const available = Math.max(0, 32_768 - bytes);
      const part = chunk.subarray(0, available).toString('utf8');
      if (output === 'stdout') stdout += part;
      else stderr += part;
      bytes += chunk.length;
      if (bytes > 32_768) {
        truncated = true;
        stop();
      }
    };
    child.stdout.on('data', (chunk: Buffer) => consume(chunk, 'stdout'));
    child.stderr.on('data', (chunk: Buffer) => consume(chunk, 'stderr'));
    child.on('error', (error: NodeJS.ErrnoException) => {
      errorCode = error.code ?? 'UNKNOWN';
    });
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    child.on('close', (code) => {
      signal.removeEventListener('abort', stop);
      resolve({ code, stdout, stderr, errorCode, truncated });
    });
  });

const messages: Record<DockerConnectionStatus, string> = {
  available:
    'Docker Engine API is reachable from the Automaker server. Container creation and project storage have NOT been tested.',
  'client-missing': 'Docker CLI is not installed or is not on the Automaker server PATH.',
  'permission-denied':
    'The Automaker server user does not have permission to access Docker Engine.',
  unreachable:
    'Docker Engine could not be reached. Check that the daemon is running and the connection is configured.',
  'context-unavailable': 'The selected Docker context could not be loaded on the Automaker server.',
  timeout: 'The Docker connection check timed out.',
  cancelled: 'The Docker connection check was cancelled.',
  'invalid-response':
    'Docker returned an invalid or oversized response; availability could not be verified.',
  unavailable: 'Docker connection check failed. Check the server-side Docker configuration.',
};

export async function diagnoseDockerConnection(
  context?: string,
  signal?: AbortSignal,
  runner: DockerDiagnosticRunner = runDockerDiagnostic
): Promise<DockerConnectionDiagnostic> {
  // Context is data, never arbitrary CLI options or an SSH command.
  if (context !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(context))
    throw new Error('Invalid Docker context.');
  const deadline = AbortSignal.timeout(8_000);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let result: DockerCommandResult;
  try {
    result = await runner(
      [...(context ? ['--context', context] : []), 'info', '--format', '{{json .ServerVersion}}'],
      combined
    );
  } catch {
    result = { code: null, stdout: '', stderr: '' };
  }
  let status: DockerConnectionStatus = 'unavailable';
  if (signal?.aborted) status = 'cancelled';
  else if (deadline.aborted) status = 'timeout';
  else if (result.errorCode === 'ENOENT') status = 'client-missing';
  else if (
    result.errorCode === 'EACCES' ||
    /permission denied|access is denied|operation not permitted|authorization denied|forbidden/i.test(
      result.stderr
    )
  )
    status = 'permission-denied';
  else if (result.truncated) status = 'invalid-response';
  else if (
    /context.*(?:not found|does not exist|unable to resolve|unable to find)|context.*(?:open|load).*no such file/i.test(
      result.stderr
    )
  )
    status = 'context-unavailable';
  else if (
    /cannot connect|connection refused|no such host|no such file|error during connect|network is unreachable|failed to connect/i.test(
      result.stderr
    )
  )
    status = 'unreachable';
  else if (result.code === 0) {
    try {
      const version: unknown = JSON.parse(result.stdout);
      status =
        typeof version === 'string' && /^[0-9][a-zA-Z0-9.+_-]{0,100}$/.test(version)
          ? 'available'
          : 'invalid-response';
    } catch {
      status = 'invalid-response';
    }
  }
  const serverContainerized = process.env.IS_CONTAINERIZED === 'true';
  const remediation = serverContainerized
    ? [
        'Automaker runs in a container. Install the Docker CLI in the server image and explicitly configure its Engine connection; IS_CONTAINERIZED=true does not grant access.',
        'For a local Unix socket, mount the actual daemon socket into the SERVER container and grant the Automaker process its numeric socket-group permissions (Compose group_add). Recreate the server after configuration changes.',
        'The current Automaker entrypoint uses gosu, which can reset supplementary groups. Ensure the target automaker user belongs to the socket group inside the server image; Compose group_add alone may not survive this user switch.',
        'Rootless Docker and Docker Desktop may use a different socket path. Do not assume /var/run/docker.sock exists.',
      ]
    : process.platform === 'linux'
      ? [
          'Install/start Docker Engine, or configure an existing rootless Engine.',
          'Grant access to the OS account running the Automaker SERVER, not merely the browser/login user. For rootful Docker, configure docker-group membership and restart the Automaker service/session.',
        ]
      : [
          'Start Docker Desktop or your configured Docker Engine and verify the selected context under the OS account running the Automaker SERVER.',
        ];
  remediation.push(
    'Configure the context on the Automaker server. For remote engines use SSH or authenticated TLS; never expose an unauthenticated TCP API.',
    'Docker Engine access can grant host-level privileges. Do not use chmod 666, privileged mode, or pass the Docker socket into project-agent containers.',
    'Check again after updating the server configuration. This probe does not create containers, install Docker, or change permissions.',
    'Project paths are resolved on the daemon host. A separate storage/lifecycle check is required before isolated execution can be enabled.'
  );
  return {
    status,
    checkedAt: new Date().toISOString(),
    scope: 'connection-only',
    containerLifecycle: 'not-tested',
    projectStorage: 'not-tested',
    platform: process.platform,
    serverContainerized,
    message: messages[status],
    remediation,
    documentation: [
      {
        label: 'Docker installation and permissions',
        url: 'https://docs.docker.com/engine/install/linux-postinstall/',
      },
      {
        label: 'SSH / TLS Engine access',
        url: 'https://docs.docker.com/engine/security/protect-access/',
      },
      {
        label: 'Daemon-side project mounts',
        url: 'https://docs.docker.com/engine/storage/bind-mounts/',
      },
    ],
  };
}
