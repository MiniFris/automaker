import { expect, it } from 'vitest';
import {
  IMAGE_MAX_BYTES,
  DOWNLOAD_MAX_BYTES,
  DIRECTORY_DOWNLOAD_MAX_BYTES,
  IMAGE_CACHE_CONTROL,
  ImageBinaryBodySchema,
  ImageBinaryResponseDescriptorSchema,
  DownloadBinaryResponseDescriptorSchema,
} from '../src/domains/files-binary-responses.js';

const image = {
  status: 200,
  byteLength: 3,
  headers: {
    'Content-Type': 'image/png',
    'Cache-Control': IMAGE_CACHE_CONTROL,
    'Content-Length': '3',
  },
};
const file = {
  kind: 'file',
  status: 200,
  byteLength: 3,
  headers: {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': 'attachment; filename="fixture.bin"',
    'Content-Length': '3',
  },
};
const directory = {
  kind: 'directory',
  status: 200,
  byteLength: 3,
  directoryBytes: 2,
  headers: {
    'Content-Type': 'application/zip',
    'Content-Disposition': 'attachment; filename="fixture.zip"',
    'Content-Length': '3',
    'X-Directory-Size': '2',
  },
};
it('validates binary bytes without JSON conversion, mutation or buffering a stream', () => {
  const body = new Uint8Array([0, 255, 128]);
  expect(ImageBinaryBodySchema.parse(body)).toBe(body);
  expect([...body]).toEqual([0, 255, 128]);
  expect(ImageBinaryBodySchema.parse(new Uint8Array())).toHaveLength(0);
  expect(() => ImageBinaryBodySchema.parse(new Uint8Array(IMAGE_MAX_BYTES + 1))).toThrow();
  for (const bad of ['text', [0, 255], { byteLength: 3 }, null])
    expect(ImageBinaryBodySchema.safeParse(bad).success).toBe(false);
});
it('accepts actual image, regular file, ZIP and zero-byte metadata without introducing envelopes', () => {
  expect(ImageBinaryResponseDescriptorSchema.parse(image)).toEqual(image);
  for (const value of [
    file,
    directory,
    { ...file, byteLength: 0, headers: { ...file.headers, 'Content-Length': '0' } },
  ]) {
    expect(DownloadBinaryResponseDescriptorSchema.parse(value)).toEqual(value);
    expect(value).not.toHaveProperty('success');
  }
  expect(
    DownloadBinaryResponseDescriptorSchema.parse({
      ...directory,
      byteLength: DOWNLOAD_MAX_BYTES,
      directoryBytes: DIRECTORY_DOWNLOAD_MAX_BYTES,
      headers: {
        ...directory.headers,
        'Content-Length': String(DOWNLOAD_MAX_BYTES),
        'X-Directory-Size': String(DIRECTORY_DOWNLOAD_MAX_BYTES),
      },
    })
  ).toBeDefined();
});
it.each([
  { ...image, status: 201 },
  { ...image, byteLength: 4 },
  { ...image, byteLength: IMAGE_MAX_BYTES + 1 },
  { ...image, headers: { ...image.headers, 'Content-Type': 'text/html' } },
  { ...image, headers: { ...image.headers, 'Cache-Control': 'public, max-age=999999' } },
  { ...image, headers: { ...image.headers, 'Content-Length': '03' } },
])('rejects invalid image descriptor before bytes are sent (%#)', (value) => {
  expect(ImageBinaryResponseDescriptorSchema.safeParse(value).success).toBe(false);
});
it.each([
  { ...file, byteLength: NaN },
  { ...file, byteLength: -1 },
  { ...file, byteLength: 0.5 },
  { ...file, byteLength: DOWNLOAD_MAX_BYTES + 1 },
  { ...file, headers: { ...file.headers, 'Content-Length': '4' } },
  { ...file, headers: { ...file.headers, 'Content-Type': 'text/html' } },
  {
    ...file,
    headers: { ...file.headers, 'Content-Disposition': 'attachment; filename="bad\r\nheader"' },
  },
  {
    ...file,
    headers: {
      ...file.headers,
      'Content-Disposition': 'attachment; filename="' + 'x'.repeat(8192) + '"',
    },
  },
  { ...file, headers: { ...file.headers, 'X-Directory-Size': '1' } },
  { ...directory, directoryBytes: DIRECTORY_DOWNLOAD_MAX_BYTES + 1 },
  { ...directory, headers: { ...directory.headers, 'X-Directory-Size': '3' } },
  { ...directory, headers: { ...directory.headers, 'Content-Type': 'application/octet-stream' } },
])('rejects invalid streamed download metadata without reading its bytes (%#)', (value) => {
  expect(DownloadBinaryResponseDescriptorSchema.safeParse(value).success).toBe(false);
});
