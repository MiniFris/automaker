import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Codex } from '@openai/codex-sdk';
import { expect, it } from 'vitest';

it('proves the pinned Codex exec configuration is not a no-tools verifier against an offline-only upstream', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-codex-probe-'));
  const requests: Array<{ tools?: Array<{ type: string; name?: string }> }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        error: {
          message: 'Offline fixture rejection',
          type: 'invalid_request_error',
          code: 'fixture',
        },
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const controller = new AbortController();
  let fixtureFailure = '';
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const sdk = new Codex({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'sk-offline-fixture',
      env: { PATH: process.env.PATH ?? '', CODEX_HOME: directory },
      config: {
        features: {
          shell_tool: false,
          unified_exec: false,
          apply_patch_freeform: false,
          apps: false,
          collab: false,
          shell_snapshot: false,
          remote_models: false,
        },
        tools: { view_image: false },
        mcp_servers: {},
        project_doc_max_bytes: 0,
        model_providers: {
          openai: {
            name: 'Offline fixture',
            base_url: `http://127.0.0.1:${port}/v1`,
            wire_api: 'responses',
            requires_openai_auth: true,
            request_max_retries: 0,
            stream_max_retries: 0,
          },
        },
      },
    });
    const thread = sdk.startThread({
      workingDirectory: directory,
      skipGitRepoCheck: true,
      model: 'gpt-5.2-codex',
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      webSearchMode: 'disabled',
    });
    try {
      const { events } = await thread.runStreamed("Reply with only the word 'ok'", {
        signal: controller.signal,
      });
      for await (const _event of events) {
        /* No upstream or tool execution in this fixture. */
      }
    } catch (error) {
      fixtureFailure = String(error);
      /* The local upstream intentionally rejects the model query. */
    }
    expect(requests, fixtureFailure).toHaveLength(1);
    expect(requests[0].tools?.map((tool) => tool.name ?? tool.type)).toEqual(
      expect.arrayContaining(['apply_patch', 'view_image'])
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
