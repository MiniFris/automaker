import { APPLICATION_EVENTS } from '../../src/core/eventing/application-events.js';
import type { EventEmitter } from '../../src/lib/events.js';
import * as legacyFilesystem from '../../src/lib/secure-fs.js';
import { ProjectFeatureSerializer } from '../../src/modules/features/project-feature-serializer.js';
import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ExecuteOptions } from '@automaker/types';
import { getFeatureDir, getIdeasDir, getIdeaPath } from '@automaker/platform';
import { createNestApplication } from '../../src/main.js';
import { IdeationService } from '../../src/services/ideation-service.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import { IdeaConversionStore } from '../../src/modules/ideation/idea-conversion.store.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/security.module.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { ProviderMessage } from '../../src/providers/types.js';

let root: string;
const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'automaker-ideation-native-'));
});
afterEach(async () => {
  const closed = await Promise.allSettled(apps.splice(0).map((owner) => owner.app.close()));
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
  for (const result of closed) if (result.status === 'rejected') throw result.reason;
});
async function start(name: string, provider = new MockProvider('claude')) {
  const project = path.join(root, name);
  await mkdir(project, { recursive: true });
  const owner = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: root,
    dataDir: path.join(root, name + '-data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [{ name: 'claude', create: () => provider }],
    environment: {
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      ALLOWED_ROOT_DIRECTORY: root,
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  apps.push(owner);
  await owner.start();
  const port = (owner.app.getHttpServer().address() as { port: number }).port;
  const post = async (route: string, data: object) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/ideation/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'fixture' },
      body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  };
  return { ...owner, project, post, service: owner.app.get(IdeationService) };
}

it('recovers conversion after delete failure and restart without duplicating or overwriting the feature', async () => {
  const owner = await start('conversion');
  const idea = await owner.service.createIdea(owner.project, {
    title: 'Owned idea',
    description: 'Original description',
    category: 'feature',
  });
  vi.spyOn(owner.service, 'deleteIdea').mockRejectedValueOnce(
    Object.assign(new Error('Owned delete failure'), { code: 'EACCES' })
  );
  const input = { projectPath: owner.project, ideaId: idea.id };
  expect(await owner.post('convert', input)).toMatchObject({
    status: 500,
    body: { success: false },
  });
  const features = await owner.app.get(FeatureLoader).getAll(owner.project);
  expect(features).toHaveLength(1);
  await owner.app
    .get(FeatureLoader)
    .update(owner.project, features[0].id, { title: 'Edited after publication' });
  await owner.app.close();
  const restarted = await start('conversion-restart');
  const retry = await restarted.post('convert', input);
  expect(retry).toEqual({ status: 200, body: { success: true, featureId: features[0].id } });
  expect(await restarted.post('convert', input)).toEqual(retry);
  const stored = await restarted.app.get(FeatureLoader).getAll(owner.project);
  expect(stored).toHaveLength(1);
  expect(stored[0].title).toBe('Edited after publication');
  expect(await restarted.service.getIdea(owner.project, idea.id)).toBeNull();
});

it('preserves keepIdea and first conversion payload across concurrent applications', async () => {
  const first = await start('keep-one'),
    second = await start('keep-two');
  const idea = await first.service.createIdea(first.project, {
    title: 'Keep idea',
    description: 'Description',
    category: 'feature',
  });
  const input = {
    projectPath: first.project,
    ideaId: idea.id,
    keepIdea: true,
    column: 'ready',
    dependencies: ['dependency'],
    tags: ['owned'],
  };
  const [one, two] = await Promise.all([
    first.post('convert', input),
    second.post('convert', input),
  ]);
  expect(one.status).toBe(200);
  expect(two).toEqual(one);
  expect(await first.service.getIdea(first.project, idea.id)).not.toBeNull();
  const feature = (await first.app.get(FeatureLoader).getAll(first.project))[0];
  expect(feature).toMatchObject({ status: 'ready', dependencies: ['dependency'], tags: ['owned'] });
  expect(await second.post('convert', { ...input, keepIdea: false, column: 'backlog' })).toEqual(
    one
  );
  expect(await second.app.get(FeatureLoader).getAll(first.project)).toHaveLength(1);
  expect((await second.app.get(FeatureLoader).get(first.project, feature.id))?.status).toBe(
    'ready'
  );
});

