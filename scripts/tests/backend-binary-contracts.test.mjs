import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  binarySourceDigest,
  binarySourcesVerified,
  binaryOperationContract,
} from '../backend-binary-contracts.mjs';

const root = resolve(import.meta.dirname, '../..');
const read = (file) => readFile(resolve(root, file), 'utf8');
test('binary approval is independent of comments/formatting and sensitive to executable changes', () => {
  assert.equal(
    binarySourceDigest("const value = 'bytes';"),
    binarySourceDigest('// comment\n const value="bytes";\n')
  );
  assert.notEqual(binarySourceDigest('send(validated);'), binarySourceDigest('send(raw);'));
});
test('reviewed runtime graph exposes binary media, headers and budgets without a JSON envelope', async () => {
  assert.equal(await binarySourcesVerified(read), true);
  const image = await binaryOperationContract('FilesController.image', read);
  assert.equal(image['x-response-contract'], 'shared-binary-runtime');
  assert.equal(image.responses['200'].content['image/png'].schema.format, 'binary');
  assert.equal(image.responses['200']['x-max-response-bytes'], 20 * 1024 * 1024);
  assert.equal(
    image.responses['200'].headers['Cache-Control'].schema.const,
    'public, max-age=3600'
  );
  const download = await binaryOperationContract('FilesController.download', read);
  assert.equal(download.responses['200'].content['application/zip'].schema.type, 'string');
  assert.ok(download.responses['200'].headers['Content-Disposition'].schema.pattern);
  assert.equal(download.responses.default.content, undefined);
});
test('bypassed byte parsing, raw send and unbounded streams lose binary contract approval', async () => {
  const mutations = [
    [
      'apps/server/src/modules/files/files.controller.ts',
      'ImageBinaryBodySchema.parse(image.content)',
      'image.content',
    ],
    [
      'apps/server/src/modules/files/files.controller.ts',
      'Buffer.from(body.buffer, body.byteOffset, body.byteLength)',
      'Buffer.from(uncheckedBytes)',
    ],
    [
      'apps/server/src/modules/files/local-download.service.ts',
      'maxBytes: descriptor.byteLength',
      'maxBytes: undefined',
    ],
    [
      'apps/server/src/modules/files/local-download.service.ts',
      'DownloadBinaryResponseDescriptorSchema.parse',
      'uncheckedDescriptor',
    ],
  ];
  for (const [target, before, after] of mutations) {
    const content = await read(target);
    assert.ok(content.includes(before), before);
    const changed = (file) =>
      file === target ? Promise.resolve(content.replace(before, after)) : read(file);
    assert.equal(await binarySourcesVerified(changed), false, before);
    assert.equal(
      await binaryOperationContract('FilesController.download', changed),
      undefined,
      before
    );
  }
});
