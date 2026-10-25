import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import type * as Filesystem from '../../src/lib/secure-fs.js';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';
import { FeatureExportService } from '../../src/services/feature-export-service.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';
import { FeatureQueryService } from '../../src/modules/features/feature-query.service.js';
import { FeatureCommandService } from '../../src/modules/features/feature-command.service.js';
import { FeatureTitleService } from '../../src/modules/features/feature-title.service.js';
import {
  FEATURE_REPOSITORY,
  type FeatureRepository,
} from '../../src/modules/features/feature.repository.js';
import { ProjectOverviewService } from '../../src/modules/projects/project-overview.service.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { ProjectsOverviewResponseSchema } from '@automaker/contracts';
import * as responses from '@automaker/contracts/domains/feature-responses';

let directory: string;
let project: string;
let runtime: Awaited<ReturnType<typeof createNestApplication>>;
let base: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-feature-responses-'));
  project = path.join(directory, 'project');
  await mkdir(project);
  runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: directory,
    dataDir: path.join(directory, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      ALLOWED_ROOT_DIRECTORY: directory,
      HOME: directory,
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  await runtime.start();
  base = `http://127.0.0.1:${(runtime.app.getHttpServer().address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await runtime?.app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function call(route: string, body?: unknown, method = 'POST') {
  const response = await fetch(`${base}/${route}`, {
    method,
    headers: { 'x-api-key': 'fixture', 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
const post = (operation: string, fields: Record<string, unknown> = {}) =>
  call(`features/${operation}`, { projectPath: project, ...fields });
async function create(id: string, fields: Record<string, unknown> = {}) {
  const result = await post('create', {
    feature: {
      id,
      title: id,
      description: 'Owned fixture',
      category: 'Custom category',
      ...fields,
    },
  });
  expect(result.status).toBe(200);
  return responses.FeatureRecordResponseSchema.parse(result.body).feature;
}

it('covers native CRUD/list/output wire with opaque IDs and extensible persisted feature fields', async () => {
  const id = 'opaque : [] feature';
  const extra = { legacyNested: { list: [null, false, 'kept'] }, customField: 4 };
  expect(await create(id, extra)).toMatchObject({ id, ...extra });
  for (const result of [
    await post('list'),
    await call(`features/list?projectPath=${encodeURIComponent(project)}`, undefined, 'GET'),
  ]) {
    expect(result.status).toBe(200);
    expect(responses.FeatureListResponseSchema.parse(result.body).features).toContainEqual(
      expect.objectContaining({ id, ...extra })
    );
  }
  const loaded = await post('get', { featureId: id });
  expect(loaded.status).toBe(200);
  expect(responses.FeatureRecordResponseSchema.parse(loaded.body).feature).toMatchObject(extra);
  const updated = await post('update', {
    featureId: id,
    updates: { customField: { newShape: true } },
  });
  expect(updated.status).toBe(200);
  expect(responses.FeatureRecordResponseSchema.parse(updated.body).feature.customField).toEqual({
    newShape: true,
  });
  for (const route of ['agent-output', 'raw-output'])
    expect(
      responses.FeatureOutputResponseSchema.parse((await post(route, { featureId: id })).body)
        .content
    ).toBeNull();
  const loader = runtime.app.get(FeatureLoader);
  await loader.saveAgentOutput(project, id, 'Markdown output');
  await runtime.app
    .get<typeof Filesystem>(SECURE_FILESYSTEM)
    .writeFile(loader.getRawOutputPath(project, id), '{"event":"line"}\n');
  expect(
    responses.FeatureOutputResponseSchema.parse(
      (await post('agent-output', { featureId: id })).body
    ).content
  ).toBe('Markdown output');
  expect(
    responses.FeatureOutputResponseSchema.parse((await post('raw-output', { featureId: id })).body)
      .content
  ).toBe('{"event":"line"}\n');
  const removed = await post('delete', { featureId: id });
  expect(removed.status).toBe(200);
  expect(responses.FeatureDeleteResponseSchema.parse(removed.body).success).toBe(true);
  expect((await post('get', { featureId: id })).status).toBe(404);
});

it('covers partial bulk update/delete outcomes without replacing their boolean success wire', async () => {
  await create('bulk-update');
  const updated = await post('bulk-update', {
    featureIds: ['bulk-update', 'missing-update'],
    updates: { unknownExtension: ['kept'] },
  });
  expect(updated.status).toBe(200);
  expect(responses.FeatureBulkUpdateResponseSchema.parse(updated.body)).toMatchObject({
    success: false,
    updatedCount: 1,
    failedCount: 1,
    features: [expect.objectContaining({ unknownExtension: ['kept'] })],
  });
  const repository = runtime.app.get<FeatureRepository>(FEATURE_REPOSITORY);
  vi.spyOn(repository, 'delete').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const deleted = await post('bulk-delete', { featureIds: ['first-delete', 'second-delete'] });
  expect(deleted.status).toBe(200);
  expect(responses.FeatureBulkDeleteResponseSchema.parse(deleted.body)).toMatchObject({
    success: false,
    deletedCount: 1,
    failedCount: 1,
  });
});

it('covers JSON/YAML export, conflict maps and raw/single/bulk import counts including partial/empty results', async () => {
  await create('exportable', { arbitraryExportMetadata: { kept: true } });
  const serializer = new FeatureExportService(runtime.app.get(FeatureLoader));
  for (const format of ['json', 'yaml']) {
    const result = await post('export', {
      format,
      featureIds: ['exportable'],
      metadata: { custom: ['kept'] },
    });
    expect(result.status).toBe(200);
    const exported = responses.FeatureExportResponseSchema.parse(result.body);
    const document = serializer.parseImportData(exported.data) as unknown as {
      count: number;
      features: { feature: Record<string, unknown> }[];
      metadata: unknown;
    };
    expect(document.count).toBe(1);
    expect(document.features).toHaveLength(1);
    expect(document.features[0].feature.arbitraryExportMetadata).toEqual({ kept: true });
    expect(document.metadata).toEqual({ custom: ['kept'] });
  }
  const conflictData = JSON.stringify({
    version: 'legacy',
    count: 2,
    features: [
      { feature: { id: 'exportable', title: { legacyTitle: true } } },
      { feature: { id: 'new-import', title: 'New' } },
    ],
  });
  const conflicts = await post('check-conflicts', { data: conflictData });
  expect(conflicts.status).toBe(200);
  expect(responses.FeatureConflictResponseSchema.parse(conflicts.body)).toMatchObject({
    hasConflicts: true,
    totalFeatures: 2,
    conflictCount: 1,
    conflicts: [expect.objectContaining({ title: { legacyTitle: true } }), expect.anything()],
  });
  const raw = {
    id: 'import opaque : []',
    title: 'Raw import',
    description: 'Raw',
    category: 'Custom',
    futureData: { kept: true },
  };
  let result = await post('import', { data: JSON.stringify(raw) });
  expect(result.status).toBe(200);
  expect(responses.FeatureImportResponseSchema.parse(result.body)).toMatchObject({
    success: true,
    importedCount: 1,
    failedCount: 0,
  });
  result = await post('import', { data: JSON.stringify(raw) });
  expect(result.status).toBe(200);
  expect(responses.FeatureImportResponseSchema.parse(result.body)).toMatchObject({
    success: false,
    importedCount: 0,
    failedCount: 1,
  });
  result = await post('import', {
    data: JSON.stringify({ version: 'legacy', exportedAt: 'legacy timestamp', feature: raw }),
    overwrite: true,
  });
  expect(result.status).toBe(200);
  expect(responses.FeatureImportResponseSchema.parse(result.body).results[0].wasOverwritten).toBe(
    true
  );
  result = await post('import', {
    data: JSON.stringify({
      version: 'legacy',
      features: [
        { version: 'legacy', feature: { ...raw, id: 'bulk-import-ok' }, exportedAt: 'legacy' },
        {
          version: 'legacy',
          feature: { id: 'invalid-import', title: 'Missing category' },
          exportedAt: 'legacy',
        },
      ],
    }),
  });
  expect(result.status).toBe(200);
  expect(responses.FeatureImportResponseSchema.parse(result.body)).toMatchObject({
    success: false,
    importedCount: 1,
    failedCount: 1,
  });
  result = await post('import', {
    data: JSON.stringify({
      version: 'legacy',
      features: ['all-valid-a', 'all-valid-b'].map((id) => ({
        version: 'legacy',
        exportedAt: 'legacy',
        feature: { ...raw, id },
      })),
    }),
  });
  expect(result.status).toBe(200);
  expect(responses.FeatureImportResponseSchema.parse(result.body)).toMatchObject({
    success: true,
    importedCount: 2,
    failedCount: 0,
  });
  expect(
    responses.FeatureRecordResponseSchema.parse(
      (await post('get', { featureId: 'all-valid-b' })).body
    ).feature.futureData
  ).toEqual({ kept: true });
  result = await post('import', { data: JSON.stringify({ version: 'legacy', features: [] }) });
  expect(result.status).toBe(200);
  expect(responses.FeatureImportResponseSchema.parse(result.body)).toMatchObject({
    success: true,
    importedCount: 0,
    failedCount: 0,
  });
  expect((await post('import', { data: '[unterminated' })).status).toBe(400);
});

it('covers orphan records, failed/successful single resolutions, partial bulk resolutions and generated title', async () => {
  const feature = await create('orphaned');
  const autoMode = runtime.app.get(AutoModeServiceCompat);
  vi.spyOn(autoMode, 'detectOrphanedFeatures').mockResolvedValue([
    { feature, missingBranch: 'legacy branch' },
  ] as never);
  const orphaned = await post('orphaned');
  expect(orphaned.status).toBe(200);
  expect(
    responses.FeatureOrphanedResponseSchema.parse(orphaned.body).orphanedFeatures[0].feature.id
  ).toBe('orphaned');
  let result = await post('orphaned/resolve', { featureId: 'orphaned', action: 'create-worktree' });
  expect(result.status).toBe(200);
  expect(responses.FeatureOperationResultSchema.parse(result.body)).toMatchObject({
    success: false,
    featureId: 'orphaned',
  });
  result = await post('orphaned/resolve', { featureId: 'orphaned', action: 'move-to-branch' });
  expect(result.status).toBe(200);
  expect(responses.FeatureOperationResultSchema.parse(result.body)).toMatchObject({
    success: true,
    action: 'moved',
  });
  await create('orphan-two');
  const repository = runtime.app.get<FeatureRepository>(FEATURE_REPOSITORY);
  vi.spyOn(repository, 'update').mockRejectedValueOnce(new Error('Fixture update failed'));
  result = await post('orphaned/bulk-resolve', {
    featureIds: ['orphaned', 'orphan-two'],
    action: 'move-to-branch',
  });
  expect(result.status).toBe(200);
  expect(responses.FeatureBulkResolveResponseSchema.parse(result.body)).toMatchObject({
    success: false,
    resolvedCount: 1,
    failedCount: 1,
  });
  result = await post('orphaned/resolve', { featureId: 'orphan-two', action: 'delete' });
  expect(result.status).toBe(200);
  expect(responses.FeatureOperationResultSchema.parse(result.body)).toMatchObject({
    success: true,
    action: 'deleted',
  });
  vi.spyOn(runtime.app.get(FeatureTitleService), 'generate').mockResolvedValue({
    success: true,
    title: 'Generated title',
  });
  result = await post('generate-title', { description: 'No model call' });
  expect(result.status).toBe(200);
  expect(responses.FeatureTitleResponseSchema.parse(result.body).title).toBe('Generated title');
});

it('preserves Projects overview runtime contract and rejects malformed application successes across every feature handler', async () => {
  await runtime.app.get(SettingsService).updateGlobalSettings({
    projects: [{ id: 'opaque project', name: 'Private fixture', path: project }],
  });
  const overview = await call('projects/overview', undefined, 'GET');
  expect(overview.status).toBe(200);
  expect(ProjectsOverviewResponseSchema.parse(overview.body).projects[0].projectId).toBe(
    'opaque project'
  );
  const queries = runtime.app.get(FeatureQueryService);
  const commands = runtime.app.get(FeatureCommandService);
  const titles = runtime.app.get(FeatureTitleService);
  const matrix: Array<{
    route: string;
    owner: object;
    method: string;
    result: unknown;
    input?: Record<string, unknown>;
    verb?: string;
  }> = [
    { route: 'list', owner: queries, method: 'list', result: { success: true, features: {} } },
    {
      route: `list?projectPath=${encodeURIComponent(project)}`,
      owner: queries,
      method: 'list',
      result: { success: true, features: {} },
      verb: 'GET',
    },
    {
      route: 'get',
      owner: queries,
      method: 'get',
      result: { success: true, feature: [] },
      input: { featureId: 'opaque' },
    },
    {
      route: 'agent-output',
      owner: queries,
      method: 'agentOutput',
      result: { success: true, content: {} },
      input: { featureId: 'opaque' },
    },
    {
      route: 'raw-output',
      owner: queries,
      method: 'rawOutput',
      result: { success: true },
      input: { featureId: 'opaque' },
    },
    {
      route: 'export',
      owner: queries,
      method: 'export',
      result: {
        success: true,
        data: '{}',
        format: 'json',
        filename: 'features-export.json',
        contentType: 'wrong',
      },
    },
    {
      route: 'check-conflicts',
      owner: queries,
      method: 'conflicts',
      result: {
        success: true,
        hasConflicts: true,
        conflicts: [],
        totalFeatures: 0,
        conflictCount: 1,
      },
      input: { data: '{}' },
    },
    {
      route: 'orphaned',
      owner: queries,
      method: 'orphaned',
      result: { success: true, orphanedFeatures: [{ feature: {}, missingBranch: null }] },
    },
    {
      route: 'create',
      owner: commands,
      method: 'create',
      result: { success: true, feature: null },
      input: { feature: {} },
    },
    {
      route: 'update',
      owner: commands,
      method: 'update',
      result: { success: true },
      input: { featureId: 'opaque', updates: { custom: true } },
    },
    {
      route: 'delete',
      owner: commands,
      method: 'remove',
      result: { success: 'yes' },
      input: { featureId: 'opaque' },
    },
    {
      route: 'bulk-update',
      owner: commands,
      method: 'bulkUpdate',
      result: { success: true, updatedCount: 1, failedCount: 0, results: [], features: [] },
      input: { featureIds: ['opaque'], updates: { custom: true } },
    },
    {
      route: 'bulk-delete',
      owner: commands,
      method: 'bulkDelete',
      result: { success: true, deletedCount: -1, failedCount: 0, results: [] },
      input: { featureIds: ['opaque'] },
    },
    {
      route: 'import',
      owner: commands,
      method: 'import',
      result: { success: true, importedCount: 1, failedCount: 0, results: [{ success: true }] },
      input: { data: '{}' },
    },
    {
      route: 'orphaned/resolve',
      owner: commands,
      method: 'resolveOrphan',
      result: { success: true },
      input: { featureId: 'opaque', action: 'delete' },
    },
    {
      route: 'orphaned/bulk-resolve',
      owner: commands,
      method: 'bulkResolveOrphans',
      result: {
        success: true,
        resolvedCount: 0,
        failedCount: 0,
        results: [{ featureId: 'opaque', success: true }],
      },
      input: { featureIds: ['opaque'], action: 'delete' },
    },
    {
      route: 'generate-title',
      owner: titles,
      method: 'generate',
      result: { success: true, title: '' },
      input: { description: 'No model call' },
    },
  ];
  for (const entry of matrix) {
    const mock = vi
      .spyOn(entry.owner as never, entry.method as never)
      .mockResolvedValue(entry.result as never);
    try {
      const result =
        entry.verb === 'GET'
          ? await call(`features/${entry.route}`, undefined, 'GET')
          : await post(entry.route, entry.input);
      expect(result.status, entry.route).toBe(500);
      expect(result.body.error).toBe('Internal server error.');
    } finally {
      mock.mockRestore();
    }
  }
  const mock = vi
    .spyOn(runtime.app.get(ProjectOverviewService), 'overview')
    .mockResolvedValue({ success: true, projects: [], aggregate: null } as never);
  expect((await call('projects/overview', undefined, 'GET')).status).toBe(500);
  mock.mockRestore();
  // Extensible legacy field values remain valid at the response boundary.
  const feature = {
    id: 'opaque : / []',
    title: { legacy: true },
    status: ['custom'],
    extra: { nested: true },
  };
  vi.spyOn(queries, 'get').mockResolvedValue({ success: true, feature } as never);
  expect((await post('get', { featureId: 'opaque' })).body).toEqual({ success: true, feature });
});

it('keeps filesystem/application error statuses rather than replacing them with response-validation errors', async () => {
  const queries = runtime.app.get(FeatureQueryService);
  const failure = Object.assign(new Error('private fixture IO'), { status: 503 });
  vi.spyOn(queries, 'list').mockRejectedValueOnce(failure);
  expect((await post('list')).status).toBe(503);
  await create('fs-error');
  const filesystem = runtime.app.get<typeof Filesystem>(SECURE_FILESYSTEM);
  const original = filesystem.readFile.bind(filesystem);
  const file = runtime.app.get(FeatureLoader).getFeatureJsonPath(project, 'fs-error');
  const reading = vi
    .spyOn(filesystem, 'readFile')
    .mockImplementation((...args) =>
      args[0] === file
        ? Promise.reject(Object.assign(new Error('Owned fixture EIO'), { code: 'EIO' }))
        : original(...args)
    );
  const ioFailure = await post('get', { featureId: 'fs-error' });
  expect(ioFailure.status).toBe(500);
  expect(ioFailure.body.code).toBe('EIO');
  reading.mockRestore();

  expect((await post('get', { featureId: 'still-missing' })).status).toBe(404);
  const repository = runtime.app.get<FeatureRepository>(FEATURE_REPOSITORY);
  vi.spyOn(repository, 'delete').mockResolvedValueOnce(false);
  const removed = await post('delete', { featureId: 'still-missing' });
  expect(removed.status).toBe(200);
  expect(removed.body).toEqual({ success: false });
});