it('fails closed on feature ID collision and malformed existing data without overwrite', async () => {
  const owner = await start('collision');
  const idea = await owner.service.createIdea(owner.project, {
    title: 'Collision idea',
    description: 'Description',
    category: 'feature',
  });
  const store = owner.app.get(IdeaConversionStore);
  const intent = await store.prepare(
    owner.project,
    idea.id,
    await owner.service.convertToFeature(owner.project, idea.id)
  );
  const directory = getFeatureDir(owner.project, intent.feature.id),
    file = path.join(directory, 'feature.json');
  await mkdir(directory, { recursive: true });
  const foreign = JSON.stringify({
    id: intent.feature.id,
    title: 'Foreign card',
    description: 'Do not overwrite',
  });
  await writeFile(file, foreign);
  expect(
    await owner.post('convert', { projectPath: owner.project, ideaId: idea.id })
  ).toMatchObject({ status: 409 });
  expect(await readFile(file, 'utf8')).toBe(foreign);
  await writeFile(file, '{malformed');
  expect(
    (await owner.post('convert', { projectPath: owner.project, ideaId: idea.id })).status
  ).not.toBe(200);
  expect(await readFile(file, 'utf8')).toBe('{malformed');
  const filesystem = owner.app.get(SECURE_FILESYSTEM),
    read = filesystem.readFile.bind(filesystem);
  const spy = vi.spyOn(filesystem, 'readFile').mockImplementation((candidate, ...args) => {
    if (candidate === file)
      return Promise.reject(Object.assign(new Error('Owned IO failure'), { code: 'EIO' }));
    return read(candidate, ...args);
  });
  expect(
    (await owner.post('convert', { projectPath: owner.project, ideaId: idea.id })).status
  ).not.toBe(200);
  spy.mockRestore();
  expect(await readFile(file, 'utf8')).toBe('{malformed');
  expect((await readdir(path.dirname(file))).some((name) => name.includes('.tmp.'))).toBe(false);
});

class HeldProvider extends MockProvider {
  signals: AbortSignal[] = [];
  release?: () => void;
  constructor(private readonly releaseOnAbort: boolean) {
    super('claude');
  }
  protected async *execute(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    const signal = options.abortController!.signal;
    this.signals.push(signal);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.release = release;
    if (this.releaseOnAbort) signal.addEventListener('abort', release, { once: true });
    try {
      yield {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Partial fixture response' }],
        },
      };
      await held;
      yield {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Late response must not persist' }],
        },
      };
    } finally {
      signal.removeEventListener('abort', release);
    }
  }
}

it('keeps a stopped message owned until provider completion and persists partial user history', async () => {
  const provider = new HeldProvider(false),
    owner = await start('message-stop', provider);
  const session = await owner.service.startSession(owner.project);
  expect(
    await owner.post('session/message', { sessionId: session.id, message: 'Owned question' })
  ).toEqual({ status: 200, body: { success: true } });
  await vi.waitFor(() => expect(provider.signals).toHaveLength(1));
  const stopping = owner.post('session/stop', { sessionId: session.id });
  await vi.waitFor(() => expect(provider.signals[0].aborted).toBe(true));
  expect(owner.service.isSessionRunning(session.id)).toBe(true);
  await owner.post('session/message', {
    sessionId: session.id,
    message: 'Must not replace the active run',
  });
  expect(provider.signals).toHaveLength(1);
  provider.release!();
  expect((await stopping).status).toBe(200);
  const stored = await owner.service.getSession(owner.project, session.id);
  expect(stored?.messages.map((message) => message.content)).toEqual(['Owned question']);
  expect(stored?.status).toBe('completed');
});

