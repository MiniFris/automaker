import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import {
  CodexVerificationTargetResponseSchema,
  CodexVerificationResponseSchema,
} from '@automaker/contracts';
import { createNestApplication } from '../../src/main.js';
import { CodexCredentialRuntime } from '../../src/core/platform/codex-credential.runtime.js';
import { CodexVerificationRuntime } from '../../src/core/platform/codex-verification.runtime.js';
import { CodexVerificationService } from '../../src/modules/providers/codex-verification.service.js';
import { SetupHandlersService } from '../../src/modules/providers/setup-handlers.service.js';
import { SettingsService } from '../../src/services/settings-service.js';

it('serves confirmed native Codex verification with isolated targets, no legacy bridge and shutdown draining', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-codex-http-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const before = { ...process.env };
  let release: (() => void) | undefined;
  let closing: Promise<void> | undefined;
  const start = async (name: string) => {
    const root = path.join(directory, name);
    await mkdir(root);
    const runtime = await createNestApplication({
      host: '127.0.0.1',
      port: 0,
      workingDirectory: root,
      dataDir: path.join(root, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      environment: {
        NODE_ENV: 'test',
        AUTOMAKER_API_KEY: 'fixture-api-key',
        ENABLE_REQUEST_LOGGING: 'false',
        OPENAI_BASE_URL: `https://${name}.example.test/v1`,
        CODEX_HOME: path.join(root, '.codex'),
      },
    });
    apps.push(runtime);
    const read = vi
      .spyOn(runtime.app.get(CodexCredentialRuntime), 'read')
      .mockResolvedValue({ kind: 'api-key' });
    const run = vi
      .spyOn(runtime.app.get(CodexVerificationRuntime), 'run')
      .mockResolvedValue('verified');
    const bridge = vi.spyOn(runtime.app.get(SetupHandlersService), 'run');
    await runtime.start();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    const request = async (route: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/setup/${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    };
    return { runtime, root, read, run, bridge, request };
  };
  try {
    const first = await start('first');
    const second = await start('second');
    const target = CodexVerificationTargetResponseSchema.parse(
      (await first.request('codex-verification-target?authMethod=api_key')).body
    ).target;
    expect(target).toMatchObject({
      workingDirectory: first.root,
      endpoint: 'https://first.example.test/v1/responses',
      credentialKind: 'api-key',
    });
    expect(first.read).not.toHaveBeenCalled();
    expect(first.run).not.toHaveBeenCalled();
    for (const input of [
      { authMethod: 'api_key' },
      { confirmed: false, target },
      { confirmed: true, target, authMethod: 'api_key' },
    ])
      expect((await first.request('verify-codex-auth', input)).status).toBe(400);
    expect((await second.request('verify-codex-auth', { confirmed: true, target })).status).toBe(
      409
    );
    expect(second.run).not.toHaveBeenCalled();
    const apiKey = 'sk-unsaved-offline-fixture-123456';
    const verified = await first.request('verify-codex-auth', { confirmed: true, target, apiKey });
    expect(verified.status).toBe(200);
    expect(CodexVerificationResponseSchema.parse(verified.body)).toMatchObject({
      authenticated: true,
      verification: 'verified',
      target,
    });
    expect(first.run.mock.calls[0][0]).toMatchObject({
      apiKey,
      endpoint: target.endpoint,
      authMethod: 'api_key',
    });
    expect(JSON.stringify(verified.body)).not.toContain(apiKey);
    expect(
      (await first.runtime.app.get(SettingsService).getCredentials()).apiKeys.openai
    ).toBeFalsy();
    const cli = CodexVerificationTargetResponseSchema.parse(
      (await second.request('codex-verification-target?authMethod=cli')).body
    ).target;
    expect(cli.credentialDirectory).toBe(path.join(second.root, '.codex'));
    expect(
      (await second.request('verify-codex-auth', { confirmed: true, target: cli })).body
        .authenticated
    ).toBe(true);
    expect(second.read.mock.calls.every(([includeToken]) => includeToken === false)).toBe(true);
    expect(first.bridge).not.toHaveBeenCalled();
    expect(second.bridge).not.toHaveBeenCalled();
    expect(process.env).toEqual(before);
    first.run.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return 'verified';
    });
    const pending = first.request('verify-codex-auth', { confirmed: true, target, apiKey });
    await vi.waitFor(() => expect(first.run).toHaveBeenCalledTimes(2));
    closing = first.runtime.app.close();
    await vi.waitFor(() => expect(first.run.mock.calls[1][0].controller.signal.aborted).toBe(true));
    await expect(
      first.runtime.app.get(CodexVerificationService).target('api_key')
    ).rejects.toMatchObject({ statusCode: 503 });
    release!();
    expect((await pending).body.authenticated).toBe(false);
    await closing;
    expect((await second.runtime.app.get(CodexVerificationService).target('api_key')).success).toBe(
      true
    );
  } finally {
    release?.();
    await closing;
    for (const app of apps) await app.app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
