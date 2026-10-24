import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import type { RuntimePathsService } from '../../../src/core/config/index.js';
import { NodeCodexCredentialRuntime } from '../../../src/core/platform/codex-credential.runtime.js';

const fixtureFile = fileURLToPath(new URL('../../fixtures/codex-auth-peer.mjs', import.meta.url));
function fixture(mode = 'success') {
  let child!: ChildProcessWithoutNullStreams;
  const launch = vi.fn(
    (cwd, environment) =>
      (child = spawn(process.execPath, [fixtureFile, mode], {
        cwd,
        env: environment,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      }))
  );
  const runtime = new NodeCodexCredentialRuntime(
    { OPENAI_API_KEY: 'private-bootstrap', CODEX_API_KEY: 'private-bootstrap' },
    { resolveFromWorkingDirectory: () => process.cwd() } as RuntimePathsService,
    launch
  );
  return { runtime, launch, child: () => child };
}
it('returns only metadata and reaps the process even if a peer returns an unsolicited token', async () => {
  const { runtime, launch, child } = fixture('metadata-leak');
  expect(await runtime.read(false, new AbortController())).toEqual({ kind: 'api-key' });
  expect(launch.mock.calls[0][1].OPENAI_API_KEY).toBeUndefined();
  expect(launch.mock.calls[0][1].CODEX_API_KEY).toBeUndefined();
  expect(child().exitCode !== null || child().signalCode !== null).toBe(true);
  await runtime.onApplicationShutdown();
});
it('reads a token only through the opt-in auth RPC and closes its child', async () => {
  const { runtime, child } = fixture();
  expect(await runtime.read(true, new AbortController())).toEqual({
    kind: 'api-key',
    token: 'sk-offline-token-fixture-123',
  });
  expect(child().exitCode !== null || child().signalCode !== null).toBe(true);
});
it.each(['malformed', 'flood', 'unexpected-request'])(
  'fails closed and reaps a %s peer without exposing diagnostics',
  async (mode) => {
    const { runtime, child } = fixture(mode);
    await expect(runtime.read(true, new AbortController())).rejects.toThrow(
      'Codex CLI credentials could not be read.'
    );
    expect(child().exitCode !== null || child().signalCode !== null).toBe(true);
  }
);
it.each(['hang-init', 'hang-token', 'ignore-term'])(
  'cancels a %s child and waits for actual process exit',
  async (mode) => {
    const { runtime, child } = fixture(mode);
    const controller = new AbortController();
    const pending = runtime.read(true, controller);
    const failure = expect(pending).rejects.toThrow('Codex CLI credentials could not be read.');
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    await failure;
    expect(child().exitCode !== null || child().signalCode !== null).toBe(true);
  }
);
it('aborts accepted metadata reads during shutdown and closes admission', async () => {
  const { runtime, child } = fixture('hang-init');
  const pending = runtime.read(false, new AbortController());
  const failure = expect(pending).rejects.toThrow();
  await runtime.onApplicationShutdown();
  await failure;
  expect(child().exitCode !== null || child().signalCode !== null).toBe(true);
  await expect(runtime.read(false, new AbortController())).rejects.toThrow('unavailable');
});