it('aborts and drains owned messages on shutdown without interrupting another application', async () => {
  const one = new HeldProvider(true),
    two = new HeldProvider(true);
  const first = await start('shutdown-one', one),
    second = await start('shutdown-two', two);
  expect((first.service as unknown as { filesystem: unknown }).filesystem).toBe(
    first.app.get(SECURE_FILESYSTEM)
  );
  const firstSession = await first.service.startSession(first.project),
    secondSession = await second.service.startSession(second.project);
  await first.post('session/message', { sessionId: firstSession.id, message: 'One' });
  await second.post('session/message', { sessionId: secondSession.id, message: 'Two' });
  await vi.waitFor(() => expect(one.signals.length + two.signals.length).toBe(2));
  await first.app.close();
  expect(one.signals[0].aborted).toBe(true);
  expect(two.signals[0].aborted).toBe(false);
  expect(second.service.isSessionRunning(secondSession.id)).toBe(true);
  two.release!();
  await vi.waitFor(() => expect(second.service.isSessionRunning(secondSession.id)).toBe(false));
  const content = await readFile(
    path.join(path.dirname(getIdeasDir(first.project)), 'sessions', firstSession.id + '.json'),
    'utf8'
  );
  expect(
    JSON.parse(content).messages.map((message: { content: string }) => message.content)
  ).toEqual(['One']);
  expect(() => first.service.launchAnalysis(first.project)).toThrow('shutting down');
  expect(
    await second.service.createIdea(second.project, {
      title: 'Still active',
      description: 'Owned',
      category: 'feature',
    })
  ).toMatchObject({ title: 'Still active' });
});

it('uses captured repository/analysis filesystems across two apps despite hostile legacy IO', async () => {
  const first = await start('collaborator-one'),
    second = await start('collaborator-two');
  for (const runtime of [first, second]) {
    const collaborators = runtime.service as unknown as {
      ideas: { filesystem: unknown };
      analysis: { filesystem: unknown };
    };
    expect(collaborators.ideas.filesystem).toBe(runtime.app.get(SECURE_FILESYSTEM));
    expect(collaborators.analysis.filesystem).toBe(runtime.app.get(SECURE_FILESYSTEM));
    await writeFile(
      path.join(runtime.project, 'package.json'),
      JSON.stringify({ name: path.basename(runtime.project), dependencies: { react: 'fixture' } })
    );
  }
  for (const method of ['readFile', 'writeFile', 'readdir'] as const)
    vi.spyOn(legacyFilesystem, method).mockImplementation(() => {
      throw new Error('ambient filesystem forbidden');
    });
  for (const [index, runtime] of [first, second].entries()) {
    const created = await runtime.post('ideas/create', {
      projectPath: runtime.project,
      idea: { title: `Owned ${index}`, description: 'captured filesystem', category: 'feature' },
    });
    expect(created).toMatchObject({
      status: 200,
      body: { success: true, idea: { title: `Owned ${index}` } },
    });
    expect((await runtime.service.getIdeas(runtime.project)).map((idea) => idea.title)).toEqual([
      `Owned ${index}`,
    ]);
    expect((await runtime.post('analyze', { projectPath: runtime.project })).status).toBe(200);
    await vi.waitFor(async () =>
      expect(await runtime.service.getCachedAnalysis(runtime.project)).toMatchObject({
        projectPath: runtime.project,
        dependencies: ['react'],
      })
    );
  }
  expect((await first.service.getIdeas(first.project))[0].title).toBe('Owned 0');
});

