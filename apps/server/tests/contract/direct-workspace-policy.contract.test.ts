import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import * as platform from '@automaker/platform';
import { afterEach, expect, it, vi } from 'vitest';
import { toDirectModelId, type ProviderMessage } from '@automaker/types';
import { createNestApplication } from '../../src/main.js';
import { HOST_ENVIRONMENT } from '../../src/core/config/index.js';
import { SecurityService } from '../../src/core/security/security.service.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { DirectWorkspaceAccess } from '../../src/modules/providers/direct-workspace-access.js';
import {
  prepareDirectExecution,
  runDirectShellCommand,
} from '../../src/providers/openai-compatible/execution.js';

const applications: Awaited<ReturnType<typeof createNestApplication>>[] = [];
const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  const results = await Promise.allSettled(applications.splice(0).map(({ app }) => app.close()));
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
          )
      )
  );
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
});
const model = toDirectModelId('Fixture/Read');
async function fixture(name: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `direct-workspace-${name}-`));
  roots.push(root);
  const data = path.join(root, 'private-server-state');
  await fs.writeFile(path.join(root, 'allowed.txt'), `${name}-project`);
  await fs.mkdir(path.join(root, '.automaker'));
  await fs.writeFile(path.join(root, '.automaker', 'metadata.txt'), 'private-metadata');
  const calls: unknown[] = [];
  const outputs: unknown[] = [];
  let tool = { name: 'Read', arguments: JSON.stringify({ path: 'allowed.txt' }) };
  const upstream = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      calls.push(body);
      const last = body.messages.at(-1);
      response.setHeader('content-type', 'application/json');
      if (last.role === 'tool') {
        outputs.push(JSON.parse(last.content));
        response.end(
          JSON.stringify({
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Offline tool completed' },
                finish_reason: 'stop',
              },
            ],
          })
        );
      } else
        response.end(
          JSON.stringify({
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [{ id: 'fixture-read', type: 'function', function: tool }],
                },
                finish_reason: 'tool_calls',
              },
            ],
          })
        );
    })().catch(() => {
      response.statusCode = 500;
      response.end('{}');
    });
  });
  servers.push(upstream);
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: root,
    dataDir: data,
    runStartupTasks: false,
    enableShutdownHooks: false,
    environment: {
      NODE_ENV: 'test',
      HOME: root,
      ALLOWED_ROOT_DIRECTORY: root,
      AUTOMAKER_API_KEY: `fixture-${name}`,
    },
  });
  applications.push(runtime);
  await runtime.start();
  const settings = runtime.app.get(SettingsService);
  await settings.updateGlobalSettings({
    openaiCompatibleEndpoints: [
      {
        id: 'offline',
        name: 'Offline',
        enabled: true,
        baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`,
        protocol: 'chat-completions',
        auth: { type: 'none' },
        models: [
          {
            id: 'Fixture/Read',
            displayName: 'Fixture',
            capabilities: { tools: true, streaming: false },
          },
        ],
      },
    ],
  });
  // Use the real native default registration, not a test-created provider or policy.
  const provider = runtime.app.get(ProviderRegistry).providerForModel(model);
  const host = runtime.app.get<Readonly<NodeJS.ProcessEnv>>(HOST_ENVIRONMENT);
  async function query(cwd: string, name = 'Read', args: unknown = { path: 'allowed.txt' }) {
    tool = { name, arguments: JSON.stringify(args) };
    const prepared = await prepareDirectExecution(
      {
        model,
        prompt: 'Read private fixture',
        cwd,
        tools: [name],
        abortController: new AbortController(),
      },
      settings,
      { model, providerId: 'offline', projectPath: root },
      'agent',
      host
    );
    expect(prepared.executionEnvironmentBinding?.type).toBe('legacy');
    expect(prepared.executionEnvironmentRuntime).toBeUndefined();
    const messages: ProviderMessage[] = [];
    for await (const message of provider.executeQuery(prepared)) messages.push(message);
    return messages;
  }
  return { root, data, runtime, settings, host, calls, outputs, query };
}
function expectDenied(messages: ProviderMessage[]) {
  expect(
    messages.some(
      (message) => message.type === 'error' && message.error?.includes('Workspace is unavailable')
    )
  ).toBe(true);
  expect(
    messages.some((message) => message.type === 'result' && message.subtype === 'success')
  ).toBe(false);
}
it.skipIf(process.platform !== 'linux')(
  'native legacy Direct read tools isolate two app roots and protected data despite hostile globals and ambient changes',
  async () => {
    const one = await fixture('one'),
      two = await fixture('two');
    vi.stubEnv('DATA_DIR', '/hostile-ambient-data');
    vi.stubEnv('ALLOWED_ROOT_DIRECTORY', '/hostile-ambient-root');
    vi.spyOn(platform, 'getAllowedRootDirectory').mockReturnValue(two.root);
    vi.spyOn(platform, 'getDataDirectory').mockReturnValue('/hostile-global-data');
    vi.spyOn(platform, 'validatePath').mockImplementation((candidate) => path.resolve(candidate));
    for (const [own, other] of [
      [one, two],
      [two, one],
    ]) {
      expect((await own.query(own.root)).at(-1)).toMatchObject({
        type: 'result',
        subtype: 'success',
      });
      expect(own.outputs.at(-1)).toMatchObject({
        ok: true,
        result: { content: own === one ? 'one-project' : 'two-project' },
      });
      const before = own.calls.length;
      expectDenied(await own.query(other.root));
      expect(own.calls.length).toBe(before);
      // The backend may access its private storage through SecurityService's data exception;
      // model workspace selection must still deny this root before any upstream request.
      expect(own.runtime.app.get(SecurityService).validateLocalPath(own.data)).toBe(own.data);
      expectDenied(await own.query(own.data));
      expect(own.calls.length).toBe(before);
      for (const file of ['private-server-state/.api-key', '.automaker/metadata.txt']) {
        await own.query(own.root, 'Read', { path: file });
        expect(own.outputs.at(-1)).toMatchObject({ ok: false, error: { code: 'PATH_DENIED' } });
      }
      await own.query(own.root, 'LS', { path: '.' });
      expect(JSON.stringify(own.outputs.at(-1))).not.toContain('private-server-state');
    }
    await one.runtime.app.close();
    expect((await two.query(two.root)).at(-1)).toMatchObject({
      type: 'result',
      subtype: 'success',
    });
    expect(two.outputs.at(-1)).toMatchObject({ ok: true, result: { content: 'two-project' } });
  }
);
it.skipIf(process.platform !== 'linux')(
  'legacy automatic shell fallback validates native workspace policy before creating any Docker shell tool',
  async () => {
    const own = await fixture('shell');
    await own.settings.updateGlobalSettings({
      openaiCompatibleAgentSettings: {
        access: 'read-only',
        shell: { backend: 'docker', image: `sha256:${'0'.repeat(64)}`, executable: 'sh' },
      },
    });
    const policy = own.runtime.app.get(DirectWorkspaceAccess);
    await expect(
      runDirectShellCommand(
        own.settings,
        own.data,
        'echo must-not-run',
        new AbortController().signal,
        undefined,
        own.host,
        policy
      )
    ).rejects.toThrow('Workspace is unavailable');
    expect(own.calls).toHaveLength(0);
  }
);
