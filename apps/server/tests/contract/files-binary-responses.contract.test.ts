import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { ImageQueryService } from '../../src/modules/files/image-query.service.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import {
  ImageBinaryResponseDescriptorSchema,
  DownloadBinaryResponseDescriptorSchema,
  IMAGE_FILE_MIME_TYPES,
  DOWNLOAD_MAX_BYTES,
} from '@automaker/contracts/domains/files-binary-responses';

let root: string,
  project: string,
  base: string,
  runtime: Awaited<ReturnType<typeof createNestApplication>>;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-binary-contract-'));
  project = path.join(root, 'project');
  await fs.mkdir(project);
  runtime = await createNestApplication({
    workingDirectory: project,
    dataDir: path.join(project, 'data'),
    host: '127.0.0.1',
    port: 0,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      ALLOWED_ROOT_DIRECTORY: project,
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  await runtime.start();
  base = `http://127.0.0.1:${runtime.app.getHttpServer().address().port}/api/fs/`;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await runtime?.app.close();
  await fs.rm(root, { recursive: true, force: true });
});
function image(candidate: string) {
  return fetch(base + 'image?path=' + encodeURIComponent(candidate), {
    headers: { 'x-api-key': 'fixture', Connection: 'close' },
  });
}
function download(filePath: string, key = 'fixture') {
  return fetch(base + 'download', {
    method: 'POST',
    headers: { 'x-api-key': key, 'content-type': 'application/json', Connection: 'close' },
    body: JSON.stringify({ filePath }),
  });
}
function imageDescriptor(response: Response, byteLength: number) {
  return {
    status: response.status,
    byteLength,
    headers: {
      'Content-Type': response.headers.get('content-type'),
      'Cache-Control': response.headers.get('cache-control'),
      'Content-Length': response.headers.get('content-length'),
    },
  };
}
function downloadDescriptor(response: Response, byteLength: number, directoryBytes?: number) {
  return {
    status: response.status,
    kind: directoryBytes === undefined ? 'file' : 'directory',
    byteLength,
    ...(directoryBytes === undefined ? {} : { directoryBytes }),
    headers: {
      'Content-Type': response.headers.get('content-type'),
      'Content-Disposition': response.headers.get('content-disposition'),
      'Content-Length': response.headers.get('content-length'),
      ...(directoryBytes === undefined
        ? {}
        : { 'X-Directory-Size': response.headers.get('x-directory-size') }),
    },
  };
}

it('serves supported extension MIME types and exact opaque binary image bytes with validated cache/length headers', async () => {
  const bytes = Buffer.from([0, 255, 128, 13, 10, 65]);
  for (const [extension, mime] of Object.entries(IMAGE_FILE_MIME_TYPES)) {
    const file = path.join(project, 'image' + extension);
    await fs.writeFile(file, bytes);
    const response = await image(file),
      received = Buffer.from(await response.arrayBuffer());
    expect(received).toEqual(bytes);
    expect(response.headers.get('content-type')).toBe(mime);
    expect(
      ImageBinaryResponseDescriptorSchema.parse(imageDescriptor(response, received.length))
    ).toBeDefined();
  }
  const empty = path.join(project, 'empty.png');
  await fs.writeFile(empty, '');
  const response = await image(empty);
  expect((await response.arrayBuffer()).byteLength).toBe(0);
  expect(ImageBinaryResponseDescriptorSchema.parse(imageDescriptor(response, 0))).toBeDefined();
});

