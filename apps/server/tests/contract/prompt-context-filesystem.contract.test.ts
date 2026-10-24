import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import { secureFs } from '@automaker/platform';
import { MockProvider } from '../helpers/mock-provider.js';

let root: string;
const applications: Awaited<ReturnType<typeof createNestApplication>>[] = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-context-'));
});
afterEach(async () => {
  await Promise.allSettled(applications.splice(0).map(({ app }) => app.close()));
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
async function owner(name: string) {
  const project = path.join(root, name);
  await fs.mkdir(project);
  const provider = new MockProvider('claude');
  const execute = vi.spyOn(provider, 'executeQuery');
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: project,
    dataDir: path.join(project, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [{ name: 'claude', create: () => provider }],
    environment: {
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      ALLOWED_ROOT_DIRECTORY: project,
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  applications.push(runtime);
  await runtime.start();
  const port = runtime.app.getHttpServer().address().port;
  const request = (projectPath?: string) =>
    fetch(`http://127.0.0.1:${port}/api/enhance-prompt`, {
      method: 'POST',
      headers: { 'x-api-key': 'fixture', 'content-type': 'application/json' },
      body: JSON.stringify({ originalText: 'Draft', enhancementMode: 'improve', projectPath }),
    });
  return {
    ...runtime,
    project,
    request,
    execute,
    filesystem: runtime.app.get<ReturnType<typeof secureFs.createSecureFs>>(SECURE_FILESYSTEM),
  };
}

it('reads real context through the application policy and permits the optional project path', async () => {
  const first = await owner('first'),
    second = await owner('second');
  const directory = path.join(first.project, '.automaker', 'features', 'feature');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'feature.json'),
    JSON.stringify({ id: 'feature', title: 'Owned title' })
  );
  await fs.writeFile(
    path.join(first.project, '.automaker', 'app_spec.txt'),
    '<project_name>Owned project</project_name>'
  );
  expect((await first.request()).status).toBe(200);
  expect((await first.request(first.project)).status).toBe(200);
  expect(first.execute.mock.calls.at(-1)?.[0]).toMatchObject({
    prompt: expect.stringContaining('Owned title'),
    readOnly: true,
    allowedTools: [],
  });
  expect((await first.request(second.project)).status).toBe(403);
  expect(second.execute).not.toHaveBeenCalled();
  expect((await second.request(second.project)).status).toBe(200);
});

it('does not silently recover/write corrupt feature context or invoke a provider after filesystem shutdown', async () => {
  const runtime = await owner('corrupt');
  const directory = path.join(runtime.project, '.automaker', 'features', 'feature');
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, 'feature.json');
  await fs.writeFile(target, '{broken');
  await fs.writeFile(target + '.bak1', JSON.stringify({ id: 'feature', title: 'Backup title' }));
  expect((await runtime.request(runtime.project)).status).toBe(503);
  expect(runtime.execute).not.toHaveBeenCalled();
  expect(await fs.readFile(target, 'utf8')).toBe('{broken');
  expect(await fs.readdir(directory)).toEqual(['feature.json', 'feature.json.bak1']);
  await runtime.filesystem.close();
  expect((await runtime.request(runtime.project)).status).toBe(503);
  expect(runtime.execute).not.toHaveBeenCalled();
});
