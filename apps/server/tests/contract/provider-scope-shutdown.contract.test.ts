import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { ExecuteOptions, ProviderMessage } from '../../src/providers/types.js';

it('Nest shutdown drains a registry-owned stream outside AgentService before close resolves', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-provider-scope-shutdown-'));
  let release!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  let child: AbortController | undefined;
  let closed = 0;
  class OwnedProvider extends MockProvider {
    protected async *execute(input: ExecuteOptions): AsyncGenerator<ProviderMessage> {
      child = input.abortController;
      try {
        yield {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Owned fixture response' }],
          },
        };
      } finally {
        await cleanup;
        closed++;
      }
    }
  }
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    dataDir: directory,
    runStartupTasks: false,
    enableShutdownHooks: false,
    workingDirectory: directory,
    providerRegistrations: [{ name: 'claude', create: () => new OwnedProvider('claude') }],
  });
  const registry = runtime.app.get(ProviderRegistry);
  let closing: Promise<unknown> | undefined;
  try {
    await runtime.start();
    const parent = new AbortController();
    const stream = registry.byName('claude')!.executeQuery({
      cwd: directory,
      prompt: 'Not a chat lease',
      model: 'sonnet',
      abortController: parent,
    });
    await stream.next();
    let finished = false;
    closing = runtime.app.close().then(() => {
      finished = true;
    });
    await vi.waitFor(() => expect(child?.signal.aborted).toBe(true));
    expect(finished).toBe(false);
    expect(closed).toBe(0);
    expect(parent.signal.aborted).toBe(false);
    release();
    await closing;
    expect(closed).toBe(1);
    await expect(
      registry.byName('claude')!.start({ cwd: directory, prompt: 'Never execute' }).next()
    ).rejects.toThrow('not accepting');
  } finally {
    release();
    await (closing ?? runtime.app.close());
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
