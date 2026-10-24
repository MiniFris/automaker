import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateDocument } from '../generate-backend-openapi.mjs';

const document = await generateDocument();
const inventory = JSON.parse(
  await readFile(
    new URL('../../docs/backend-nestjs-migration/artifacts/http-routes.json', import.meta.url),
    'utf8'
  )
);

test('every native route appears exactly once with a unique operation id', () => {
  const ids = new Set();
  for (const route of inventory.endpoints) {
    const path = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const operation = document.paths[path]?.[route.method.toLowerCase()];
    assert.ok(operation, `${route.method} ${path}`);
    assert.ok(!ids.has(operation.operationId), operation.operationId);
    ids.add(operation.operationId);
    assert.equal(operation['x-access'], route.access);
  }
  assert.equal(ids.size, document['x-coverage'].operations);
});

test('all generated references resolve and route placeholders are required parameters', () => {
  const serialized = JSON.stringify(document);
  for (const match of serialized.matchAll(/"\$ref":"#\/components\/schemas\/([^"\s]+)"/g))
    assert.ok(document.components.schemas[match[1]], match[1]);
  for (const [path, methods] of Object.entries(document.paths))
    for (const operation of Object.values(methods))
      for (const match of path.matchAll(/\{([^}]+)\}/g))
        assert.ok(
          operation.parameters?.some((p) => p.in === 'path' && p.name === match[1] && p.required)
        );
});

test('shared input schemas describe actual strict request fields and constraints', () => {
  const operation = document.paths['/api/features/create'].post;
  const ref = operation.requestBody.content['application/json'].schema.$ref;
  const schema = document.components.schemas[ref.split('/').at(-1)];
  assert.ok(schema.required.includes('projectPath'));
  assert.equal(schema.additionalProperties, false);
  const resize = document.components.schemas['worktree.WorktreeStageFilesSchema'];
  assert.equal(resize.properties.files.minItems, 1);
  assert.equal(resize.properties.files.maxItems, 1000);
});

test('unknown responses and inline input validators remain explicitly incomplete', () => {
  const operation = document.paths['/api/terminal/auth'].post;
  assert.equal(operation['x-request-contract'], 'incomplete');
  assert.equal(operation['x-response-contract'], 'unverified');
  assert.ok(operation['x-unresolved-inputs'].some((input) => input.in === 'body'));
  assert.equal(
    document['x-coverage'].unverifiedResponses + document['x-coverage'].sharedRuntimeResponses,
    inventory.endpoints.length
  );
  assert.ok(!JSON.stringify(document).includes('ZodValidationPipe'));
});

test('publishes an output schema only for a direct shared runtime parse response', () => {
  const operation = document.paths['/api/metrics'].get;
  assert.equal(operation['x-response-contract'], 'shared-runtime');
  const reference = operation.responses['200'].content['application/json'].schema.$ref;
  const schema = document.components.schemas[reference.split('/').at(-1)];
  assert.equal(schema.properties.seriesLimit.const, 2048);
  assert.ok(schema.required.includes('providerActiveQueries'));
  assert.equal(document.paths['/api/features/get'].post['x-response-contract'], 'unverified');
});

test('recognizes guarded whole-body validation without narrowing the terminal wire contract', () => {
  const operation = document.paths['/api/terminal/sessions'].post;
  assert.equal(operation['x-request-contract'], 'shared-or-no-input');
  assert.equal(operation.requestBody.required, false);
  assert.equal(operation['x-response-contract'], 'unverified');
  const reference = operation.requestBody.content['application/json'].schema.$ref;
  const schema = document.components.schemas[reference.split('/').at(-1)];
  assert.ok(schema.anyOf.some((variant) => variant.type === 'null'));
  const resize = document.paths['/api/terminal/sessions/{id}/resize'].post;
  assert.equal(resize['x-request-contract'], 'shared-or-no-input');
  assert.ok(resize.parameters.some((p) => p.in === 'path' && p.name === 'id' && p.schema.$ref));
});

test('includes shared success responses for header-only passthrough without inventing error schemas', () => {
  for (const [path, method] of [
    ['/api/health/detailed', 'get'],
    ['/api/auth/login', 'post'],
    ['/api/auth/logout', 'post'],
  ]) {
    const operation = document.paths[path][method];
    assert.equal(operation['x-response-contract'], 'shared-runtime');
    assert.ok(
      operation.responses['200'].content['application/json'].schema.$ref.endsWith('.Response')
    );
    assert.equal(operation.responses.default.content, undefined);
  }
});
