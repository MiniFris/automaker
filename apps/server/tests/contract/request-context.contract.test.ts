import fs from 'node:fs/promises';
import { SetupCredentialDeleteRequestSchema } from '@automaker/contracts';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AuthService } from '../../src/core/auth/auth.service.js';
import { LoginAttemptStore } from '../../src/core/auth/login-attempt.store.js';
import { TerminalAccessService } from '../../src/modules/terminal/terminal-access.service.js';
import { SetupCredentialsService } from '../../src/modules/providers/setup-credentials.service.js';
import { ClaudeVerificationService } from '../../src/modules/providers/claude-verification.service.js';
import { CodexVerificationService } from '../../src/modules/providers/codex-verification.service.js';
import { GithubAuthenticationService } from '../../src/modules/providers/github-authentication.service.js';

let runtime: Awaited<ReturnType<typeof createNestApplication>>;
let directory: string, base: string, token: string;
const key = 'request-context-fixture';
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'request-context-'));
  runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: directory,
    dataDir: path.join(directory, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'production',
      HOME: directory,
      ALLOWED_ROOT_DIRECTORY: directory,
      AUTOMAKER_API_KEY: key,
    },
  });
  await runtime.start();
  base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/`;
  token = await runtime.app.get(AuthService).createSession();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await runtime?.app.close();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});
async function call(route: string, headers: Record<string, string> = {}, body?: unknown) {
  return fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
}
it.each([
  ['', {}, false],
  [`?apiKey=${key}`, {}, true],
  [`?token=bad`, {}, false],
  [`?token=${key}`, {}, false],
  [`?apiKey=${key}&apiKey=bad`, {}, false],
  [`?apiKey=${key}`, { 'x-api-key': 'bad' }, false],
  [`?apiKey=${key}`, { 'x-session-token': 'bad' }, false],
  ['', { 'x-api-key': key }, true],
])(
  'keeps status precedence and repeated query rejection without introducing 400: %s %j',
  async (query, headers, authenticated) => {
    const response = await call('auth/status' + query, headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, authenticated });
  }
);
it('retains session-header/query/cookie precedence and opaque JSON cookie invalidation', async () => {
  const auth = runtime.app.get(AuthService);
  const cookie = `${auth.sessionCookieName}=${token}`;
  for (const [query, headers, authenticated] of [
    ['', { cookie }, true],
    [`?token=${token}`, {}, true],
    [`?apiKey=bad`, { cookie }, false],
    [`?token=bad`, { 'x-session-token': token }, true],
    ['', { cookie: `${auth.sessionCookieName}=${encodeURIComponent('j:{"legacy":true}')}` }, false],
  ] as const) {
    const response = await call('auth/status' + query, headers);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ authenticated });
  }
  const invalidate = vi.spyOn(auth, 'invalidateSession').mockResolvedValue();
  const response = await call(
    'auth/logout',
    { cookie: `${auth.sessionCookieName}=${encodeURIComponent('j:{"legacy":true}')}` },
    {}
  );
  expect(response.status).toBe(200);
  expect(invalidate).toHaveBeenCalledWith({ legacy: true });
  expect(response.headers.get('set-cookie')).toContain('HttpOnly');
});
it('uses the same Express peer for login and all five setup admissions despite spoofed forwarding headers', async () => {
  const attempts = runtime.app.get(LoginAttemptStore);
  const login = vi.spyOn(attempts, 'check');
  const store = vi
    .spyOn(runtime.app.get(SetupCredentialsService), 'change')
    .mockImplementation(async (operation, input) => ({
      success: true as const,
      target: SetupCredentialDeleteRequestSchema.parse({
        confirmed: true,
        target: (input as { target: unknown }).target,
      }).target,
      operation,
      configured: operation === 'store',
      storage: 'managed-credentials' as const,
    }));
  const claude = vi
    .spyOn(runtime.app.get(ClaudeVerificationService), 'verify')
    .mockImplementation(async (input) => ({
      success: true as const,
      authenticated: false,
      target: input.target,
      authType: input.target.authMethod,
      verification: 'unverified' as const,
    }));
  const codex = vi
    .spyOn(runtime.app.get(CodexVerificationService), 'verify')
    .mockImplementation(async (input) => ({
      success: true as const,
      authenticated: false,
      target: input.target,
      authType: input.target.authMethod,
      verification: 'unverified' as const,
    }));
  const github = vi
    .spyOn(runtime.app.get(GithubAuthenticationService), 'verify')
    .mockImplementation(async (input) => ({
      success: true as const,
      authenticated: false,
      target: input.target,
      authenticationChecked: true as const,
      user: null,
    }));
  expect(
    (await call('auth/login', { 'x-forwarded-for': 'spoofed' }, { apiKey: 'bad' })).status
  ).toBe(401);
  const peer = login.mock.calls[0][0];
  expect(peer).not.toBe('spoofed');
  expect(peer).toMatch(/127\.0\.0\.1/);
  const common = {
    instanceId: '11111111-1111-4111-8111-111111111111',
    workingDirectory: directory,
  };
  const credential = {
    ...common,
    kind: 'application-credential',
    provider: 'anthropic',
    credentialsPath: path.join(directory, 'credentials.json'),
  };
  const requests = [
    [
      'store-api-key',
      { confirmed: true, target: credential, apiKey: 'sk-ant-offline-fixture-key' },
    ],
    ['delete-api-key', { confirmed: true, target: credential }],
    [
      'verify-claude-auth',
      {
        confirmed: true,
        target: {
          ...common,
          kind: 'host-claude-verification',
          provider: 'claude',
          authMethod: 'api_key',
          endpoint: 'https://api.anthropic.com/',
          model: 'claude-sonnet-4-6',
        },
      },
    ],
    [
      'verify-codex-auth',
      {
        confirmed: true,
        target: {
          ...common,
          kind: 'host-codex-verification',
          provider: 'codex',
          authMethod: 'api_key',
          credentialKind: 'api-key',
          endpoint: 'https://api.openai.com/',
          model: 'gpt-5.2-codex',
        },
      },
    ],
    [
      'verify-github-auth',
      {
        confirmed: true,
        target: {
          ...common,
          kind: 'host-github-authentication',
          provider: 'github',
          cliPath: null,
          hostname: 'github.com',
        },
      },
    ],
  ] as const;
  for (const [route, body] of requests) {
    expect(
      (await call('setup/' + route, { 'x-api-key': key, 'x-forwarded-for': 'other-spoof' }, body))
        .status
    ).toBe(200);
  }
  expect(store.mock.calls.map((call) => call[2])).toEqual([peer, peer]);
  for (const spy of [claude, codex, github]) expect(spy.mock.calls[0][1]).toBe(peer);
});
it.each([
  ['header', 'body', 'header'],
  ['', 'body', 'body'],
  [undefined, 42, undefined],
  [undefined, { nested: true }, undefined],
  [undefined, '', ''],
])('keeps terminal logout selection for %j/%j', async (header, body, expected) => {
  const logout = vi.spyOn(runtime.app.get(TerminalAccessService), 'logout');
  const response = await call(
    'terminal/logout',
    { 'x-api-key': key, ...(header === undefined ? {} : { 'x-terminal-token': header }) },
    { token: body }
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true });
  expect(logout).toHaveBeenCalledWith(expected);
});

it('validates login and setup bodies before admission without changing errors to rate limiting', async () => {
  const check = vi
    .spyOn(runtime.app.get(LoginAttemptStore), 'check')
    .mockReturnValue({ allowed: false, retryAfterSeconds: 60 });
  const verify = vi.spyOn(runtime.app.get(ClaudeVerificationService), 'verify');
  expect((await call('auth/login', {}, { apiKey: 42 })).status).toBe(400);
  expect(check).not.toHaveBeenCalled();
  expect((await call('auth/login', {}, { apiKey: 'valid-body' })).status).toBe(429);
  expect(
    (await call('setup/verify-claude-auth', { 'x-api-key': key }, { confirmed: false })).status
  ).toBe(400);
  expect(verify).not.toHaveBeenCalled();
});
it('keeps invalid array/object material at its original priority with real owned auth state', () => {
  const auth = runtime.app.get(AuthService);
  for (const value of [[], [key], {}, true, 1]) {
    const invalid = value as unknown as string;
    expect(auth.checkAuthentication({ 'x-api-key': invalid }, { apiKey: key }, {})).toEqual({
      authenticated: false,
      errorType: 'invalid_api_key',
    });
    expect(auth.checkAuthentication({ 'x-session-token': invalid }, { apiKey: key }, {})).toEqual({
      authenticated: false,
      errorType: 'invalid_session',
    });
    expect(
      auth.checkAuthentication({}, { apiKey: invalid, token }, { [auth.sessionCookieName]: token })
    ).toEqual({ authenticated: false, errorType: 'invalid_api_key' });
    expect(
      auth.checkAuthentication({}, { token: invalid }, { [auth.sessionCookieName]: token })
    ).toEqual({ authenticated: false, errorType: 'invalid_session' });
    expect(auth.checkAuthentication({}, {}, { [auth.sessionCookieName]: invalid })).toEqual({
      authenticated: false,
      errorType: 'no_auth',
    });
  }
});
