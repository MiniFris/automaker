import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { ProviderInstallGuidanceSchema } from '@automaker/contracts';
import { ProviderInstallGuidanceService } from '../../../src/modules/providers/provider-install-guidance.service.js';
import { ProviderConnectionCommandService } from '../../../src/modules/providers/provider-connection-command.service.js';
import { ProviderConnectionRepository } from '../../../src/modules/providers/provider-connection.repository.js';

it('only reads app identity, leaves the host untouched and respects closed admission', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-guidance-unit-'));
  try {
    const unused = new Proxy(
      {},
      {
        get() {
          throw new Error('Guidance must not inspect runtime or secrets');
        },
      }
    );
    const repository = ProviderConnectionRepository.forWorkingDirectory(directory);
    const connections = new ProviderConnectionCommandService(
      repository,
      unused as never,
      unused as never
    );
    const service = new ProviderInstallGuidanceService(connections);
    for (const provider of ['claude', 'codex'] as const) {
      const guidance = ProviderInstallGuidanceSchema.parse(service.instructions(provider));
      expect(guidance.target).toEqual(repository.target(provider));
      expect(guidance.installationPerformed).toBe(false);
      expect(guidance.success).toBe(provider === 'codex');
    }
    expect(await readdir(directory)).toEqual([]);
    await connections.beforeApplicationShutdown();
    expect(() => service.instructions('claude')).toThrow();
    expect(await readdir(directory)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
