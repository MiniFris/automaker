import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { executeCodexSdkQuery } from '../../src/providers/codex-sdk-client.js';

it('passes separate keys to simultaneous real SDK/CLI children without changing process.env', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-codex-sdk-context-'));
  const before = { ...process.env };
  const requests: Array<{ authorization: string | undefined; response: ServerResponse }> = [];
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* Drain the offline query body. */
    }
    requests.push({ authorization: request.headers.authorization, response });
    if (requests.length === 2) {
      for (const item of requests) {
        item.response.writeHead(400, { 'Content-Type': 'application/json' });
        item.response.end(
          JSON.stringify({
            error: {
              message: 'Offline fixture rejection',
              type: 'invalid_request_error',
              code: 'fixture',
            },
          })
        );
      }
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const controllers = [new AbortController(), new AbortController()];
  const timer = setTimeout(() => controllers.forEach((controller) => controller.abort()), 10000);
  try {
    const execute = async (index: number) => {
      const profile = path.join(directory, String(index));
      await mkdir(profile);
      await writeFile(
        path.join(profile, 'config.toml'),
        [
          'model_provider="offline"',
          'notify=[]',
          'project_doc_max_bytes=0',
          '[model_providers.offline]',
          'name="Offline fixture"',
          `base_url="http://127.0.0.1:${port}/v1"`,
          'env_key="CODEX_API_KEY"',
          'wire_api="responses"',
          'requires_openai_auth=false',
          'request_max_retries=0',
          'stream_max_retries=0',
          '[features]',
          'remote_models=false',
          'shell_snapshot=false',
        ].join('\n')
      );
      const messages = [];
      for await (const message of executeCodexSdkQuery(
        {
          prompt: 'Offline credential context test',
          model: 'gpt-5.2-codex',
          cwd: directory,
          abortController: controllers[index],
          allowedTools: [],
        },
        null,
        {
          apiKey: `sk-offline-context-${index}-private`,
          environment: {
            PATH: process.env.PATH,
            CODEX_HOME: profile,
            OPENAI_API_KEY: 'wrong-context-key',
            CODEX_API_KEY: 'wrong-context-key',
          },
        }
      ))
        messages.push(message);
      return messages;
    };
    const results = await Promise.all([execute(0), execute(1)]);
    expect(requests.map((request) => request.authorization).sort()).toEqual([
      'Bearer sk-offline-context-0-private',
      'Bearer sk-offline-context-1-private',
    ]);
    expect(results.every((messages) => messages.some((message) => message.type === 'error'))).toBe(
      true
    );
    expect(process.env).toEqual(before);
  } finally {
    clearTimeout(timer);
    controllers.forEach((controller) => controller.abort());
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