it('serializes actual concurrent HTTP idea patches and drains a held repository write before FS shutdown', async () => {
  const runtime = await start('repository-mutations');
  const idea = await runtime.service.createIdea(runtime.project, {
    title: 'Original',
    description: 'Original body',
    category: 'feature',
  });
  const filesystem = runtime.app.get(SECURE_FILESYSTEM);
  const originalRead = filesystem.readFile.bind(filesystem);
  let releaseRead!: () => void;
  const heldRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let captured = false,
    readCount = 0;
  vi.spyOn(filesystem, 'readFile').mockImplementation(
    async (...args: Parameters<typeof filesystem.readFile>) => {
      const content = await originalRead(...args);
      if (String(args[0]) === getIdeaPath(runtime.project, idea.id)) {
        readCount++;
        if (!captured) {
          captured = true;
          await heldRead;
        }
      }
      return content;
    }
  );
  const serialization = vi.spyOn(runtime.app.get(ProjectFeatureSerializer), 'run');
  const title = runtime.post('ideas/update', {
    projectPath: runtime.project,
    ideaId: idea.id,
    updates: { title: 'Changed title' },
  });
  await vi.waitFor(() => expect(captured).toBe(true));
  const notes = runtime.post('ideas/update', {
    projectPath: runtime.project,
    ideaId: idea.id,
    updates: { notes: 'Independent notes' },
  });
  try {
    await vi.waitFor(() => expect(serialization).toHaveBeenCalledTimes(2));
    expect(readCount).toBe(1);
  } finally {
    releaseRead();
  }
  expect((await title).status).toBe(200);
  expect((await notes).status).toBe(200);
  expect(await runtime.service.getIdea(runtime.project, idea.id)).toMatchObject({
    title: 'Changed title',
    notes: 'Independent notes',
  });
  const originalWrite = filesystem.writeFile.bind(filesystem);
  let releaseWrite!: () => void;
  const heldWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  let writing = false;
  vi.spyOn(filesystem, 'writeFile').mockImplementation(
    async (...args: Parameters<typeof filesystem.writeFile>) => {
      if (String(args[0]).startsWith(getIdeaPath(runtime.project, idea.id) + '.tmp.')) {
        writing = true;
        await heldWrite;
      }
      return originalWrite(...args);
    }
  );
  const update = runtime.post('ideas/update', {
    projectPath: runtime.project,
    ideaId: idea.id,
    updates: { description: 'Drained update' },
  });
  await vi.waitFor(() => expect(writing).toBe(true));
  const closingOwner = vi.spyOn(runtime.service, 'onModuleDestroy');
  const barrier = vi.spyOn(filesystem, 'beforeApplicationShutdown');
  let closed = false;
  const closing = runtime.app.close().then(() => {
    closed = true;
  });
  try {
    await vi.waitFor(() => expect(closingOwner).toHaveBeenCalledOnce());
    expect(closed).toBe(false);
    expect(barrier).not.toHaveBeenCalled();
  } finally {
    releaseWrite();
  }
  expect((await update).status).toBe(200);
  await closing;
  expect(barrier).toHaveBeenCalledOnce();
  expect(JSON.parse(await readFile(getIdeaPath(runtime.project, idea.id), 'utf8'))).toMatchObject({
    title: 'Changed title',
    notes: 'Independent notes',
    description: 'Drained update',
  });
});

class NormalizedTextProvider extends MockProvider {
  readonly calls: ExecuteOptions[] = [];
  protected async *execute(options: ExecuteOptions): AsyncGenerator<ProviderMessage> {
    this.calls.push(options);
    yield {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'partial-' },
          { type: 'text', text: 'text' },
        ],
      },
    };
    yield {
      type: 'result',
      subtype: 'success',
      result:
        this.calls.length === 1
          ? 'Final answer'
          : JSON.stringify([
              { title: 'Structured idea', description: 'Final JSON', priority: 'high' },
            ]),
    };
    yield {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: this.calls.length === 1 ? '!' : ' ' }],
      },
    };
  }
}

it('shares native text normalization while preserving message progress and structured suggestion results', async () => {
  const provider = new NormalizedTextProvider('claude');
  const runtime = await start('text-normalization', provider);
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const unsubscribe = runtime.app
    .get<EventEmitter>(APPLICATION_EVENTS)
    .subscribe((type, payload) =>
      events.push({ type, payload: payload as Record<string, unknown> })
    );
  try {
    const session = await runtime.service.startSession(runtime.project);
    expect(
      (await runtime.post('session/message', { sessionId: session.id, message: 'Question' })).status
    ).toBe(200);
    await vi.waitFor(() => expect(runtime.service.isSessionRunning(session.id)).toBe(false));
    expect(
      (await runtime.service.getSession(runtime.project, session.id))?.messages.map(
        (message) => message.content
      )
    ).toEqual(['Question', 'Final answer!']);
    expect(
      events
        .filter((event) => event.type === 'ideation:stream' && event.payload.type === 'stream')
        .map((event) => event.payload.content)
    ).toEqual(['partial-', 'partial-text', 'Final answer!']);
    const prompt = runtime.service.getAllPrompts()[0];
    const result = await runtime.post('suggestions/generate', {
      projectPath: runtime.project,
      promptId: prompt.id,
      category: prompt.category,
      count: 1,
    });
    expect(result).toMatchObject({
      status: 200,
      body: {
        success: true,
        suggestions: [{ title: 'Structured idea', description: 'Final JSON', priority: 'high' }],
      },
    });
    expect(
      events
        .filter((event) => event.type === 'ideation:suggestions')
        .map((event) => event.payload.type)
    ).toEqual(['started', 'complete']);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]).toMatchObject({
      maxTurns: 1,
      originalModel: expect.any(String),
      cwd: runtime.project,
    });
    expect(provider.calls[1]).toMatchObject({
      maxTurns: 1,
      allowedTools: [],
      readOnly: true,
      cwd: runtime.project,
    });
  } finally {
    unsubscribe();
  }
});
