import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModulesContainer } from '@nestjs/core';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { IssueValidationRegistry } from '../../src/modules/github/issue-validation-registry.service.js';
import { IssueValidationService } from '../../src/modules/github/issue-validation.service.js';
import { IssueValidationRepository } from '../../src/modules/github/issue-validation.repository.js';
import { GithubController } from '../../src/modules/github/github.controller.js';
import { EVENT_BUS, type EventBus } from '../../src/core/eventing/event-bus.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { ProviderCleanupError } from '../../src/providers/provider-execution-scope.js';
import type { ExecuteOptions, ProviderMessage } from '../../src/providers/types.js';
import { MockProvider } from '../helpers/mock-provider.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const result = { verdict: 'valid', confidence: 'high', reasoning: 'Owned fixture result' };
function probe() {
  return {
    gate: deferred(),
    options: undefined as ExecuteOptions | undefined,
    finished: false,
    fail: false,
  };
}
class FixtureProvider extends MockProvider {
  constructor(private readonly state: ReturnType<typeof probe>) {
    super('claude');
  }
  protected async *execute(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    this.state.options = options;
    try {
      if (this.state.fail) throw new Error('private-provider-token');
      yield {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: JSON.stringify(result) }] },
      };
      await this.state.gate.promise;
      yield { type: 'result', subtype: 'success', structured_output: result };
    } finally {
      this.state.finished = true;
    }
  }
}
async function start(directory: string, name: string, state: ReturnType<typeof probe>) {
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: directory,
    dataDir: path.join(directory, name),
    runStartupTasks: false,
    enableShutdownHooks: false,
    environment: {
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      ENABLE_REQUEST_LOGGING: 'false',
    },
    providerRegistrations: [{ name: 'claude', create: () => new FixtureProvider(state) }],
  });
  await runtime.start();
  const port = (runtime.app.getHttpServer().address() as { port: number }).port;
  const post = async (route: string, body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/github/${route}`, {
      method: 'POST',
      headers: { 'x-api-key': 'fixture', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { ...runtime, post };
}
const input = (projectPath: string) => ({
  projectPath,
  issueNumber: 12,
  issueTitle: 'Owned issue',
  issueBody: 'Fixture only',
});

it('native HTTP validation ownership is app-local and holds a stopped slot until provider cleanup, preserving events and stored results', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-issue-native-'));
  const one = probe(),
    two = probe();
  const apps: Awaited<ReturnType<typeof start>>[] = [];
  const events: Array<Record<string, unknown>> = [];
  try {
    const first = await start(directory, 'one', one),
      second = await start(directory, 'two', two);
    apps.push(first, second);
    first.app
      .get<EventBus>(EVENT_BUS)
      .subscribe('issue-validation:event', (event) =>
        events.push(event as unknown as Record<string, unknown>)
      );
    expect(first.app.get(IssueValidationRegistry)).not.toBe(
      second.app.get(IssueValidationRegistry)
    );
    expect(
      (first.app.get(GithubController) as unknown as { issueValidations: unknown }).issueValidations
    ).toBe(first.app.get(IssueValidationService));
    expect(
      (first.app.get(IssueValidationService) as unknown as { repository: unknown }).repository
    ).toBe(first.app.get(IssueValidationRepository));
    const owners = [...first.app.get(ModulesContainer).values()]
      .flatMap((module) => [...module.providers.values()])
      .filter((entry) => entry.token === IssueValidationRegistry);
    expect(owners).toHaveLength(1);
    expect(await first.post('validate-issue', input(directory))).toMatchObject({
      status: 200,
      body: { success: true, issueNumber: 12, message: 'Validation started for issue #12' },
    });
    expect(await second.post('validate-issue', input(directory))).toMatchObject({
      status: 200,
      body: { success: true },
    });
    await vi.waitFor(() => {
      expect(one.options).toBeDefined();
      expect(two.options).toBeDefined();
    });
    expect(one.options).toMatchObject({
      readOnly: true,
      cwd: directory,
      allowedTools: ['Read', 'Glob', 'Grep'],
    });
    expect(await first.post('validation-status', { projectPath: directory })).toMatchObject({
      status: 200,
      body: { runningIssues: [12] },
    });
    expect(await first.post('validate-issue', input(directory))).toMatchObject({
      body: { success: false, error: 'Validation is already running for issue #12' },
    });
    expect(await first.post('validation-stop', input(directory))).toMatchObject({
      status: 200,
      body: { success: true, message: 'Validation for issue #12 has been stopped' },
    });
    expect(one.options!.abortController!.signal.aborted).toBe(true);
    expect(two.options!.abortController!.signal.aborted).toBe(false);
    expect(await first.post('validation-status', input(directory))).toMatchObject({
      body: { isRunning: true },
    });
    expect(await first.post('validate-issue', input(directory))).toMatchObject({
      body: { success: false },
    });
    one.gate.resolve();
    await vi.waitFor(() =>
      expect(first.app.get(IssueValidationRegistry).status(directory, 12)).toBeNull()
    );
    expect(one.finished).toBe(true);
    expect(events.some((event) => event.type === 'issue_validation_complete')).toBe(false);
    expect(events.find((event) => event.type === 'issue_validation_error')?.error).toBe(
      'Validation cancelled.'
    );
    expect(await first.post('validations', input(directory))).toMatchObject({
      status: 200,
      body: { validation: null },
    });
    await first.app.close();
    expect(second.app.get(IssueValidationRegistry).status(directory, 12)?.isRunning).toBe(true);
    two.gate.resolve();
    await vi.waitFor(() =>
      expect(second.app.get(IssueValidationRegistry).status(directory, 12)).toBeNull()
    );
    expect(await second.post('validations', input(directory))).toMatchObject({
      status: 200,
      body: { validation: { issueNumber: 12, result } },
    });
    expect(
      JSON.parse(
        await readFile(path.join(directory, '.automaker/validations/12/validation.json'), 'utf8')
      ).result
    ).toEqual(result);
    const viewed: unknown[] = [];
    second.app
      .get<EventBus>(EVENT_BUS)
      .subscribe('issue-validation:event', (event) => viewed.push(event));
    expect(await second.post('validation-mark-viewed', input(directory))).toMatchObject({
      status: 200,
      body: { success: true },
    });
    expect(viewed).toContainEqual({
      type: 'issue_validation_viewed',
      projectPath: directory,
      issueNumber: 12,
    });
    expect(await second.post('validation-delete', input(directory))).toMatchObject({
      status: 200,
      body: { success: true, deleted: true },
    });
    expect(await second.post('validations', input(directory))).toMatchObject({
      status: 200,
      body: { validation: null },
    });
  } finally {
    one.gate.resolve();
    two.gate.resolve();
    try {
      await Promise.all(apps.map((runtime) => runtime.app.close()));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

it('native shutdown cancels and drains an active validation before close resolves and closes new admission', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-issue-drain-'));
  const state = probe(),
    runtime = await start(directory, 'data', state);
  try {
    await runtime.post('validate-issue', input(directory));
    await vi.waitFor(() => expect(state.options).toBeDefined());
    let closed = false;
    const closing = runtime.app.close().then(() => {
      closed = true;
    });
    await vi.waitFor(() => expect(state.options!.abortController!.signal.aborted).toBe(true));
    expect(closed).toBe(false);
    expect(await runtime.post('validate-issue', input(directory))).toMatchObject({
      status: 503,
      body: { success: false, errorCode: 'UNAVAILABLE' },
    });
    state.gate.resolve();
    await closing;
    expect(state.finished).toBe(true);
    expect(runtime.app.get(IssueValidationRegistry).status(directory, 12)).toBeNull();
  } finally {
    state.gate.resolve();
    try {
      await runtime.app.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

it('validates native request bodies before admission and emits static provider failure events', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-issue-errors-'));
  const state = probe();
  state.fail = true;
  const runtime = await start(directory, 'data', state);
  const events: unknown[] = [];
  runtime.app
    .get<EventBus>(EVENT_BUS)
    .subscribe('issue-validation:event', (event) => events.push(event));
  try {
    for (const body of [
      { ...input(directory), issueNumber: -1 },
      { ...input(directory), comments: [{}] },
      { ...input(directory), model: 'not-a-supported-model' },
    ])
      expect(await runtime.post('validate-issue', body)).toMatchObject({
        status: 400,
        body: { success: false, errorCode: 'VALIDATION_ERROR' },
      });
    expect(state.options).toBeUndefined();
    expect(await runtime.post('validate-issue', input(directory))).toMatchObject({
      status: 200,
      body: { success: true },
    });
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'issue_validation_error',
          error: 'Issue validation failed.',
        })
      )
    );
    expect(JSON.stringify(events)).not.toContain('private-provider-token');
    expect(runtime.app.get(IssueValidationRegistry).running(directory)).toEqual([]);
  } finally {
    try {
      await runtime.app.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

it('native shutdown reports unconfirmed validation cleanup and still attempts provider disposal', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-issue-unknown-'));
  const runtime = await start(directory, 'data', probe());
  const registry = runtime.app.get(IssueValidationRegistry);
  const providers = vi.spyOn(runtime.app.get(ProviderRegistry), 'onApplicationShutdown');
  try {
    registry.start(directory, 12, async () => {
      throw new ProviderCleanupError();
    });
    await vi.waitFor(() => expect(registry.hasUnconfirmed(directory, 12)).toBe(true));
    expect(await runtime.post('validation-status', input(directory))).toMatchObject({
      status: 503,
      body: { success: false, errorCode: 'UNAVAILABLE' },
    });
    expect(await runtime.post('validate-issue', input(directory))).toMatchObject({
      status: 503,
      body: { success: false, errorCode: 'UNAVAILABLE' },
    });
    await expect(runtime.app.close()).rejects.toMatchObject({ code: 'APPLICATION_CLEANUP_FAILED' });
    expect(providers).toHaveBeenCalledOnce();
    expect(registry.status(directory, 12)?.isRunning).toBe(true);
    await expect(runtime.app.close()).rejects.toMatchObject({ code: 'APPLICATION_CLEANUP_FAILED' });
  } finally {
    providers.mockRestore();
    await runtime.app.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
