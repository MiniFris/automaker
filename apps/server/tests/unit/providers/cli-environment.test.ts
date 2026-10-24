import { afterEach, describe, expect, it, vi } from 'vitest';
import { CursorProvider } from '@/providers/cursor-provider.js';
import { GeminiProvider } from '@/providers/gemini-provider.js';
import { OpencodeProvider } from '@/providers/opencode-provider.js';
import type { SubprocessOptions } from '@automaker/platform';
import type { ExecuteOptions } from '@/providers/types.js';
import { createProviderRegistrations } from '@/modules/providers/provider-registrations.js';
import { SettingsService } from '@/services/settings-service.js';
import {
  issueEnvironment,
  type ExecutionEnvironment,
} from '@/services/execution-environment/runtime.js';

class CursorProbe extends CursorProvider {
  run(options: SubprocessOptions, execution = {} as ExecuteOptions) {
    return this.streamProcess(execution, options);
  }
}
class GeminiProbe extends GeminiProvider {
  run(options: SubprocessOptions, execution = {} as ExecuteOptions) {
    return this.streamProcess(execution, options);
  }
}
class OpencodeProbe extends OpencodeProvider {
  run(options: SubprocessOptions, execution = {} as ExecuteOptions) {
    return this.streamProcess(execution, options);
  }
}

const child: SubprocessOptions = {
  command: process.execPath,
  args: [
    '-e',
    'console.log(JSON.stringify({key:process.env.OPENAI_API_KEY??null,other:process.env.ANTHROPIC_API_KEY??null,override:process.env.PROVIDER_OVERRIDE??null}))',
  ],
  timeout: 5000,
};

async function collect(stream: AsyncGenerator<unknown>) {
  const events: unknown[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

afterEach(() => vi.unstubAllEnvs());

it.each(['cursor', 'gemini', 'opencode', 'copilot'])(
  'wires the application environment into the production %s factory',
  async (name) => {
    const snapshot = Object.freeze({ OPENAI_API_KEY: 'factory-fixture' });
    const environment = vi.fn(async () => snapshot);
    const registration = createProviderRegistrations(
      new SettingsService('/unused-cli-environment-fixture'),
      environment
    ).find((entry) => entry.name === name)!;
    const adapter = registration.create() as unknown as {
      readEnvironment(): Promise<NodeJS.ProcessEnv>;
    };
    expect(await adapter.readEnvironment()).toEqual(snapshot);
    expect(environment).toHaveBeenCalledTimes(1);
  }
);

describe.each([CursorProbe, GeminiProbe, OpencodeProbe])(
  '%s application environment',
  (Provider) => {
    it('does not read or forward host application credentials to an issued remote runtime', async () => {
      const environment = vi.fn(async () => {
        throw new Error('Host credentials must not be read');
      });
      const runProcess = vi.fn<NonNullable<ExecutionEnvironment['runProcess']>>(
        async (_request, _signal, output) => {
          output('stdout', Buffer.from('{"remote":true}\n'));
          return { exitCode: 0 };
        }
      );
      const runtime = issueEnvironment({
        type: 'ssh',
        runProcess,
      } as unknown as ExecutionEnvironment);
      const provider = new Provider({}, environment);
      expect(
        await collect(
          provider.run(child, { executionEnvironmentRuntime: runtime } as ExecuteOptions)
        )
      ).toEqual([{ remote: true }]);
      expect(environment).not.toHaveBeenCalled();
      expect(runProcess.mock.calls[0][0]).not.toHaveProperty('env');
    });

    it('isolates parallel applications and never inherits an omitted host secret', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'host-openai-fixture');
      vi.stubEnv('ANTHROPIC_API_KEY', 'host-anthropic-fixture');
      const first = new Provider({}, async () => ({ OPENAI_API_KEY: 'app-one-fixture' }));
      const second = new Provider({}, async () => ({}));
      const results = await Promise.all([collect(first.run(child)), collect(second.run(child))]);
      expect(results).toEqual([
        [{ key: 'app-one-fixture', other: null, override: null }],
        [{ key: null, other: null, override: null }],
      ]);
      expect(process.env.OPENAI_API_KEY).toBe('host-openai-fixture');
      expect(process.env.ANTHROPIC_API_KEY).toBe('host-anthropic-fixture');
    });

    it('refreshes the snapshot after deletion without mutating it and preserves provider overrides', async () => {
      let snapshot: Readonly<NodeJS.ProcessEnv> = Object.freeze({
        OPENAI_API_KEY: 'managed-fixture',
      });
      const environment = vi.fn(async () => snapshot);
      const provider = new Provider({}, environment);
      const options = { ...child, env: { PROVIDER_OVERRIDE: 'enabled' } };
      expect(await collect(provider.run(options))).toEqual([
        { key: 'managed-fixture', other: null, override: 'enabled' },
      ]);
      snapshot = Object.freeze({});
      expect(await collect(provider.run(options))).toEqual([
        { key: null, other: null, override: 'enabled' },
      ]);
      expect(environment).toHaveBeenCalledTimes(2);
      expect(options.env).toEqual({ PROVIDER_OVERRIDE: 'enabled' });
    });

    it('refuses execution when the application environment cannot be read', async () => {
      const provider = new Provider({}, async () => {
        throw new Error('Private settings are unavailable.');
      });
      await expect(collect(provider.run(child))).rejects.toThrow(
        'Private settings are unavailable.'
      );
    });
  }
);
