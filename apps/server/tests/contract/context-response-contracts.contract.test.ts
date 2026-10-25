import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { ContextDescriptionService } from '../../src/modules/context/context-description.service.js';
import { MockProvider } from '../helpers/mock-provider.js';
import {
  DescribeFileResponseSchema,
  DescribeImageResponseSchema,
} from '@automaker/contracts/domains/context';

const rich = '# Description\n\nUnicode: Пример 中文 🙂\n\n```ts\nconst value = 1;\n```';
class DescriptionProvider extends MockProvider {
  protected async *execute() {
    yield {
      type: 'assistant' as const,
      message: { role: 'assistant', content: [{ type: 'text', text: `  ${rich}  ` }] },
    };
    yield { type: 'result' as const, subtype: 'success' };
  }
}
let runtime: Awaited<ReturnType<typeof createNestApplication>>;
let root: string, project: string, base: string, file: string, image: string;
let provider: DescriptionProvider;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'context-response-'));
  project = path.join(root, 'project');
  await fs.mkdir(project);
  file = path.join(project, 'fixture.md');
  image = path.join(project, 'fixture.png');
  await fs.writeFile(file, '# Owned context fixture');
  await fs.writeFile(
    image,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=',
      'base64'
    )
  );
  provider = new DescriptionProvider('claude');
  runtime = await createNestApplication({
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
      ALLOWED_ROOT_DIRECTORY: root,
      AUTOMAKER_API_KEY: 'context-fixture',
    },
  });
  await runtime.start();
  base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/context/`;
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await runtime?.app.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});
async function call(route: string, target: string) {
  const response = await fetch(base + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'context-fixture' },
    body: JSON.stringify(route === 'describe-file' ? { filePath: target } : { imagePath: target }),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}
const operations = [
  ['describe-file', 'describeFile', DescribeFileResponseSchema],
  ['describe-image', 'describeImage', DescribeImageResponseSchema],
] as const;

it.each(operations)(
  'validates actual native HTTP %s with a fake provider and real scoped file',
  async (route, _method, schema) => {
    const response = await call(route, route === 'describe-file' ? file : image);
    expect(response.status).toBe(200);
    expect(schema.parse(response.body)).toEqual({ success: true, description: rich });
  }
);

it.each(operations)(
  'preserves rich and nullable envelope extensions at %s',
  async (route, method, schema) => {
    const output = {
      success: true,
      description: rich,
      extra: { nested: [null, { kept: true }] },
      historical: null,
    };
    vi.spyOn(runtime.app.get(ContextDescriptionService), method).mockResolvedValue(output);
    const response = await call(route, route === 'describe-file' ? file : image);
    expect(response.status).toBe(200);
    expect(schema.parse(response.body)).toEqual(output);
  }
);

it.each(operations)(
  'rejects malformed application payload at %s without leaking it',
  async (route, method) => {
    vi.spyOn(runtime.app.get(ContextDescriptionService), method).mockResolvedValue({
      success: true,
      description: 42,
      privateFixture: 'must-not-leak',
    } as never);
    const response = await call(route, route === 'describe-file' ? file : image);
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, error: 'Internal server error.' });
    expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
  }
);

it.each(operations)(
  'keeps missing and denied paths outside provider execution at %s',
  async (route) => {
    const execution = vi.spyOn(provider, 'executeQuery');
    const spy = vi.spyOn(
      runtime.app.get(ContextDescriptionService),
      route === 'describe-file' ? 'describeFile' : 'describeImage'
    );
    expect(
      (
        await call(
          route,
          path.join(project, 'missing.' + (route === 'describe-file' ? 'md' : 'png'))
        )
      ).status
    ).toBe(404);
    const calls = spy.mock.calls.length;
    expect((await call(route, path.join(path.dirname(root), 'outside-fixture.png'))).status).toBe(
      403
    );
    expect(spy.mock.calls).toHaveLength(calls);
    expect(execution).not.toHaveBeenCalled();
  }
);