it('streams regular/empty files and ZIP bytes using descriptor length as the actual scoped stream bound', async () => {
  const directory = path.join(project, 'archive');
  await fs.mkdir(directory);
  const bytes = Buffer.from([0, 255, 128, 65]),
    file = path.join(directory, 'quoted"\nfile.bin');
  await fs.writeFile(file, bytes);
  await fs.writeFile(path.join(directory, 'empty'), '');
  const filesystem = runtime.app.get(SECURE_FILESYSTEM),
    pipe = filesystem.pipeFile.bind(filesystem);
  const bounded: number[] = [];
  vi.spyOn(filesystem, 'pipeFile').mockImplementation((candidate, response, options) => {
    expect(Number(response.getHeader('Content-Length'))).toBe(options?.maxBytes);
    bounded.push(options!.maxBytes!);
    return pipe(candidate, response, options);
  });
  for (const candidate of [file, path.join(directory, 'empty')]) {
    const response = await download(candidate),
      received = Buffer.from(await response.arrayBuffer());
    expect(received).toEqual(candidate === file ? bytes : Buffer.alloc(0));
    expect(
      DownloadBinaryResponseDescriptorSchema.parse(downloadDescriptor(response, received.length))
    ).toBeDefined();
    expect(response.headers.get('content-disposition')).not.toContain('\n');
  }
  const zipped = await download(directory),
    received = new Uint8Array(await zipped.arrayBuffer());
  expect(
    DownloadBinaryResponseDescriptorSchema.parse(
      downloadDescriptor(zipped, received.length, bytes.length)
    )
  ).toBeDefined();
  const archive = unzipSync(received);
  expect(archive['archive/quoted"\nfile.bin']).toEqual(new Uint8Array(bytes));
  expect(archive['archive/empty']).toHaveLength(0);
  expect(bounded).toEqual([bytes.length, 0, received.length]);
  await vi.waitFor(async () =>
    expect(await fs.readdir(path.join(project, 'data', '.automaker-downloads'))).toEqual([])
  );
});

it('rejects malformed image producer replies before committing image headers or sending a JSON-shaped body', async () => {
  const service = runtime.app.get(ImageQueryService);
  const load = vi.spyOn(service, 'load');
  for (const invalid of [
    { content: Buffer.from('owned'), mimeType: 'text/html' },
    { content: 'not binary', mimeType: 'image/png' },
  ]) {
    load.mockResolvedValue(invalid as never);
    const response = await image(path.join(project, 'fixture.png'));
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBeNull();
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Internal server error.',
    });
  }
  const body = new Uint8Array([1, 0, 255, 128, 2]).subarray(1, 4);
  load.mockResolvedValue({ content: body, mimeType: 'image/png' } as never);
  const response = await image(path.join(project, 'fixture.png'));
  expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0, 255, 128]));
});

it('rejects invalid file metadata before headers/pipe and preserves quota/auth precedence', async () => {
  const file = path.join(project, 'fixture.bin');
  await fs.writeFile(file, 'owned');
  const filesystem = runtime.app.get(SECURE_FILESYSTEM),
    stat = filesystem.stat.bind(filesystem);
  const pipe = vi.spyOn(filesystem, 'pipeFile');
  const fake = vi.spyOn(filesystem, 'stat');
  for (const size of [NaN, -1, 0.5]) {
    fake.mockImplementation(async (candidate, ...args) =>
      Object.assign(await stat(candidate, ...args), { size })
    );
    const response = await download(file);
    expect(response.status).toBe(500);
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Internal server error.',
    });
  }
  fake.mockImplementation(async (candidate, ...args) =>
    Object.assign(await stat(candidate, ...args), { size: DOWNLOAD_MAX_BYTES + 1 })
  );
  const oversized = await download(file);
  expect(oversized.status).toBe(400);
  expect((await oversized.json()).error).toContain('500 MiB');
  const unauthorized = await download(file, 'wrong');
  expect(unauthorized.status).toBe(403);
  await unauthorized.arrayBuffer();
  expect(pipe).not.toHaveBeenCalled();
});

it('removes its temporary ZIP when final archive metadata fails binary validation before stream dispatch', async () => {
  const directory = path.join(project, 'archive');
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'file.bin'), 'owned');
  const filesystem = runtime.app.get(SECURE_FILESYSTEM),
    stat = filesystem.stat.bind(filesystem);
  vi.spyOn(filesystem, 'stat').mockImplementation(async (candidate, ...args) => {
    const value = await stat(candidate, ...args);
    return String(candidate).endsWith('/archive.zip') ? Object.assign(value, { size: NaN }) : value;
  });
  const pipe = vi.spyOn(filesystem, 'pipeFile');
  const response = await download(directory);
  expect(response.status).toBe(500);
  expect(response.headers.get('content-disposition')).toBeNull();
  await response.arrayBuffer();
  expect(pipe).not.toHaveBeenCalled();
  expect(await fs.readdir(path.join(project, 'data', '.automaker-downloads'))).toEqual([]);
});
