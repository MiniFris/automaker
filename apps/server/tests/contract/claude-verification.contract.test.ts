import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
import {
  ClaudeVerificationTargetResponseSchema,
  ClaudeVerificationResponseSchema,
  API_CONTRACT_VERSION_HEADER,
} from '@automaker/contracts';
import { createNestApplication } from '../../src/main.js';
import { ClaudeVerificationRuntime } from '../../src/core/platform/claude-verification.runtime.js';
import { ClaudeVerificationService } from '../../src/modules/providers/claude-verification.service.js';
import { SettingsService } from '../../src/services/settings-service.js';

it('serves native consent-gated verification with app-specific environment and no credential persistence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-claude-verification-http-'));
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const before = { ...process.env };
  let releasePending: (() => void) | undefined;
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
        ANTHROPIC_API_KEY: 'sk-ant-bootstrap-private-123456',
        ANTHROPIC_BASE_URL: `https://${name}.example.test`,
      },
    });
    apps.push(runtime);
    const run = vi
      .spyOn(runtime.app.get(ClaudeVerificationRuntime), 'run')
      .mockResolvedValue('verified');
    await runtime.start();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    const request = async (route: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/setup/${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      expect(response.headers.get(API_CONTRACT_VERSION_HEADER)).toBe('9');
      return { status: response.status, body: await response.json() };
    };
    return { runtime, root, request, run };
  };
  try {
    const first = await start('first');
    const second = await start('second');
    const { target } = ClaudeVerificationTargetResponseSchema.parse(
      (await first.request('claude-verification-target?authMethod=api_key')).body
    );
    expect(target).toMatchObject({
      workingDirectory: first.root,
      endpoint: 'https://first.example.test/',
      model: 'claude-sonnet-4-6',
    });
    expect(first.run).not.toHaveBeenCalled();
    for (const body of [
      { authMethod: 'api_key' },
      { confirmed: false, target },
      { confirmed: true, target, authMethod: 'api_key' },
    ])
      expect((await first.request('verify-claude-auth', body)).status).toBe(400);
    expect((await second.request('verify-claude-auth', { confirmed: true, target })).status).toBe(
      409
    );
    expect(second.run).not.toHaveBeenCalled();
    const key = 'sk-ant-unsaved-private-123456';
    const verified = await first.request('verify-claude-auth', {
      confirmed: true,
      target,
      apiKey: key,
    });
    expect(verified.status).toBe(200);
    expect(ClaudeVerificationResponseSchema.parse(verified.body)).toMatchObject({
      authenticated: true,
      verification: 'verified',
      target,
    });
    expect(first.run.mock.calls[0][0]).toMatchObject({
      cwd: first.root,
      environment: { ANTHROPIC_API_KEY: key, ANTHROPIC_BASE_URL: target.endpoint },
    });
    expect(JSON.stringify(verified.body)).not.toContain(key);
    const cli = ClaudeVerificationTargetResponseSchema.parse(
      (await second.request('claude-verification-target?authMethod=cli')).body
    ).target;
    expect(
      (await second.request('verify-claude-auth', { confirmed: true, target: cli })).body
        .authenticated
    ).toBe(true);
    expect(second.run.mock.calls[0][0].environment.ANTHROPIC_API_KEY).toBeUndefined();
    expect(process.env).toEqual(before);
    expect(
      (await first.runtime.app.get(SettingsService).getCredentials()).apiKeys.anthropic
    ).toBeFalsy();

    first.run.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releasePending = resolve;
      });
      return 'verified';
    });
    const pending = first.request('verify-claude-auth', { confirmed: true, target, apiKey: key });
    await vi.waitFor(() => expect(first.run).toHaveBeenCalledTimes(2));
    let closed = false;
    closing = first.runtime.app.close().then(() => {
      closed = true;
    });
    await vi.waitFor(() => expect(first.run.mock.calls[1][0].controller.signal.aborted).toBe(true));
    expect(closed).toBe(false);
    expect(() => first.runtime.app.get(ClaudeVerificationService).target('cli')).toThrow();
    releasePending!();
    expect((await pending).body.authenticated).toBe(false);
    await closing;
    expect(second.runtime.app.get(ClaudeVerificationService).target('cli').success).toBe(true);
  } finally {
    releasePending?.();
    await closing;
    for (const app of apps) await app.app.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
