import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  NodeCodexCredentialRuntime,
  spawnCodexCredentialProcess,
} from '../../src/core/platform/codex-credential.runtime.js';
import type { RuntimePathsService } from '../../src/core/config/index.js';

it('reads metadata/token through the actual pinned CLI auth RPC without creating an agent turn', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-codex-credential-'));
  const key = 'sk-offline-credential-fixture-123456';
  await writeFile(path.join(directory, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: key }), {
    mode: 0o600,
  });
  const runtime = new NodeCodexCredentialRuntime(
    { PATH: process.env.PATH, CODEX_HOME: directory },
    { resolveFromWorkingDirectory: () => directory } as RuntimePathsService,
    spawnCodexCredentialProcess
  );
  try {
    const metadata = await runtime.read(false, new AbortController());
    expect(metadata).toEqual({ kind: 'api-key' });
    expect(JSON.stringify(metadata)).not.toContain(key);
    expect(await runtime.read(true, new AbortController())).toEqual({
      kind: 'api-key',
      token: key,
    });
  } finally {
    await runtime.onApplicationShutdown();
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
