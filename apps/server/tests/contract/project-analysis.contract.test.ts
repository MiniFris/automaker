import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import type { ExecuteOptions, ProviderMessage } from '@automaker/types';
import { createNestApplication } from '../../src/main.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { APPLICATION_EVENTS } from '../../src/core/eventing/application-events.js';
import type { EventEmitter } from '../../src/lib/events.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/security.module.js';
import type * as Filesystem from '../../src/lib/secure-fs.js';
import { ProjectAnalysisService } from '../../src/modules/auto-mode/project-analysis.service.js';
import { MockProvider } from '../helpers/mock-provider.js';

type Script = (options: ExecuteOptions) => AsyncGenerator<ProviderMessage>;
class AnalysisProvider extends MockProvider {
  readonly calls: ExecuteOptions[] = [];
  constructor(private readonly script: Script) {
    super('claude');
  }
  protected override execute(options: ExecuteOptions) {
    this.calls.push(options);
    return this.script(options);
  }
}
const roots: string[] = [],
  releases: Array<() => void> = [];
const owners: Awaited<ReturnType<typeof createNestApplication>>[] = [];
const failedOwners = new Set<unknown>();
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}
afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  const apps = owners.splice(0);
  const results = await Promise.allSettled(apps.map((owner) => owner.app.close()));
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  results.forEach((result, index) => {
    if (result.status === 'rejected' && !failedOwners.has(apps[index].app)) throw result.reason;
  });
  failedOwners.clear();
});
const assistant = (text: string): ProviderMessage => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});
const normal: Script = async function* () {
  yield assistant('# Partial');
  yield {
    type: 'result',
    subtype: 'success',
    result: '# Final analysis\nNative architecture and build commands.',
  };
};
async function fixture(script: Script = normal) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-project-analysis-'));
  roots.push(root);
  const project = path.join(root, 'project');
  await mkdir(project);
  const provider = new AnalysisProvider(script);
  const owner = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: project,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [{ name: 'claude', create: () => provider }],
    environment: {
      NODE_ENV: 'test',
      HOME: root,
      USERPROFILE: root,
      AUTOMAKER_API_KEY: 'fixture',
      ALLOWED_ROOT_DIRECTORY: root,
      ENABLE_REQUEST_LOGGING: 'false',
      LOG_LEVEL: 'error',
    },
  });
  owners.push(owner);
  await owner.start();
  const events: Record<string, unknown>[] = [];
  owner.app.get<EventEmitter>(APPLICATION_EVENTS).subscribe((type, payload) => {
    if (type === 'auto-mode:event') events.push(payload as Record<string, unknown>);
  });
  const origin = `http://127.0.0.1:${owner.app.getHttpServer().address().port}`;
  const start = async (projectPath = project) => {
    const response = await fetch(`${origin}/api/auto-mode/analyze-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'fixture' },
      body: JSON.stringify({ projectPath }),
    });
    return { status: response.status, body: await response.json() };
  };
  const file = path.join(project, '.automaker', 'project-analysis.md');
  return {
    ...owner,
    project,
    root,
    provider,
    events,
    start,
    file,
    settings: owner.app.get(SettingsService),
  };
}
it('HTTP background acknowledgement leads to actual configured analysis, progress and a durable private report', async () => {
  const owner = await fixture();
  await owner.settings.updateGlobalSettings({
    phaseModels: {
      projectAnalysisModel: { model: 'claude-haiku', thinkingLevel: 'high' },
    } as never,
    promptCustomization: {
      taskExecution: {
        projectAnalysisPrompt: { enabled: true, value: 'Analyze this private fixture' },
      },
    },
    autoLoadClaudeMd: true,
  });
  expect(await owner.start()).toEqual({
    status: 200,
    body: { success: true, message: 'Project analysis started' },
  });
  await vi.waitFor(() =>
    expect(owner.events.find((event) => event.type === 'auto_mode_feature_complete')).toBeDefined()
  );
  expect(await readFile(owner.file, 'utf8')).toBe(
    '# Final analysis\nNative architecture and build commands.'
  );
  if (process.platform !== 'win32') expect((await stat(owner.file)).mode & 0o777).toBe(0o600);
  expect(owner.provider.calls).toHaveLength(1);
  expect(owner.provider.calls[0]).toMatchObject({
    prompt: 'Analyze this private fixture',
    cwd: owner.project,
    maxTurns: 5,
    allowedTools: ['Read', 'Glob', 'Grep'],
    readOnly: true,
    thinkingLevel: 'high',
    model: 'claude-haiku-4-5-20251001',
    settingSources: ['user', 'project'],
  });
  expect(owner.events.map((event) => event.type)).toEqual([
    'auto_mode_feature_start',
    'auto_mode_progress',
    'auto_mode_feature_complete',
  ]);
  expect(owner.events[0]).toMatchObject({
    branchName: null,
    projectPath: owner.project,
    feature: { title: 'Project Analysis' },
  });
  expect(owner.events[0].featureId).toMatch(/^analysis-/);
  expect(owner.events.at(-1)).toMatchObject({
    featureId: owner.events[0].featureId,
    passes: true,
    branchName: null,
  });
  expect(
    (await readdir(path.dirname(owner.file))).filter((name) => name.includes('.write.'))
  ).toEqual([]);
});
it('provider errors publish controlled failure and preserve the previous report', async () => {
  const owner = await fixture(async function* () {
    yield { type: 'error', error: 'private-provider-secret' };
  });
  await mkdir(path.dirname(owner.file), { recursive: true });
  await writeFile(owner.file, 'previous');
  expect((await owner.start()).status).toBe(200);
  await vi.waitFor(() =>
    expect(owner.events.some((event) => event.type === 'auto_mode_error')).toBe(true)
  );
  expect(await readFile(owner.file, 'utf8')).toBe('previous');
  expect(owner.events.some((event) => event.type === 'auto_mode_feature_complete')).toBe(false);
  expect(JSON.stringify(owner.events)).not.toContain('private-provider-secret');
});
it('native close aborts an accepted provider and waits for cleanup without stopping another application', async () => {
  const cleanup = gate();
  let aborted = false;
  const one = await fixture(async function* (options) {
    yield assistant('partial');
    await new Promise<void>((resolve) =>
      options.abortController!.signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          resolve();
        },
        { once: true }
      )
    );
    try {
      yield assistant('late success');
    } finally {
      await cleanup.promise;
    }
  });
  const two = await fixture();
  await one.start();
  await vi.waitFor(() => expect(one.provider.calls).toHaveLength(1));
  let closed = false;
  const closing = one.app.close().then(() => {
    closed = true;
  });
  await vi.waitFor(() => expect(aborted).toBe(true));
  expect(closed).toBe(false);
  expect((await two.start()).status).toBe(200);
  await vi.waitFor(() =>
    expect(two.events.some((event) => event.type === 'auto_mode_feature_complete')).toBe(true)
  );
  cleanup.release();
  await closing;
  expect(one.events.some((event) => event.type === 'auto_mode_feature_complete')).toBe(false);
  await expect(readFile(one.file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(two.file, 'utf8')).toContain('Final analysis');
  expect(() => one.app.get(ProjectAnalysisService).launch(one.project)).toThrow('unavailable');
});
it('abort during an accepted temp write drains IO and never replaces an existing report with late output', async () => {
  const owner = await fixture();
  const hold = gate();
  let entered = false;
  await mkdir(path.dirname(owner.file), { recursive: true });
  await writeFile(owner.file, 'old report');
  const filesystem = owner.app.get<typeof Filesystem>(SECURE_FILESYSTEM),
    write = filesystem.writeFile.bind(filesystem);
  vi.spyOn(filesystem, 'writeFile').mockImplementation(async (...args) => {
    if (String(args[0]).includes('project-analysis.md.write.')) {
      entered = true;
      await hold.promise;
    }
    return write(...args);
  });
  await owner.start();
  await vi.waitFor(() => expect(entered).toBe(true));
  let closed = false;
  const closing = owner.app.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(closed).toBe(false);
  hold.release();
  await closing;
  expect(await readFile(owner.file, 'utf8')).toBe('old report');
  expect(owner.events.some((event) => event.type === 'auto_mode_feature_complete')).toBe(false);
  expect(
    (await readdir(path.dirname(owner.file))).filter((name) => name.includes('.write.'))
  ).toEqual([]);
});
it('uses the configured agent deadline, confirms abort, and keeps late provider output out of the report', async () => {
  let aborted = false;
  const owner = await fixture(async function* (options) {
    yield assistant('partial');
    await new Promise<void>((resolve) =>
      options.abortController!.signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          resolve();
        },
        { once: true }
      )
    );
    yield { type: 'result', subtype: 'success', result: 'too late' };
  });
  await owner.settings.updateGlobalSettings({ modelTimeouts: { agentTimeoutMs: 50 } });
  await owner.start();
  await vi.waitFor(() =>
    expect(owner.events.find((event) => event.type === 'auto_mode_error')).toMatchObject({
      errorType: 'timeout',
    })
  );
  expect(aborted).toBe(true);
  await expect(readFile(owner.file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});
it('does not claim clean close when provider cleanup remains unconfirmed', async () => {
  const hold = gate();
  let aborted = false;
  const owner = await fixture(async function* (options) {
    yield assistant('partial');
    await new Promise<void>((resolve) =>
      options.abortController!.signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          resolve();
        },
        { once: true }
      )
    );
    try {
      yield assistant('late');
    } finally {
      await hold.promise;
    }
  });
  failedOwners.add(owner.app);
  await owner.start();
  await vi.waitFor(() => expect(owner.provider.calls).toHaveLength(1));
  const close = owner.app.close();
  void close.catch(() => {});
  await vi.waitFor(() => expect(aborted).toBe(true));
  await expect(close).rejects.toMatchObject({ code: 'APPLICATION_CLEANUP_FAILED' });
  hold.release();
  await expect(owner.app.close()).rejects.toMatchObject({ code: 'APPLICATION_CLEANUP_FAILED' });
  await expect(readFile(owner.file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  expect(owner.events.some((event) => event.type === 'auto_mode_feature_complete')).toBe(false);
}, 20000);
