import path from 'node:path';
import { createNestApplication } from '../../src/main.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { ExecutionEnvironmentSettingsService } from '../../src/modules/settings/execution-environment-settings.service.js';
import type { ManagedDocker } from '../../src/services/execution-environment/docker.js';
import type { ManagedSSH } from '../../src/services/execution-environment/ssh.js';
import type { DockerDiagnosticRunner } from '../../src/services/execution-environment/docker-diagnostics.js';

/** Private files, disabled startup integrations, no registered vendor providers. */
export async function nativeSettings(directory: string, environment: NodeJS.ProcessEnv = {}) {
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: directory,
    dataDir: path.join(directory, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      ...environment,
      NODE_ENV: 'test',
      HOME: directory,
      ALLOWED_ROOT_DIRECTORY: directory,
      AUTOMAKER_DISABLE_AUTH: 'true',
    },
  });
  const settings = runtime.app.get(SettingsService);
  const environments = runtime.app.get(ExecutionEnvironmentSettingsService);
  // Use the real use case's owned instances, never replace validation/consent or DTO producers.
  const ports = environments as unknown as { docker: ManagedDocker; ssh: ManagedSSH };
  await runtime.start();
  const origin = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}`;
  return {
    runtime,
    settings,
    environments,
    docker: ports.docker,
    ssh: ports.ssh,
    origin,
    close: () => runtime.app.close(),
  };
}
export function diagnosticRunner(
  fixture: Awaited<ReturnType<typeof nativeSettings>>,
  runner: DockerDiagnosticRunner
) {
  const check = fixture.environments.checkDocker.bind(fixture.environments);
  fixture.environments.checkDocker = (body, signal) => check(body, signal, runner);
}
