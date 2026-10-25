import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { ESLint } from 'eslint';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import ts from 'typescript';
import { assertProductionServerArtifact } from '../../apps/server/scripts/check-build.mjs';

const cwd = path.resolve(import.meta.dirname, '../../apps/server');
const eslint = new ESLint({ cwd });

test('legacy handlers are absent from source, compiler roots and transitive imports', () => {
  assert.equal(ts.sys.directoryExists(path.join(cwd, 'src/routes')), false);
  const config = ts.readConfigFile(path.join(cwd, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, cwd);
  assert.equal(parsed.errors.length, 0);
  const routes = path.join(cwd, 'src/routes') + path.sep;
  assert.ok(!parsed.fileNames.some((file) => file.startsWith(routes)));
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  assert.ok(!program.getSourceFiles().some((file) => file.fileName.startsWith(routes)));
});

test('build guard rejects excluded legacy code emitted through a transitive import', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automaker-build-boundary-'));
  try {
    const source = path.join(root, 'src'),
      output = path.join(root, 'dist');
    for (const reserved of ['routes', 'legacy']) {
      await mkdir(path.join(source, reserved), { recursive: true });
      await writeFile(path.join(source, reserved, 'hidden.ts'), 'export const hidden = true;');
    }
    await writeFile(
      path.join(source, 'main.ts'),
      "import './routes/hidden.js'; import './legacy/hidden.js';"
    );
    const parsed = ts.parseJsonConfigFileContent(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          rootDir: 'src',
          outDir: 'dist',
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
        exclude: ['src/routes', 'src/legacy'],
      },
      ts.sys,
      root
    );
    assert.deepEqual(parsed.fileNames, [path.join(source, 'main.ts')]);
    assert.equal(ts.createProgram(parsed.fileNames, parsed.options).emit().emitSkipped, false);
    await assert.rejects(assertProductionServerArtifact(output), /must not contain routes/);
    await rm(path.join(output, 'routes'), { recursive: true });
    await assert.rejects(assertProductionServerArtifact(output), /must not contain legacy/);
    await rm(path.join(output, 'legacy'), { recursive: true });
    await assertProductionServerArtifact(output);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('controllers delegate filesystem, shell execution and route implementations', async () => {
  for (const source of [
    "import { spawn } from 'node:child_process'; export const run = spawn;",
    "import { readFile } from 'node:fs/promises'; export const read = readFile;",
    "export { handle } from '../../routes/legacy.js';",
  ]) {
    const [result] = await eslint.lintText(source, {
      filePath: 'src/modules/example/example.controller.ts',
    });
    assert.ok(
      result.messages.some(
        ({ ruleId, severity }) => ruleId === 'no-restricted-imports' && severity === 2
      )
    );
  }
});
for (const folder of ['services', 'providers']) {
  test(`${folder} rejects service locators and module-level service instances`, async () => {
    for (const source of [
      'export function getManagedTestRunnerService() { return cached; }',
      'export const getManagedTestRunnerService = () => cached;',
      'const service = new TestRunnerService(); export { service };',
      'export const service = new TestRunnerService();',
    ]) {
      const [result] = await eslint.lintText(source, {
        filePath: `src/${folder}/singleton-fixture.ts`,
      });
      assert.ok(
        result.messages.some(
          ({ ruleId, severity }) => ruleId === 'no-restricted-syntax' && severity === 2
        )
      );
    }
    const [allowed] = await eslint.lintText(
      'class TestRunnerService {} export function createOwner() { const service = new TestRunnerService(); return service; }',
      { filePath: `src/${folder}/owner-fixture.ts` }
    );
    assert.equal(allowed.errorCount, 0);
  });
  test(`${folder} cannot import route implementations, re-exports or controller types`, async () => {
    for (const source of [
      "import type { Snapshot } from '../routes/legacy.js'; export type Owned = Snapshot;",
      "export { execute } from '../routes/legacy.js';",
      "import { Controller } from '../modules/example/example.controller.js'; export const owner = Controller;",
    ]) {
      const [result] = await eslint.lintText(source, {
        filePath: `src/${folder}/boundary-fixture.ts`,
      });
      assert.ok(
        result.messages.some(
          ({ ruleId, severity }) => ruleId === 'no-restricted-imports' && severity === 2
        )
      );
    }
  });
  test(`${folder} may depend on transport-independent domain types`, async () => {
    const [result] = await eslint.lintText(
      "import type { Snapshot } from '../types/settings.js'; export type Owned = Snapshot;",
      { filePath: `src/${folder}/boundary-fixture.ts` }
    );
    assert.equal(result.errorCount, 0);
  });
}

for (const folder of ['core', 'modules']) {
  test(`${folder} cannot recover legacy route dependencies through imports or re-exports`, async () => {
    for (const source of [
      "import { generate } from '../../routes/app-spec/routes/generate.js'; export const workflow = generate;",
      "import type { Snapshot } from '@/routes/backlog-plan/common.js'; export type Owned = Snapshot;",
      "export { execute } from 'routes/legacy.js';",
      "export * from '../../routes/backlog-plan/routes/generate.js';",
    ]) {
      const [result] = await eslint.lintText(source, {
        filePath: `src/${folder}/example/boundary-fixture.ts`,
      });
      assert.ok(
        result.messages.some(
          ({ ruleId, severity }) => ruleId === 'no-restricted-imports' && severity === 2
        ),
        `${folder} must reject ${source}`
      );
    }
  });

  test(`${folder} may compose native controllers and domain ports`, async () => {
    const [result] = await eslint.lintText(
      "import { Controller } from './example.controller.js'; import type { Snapshot } from '../../types/settings.js'; export const controller = Controller; export type Owned = Snapshot;",
      { filePath: `src/${folder}/example/boundary-fixture.ts` }
    );
    assert.equal(result.errorCount, 0);
  });
}

const pureKernelPaths = [
  'src/modules/orchestration/feature-run-state-machine.ts',
  'src/core/errors/domain-errors.ts',
  'src/domain/future/pure-kernel.ts',
];
async function pureBoundaryRejected(source) {
  for (const filePath of pureKernelPaths) {
    const [result] = await eslint.lintText(source, { filePath });
    assert.ok(
      result.messages.some(
        (message) => message.ruleId === 'domain-boundaries/pure-kernel' && message.severity === 2
      ),
      `${filePath} must reject ${source}`
    );
  }
}
test('pure kernels reject framework, IO and application dependencies, including re-exports', async () => {
  for (const source of [
    "import { Injectable } from '@nestjs/common'; export const dependency = Injectable;",
    "import express from 'express'; export const dependency = express;",
    "import fs from 'node:fs/promises'; export const dependency = fs;",
    "import { exec } from 'child_process'; export const dependency = exec;",
    "export * from 'node:net';",
    "export { request } from 'node:http';",
    "export { ProviderRegistry } from '@/modules/providers/provider-registry.service.js';",
    "import { SettingsService } from '@/services/settings-service.js'; export const dependency = SettingsService;",
    "export * from '@/modules/features/features.controller.js';",
    "export * from '@/lib/unreviewed-helper.js';",
    "import { modelTimeout } from '@automaker/types'; export const dependency = modelTimeout;",
    "import type { Injectable } from '@nestjs/common'; export type Dependency = Injectable;",
  ])
    await pureBoundaryRejected(source);
});
test('pure kernels reject dynamic imports and require even when a target looks like a pure helper', async () => {
  for (const source of [
    "export const dependency = import('node:fs');",
    "export const dependency = import('@/domain/helper.js');",
    "export const dependency = require('node:fs');",
    "import dependency = require('node:fs'); export { dependency };",
  ])
    await pureBoundaryRejected(source);
});
test('pure kernels reject ambient process, network and timer access, including aliases via global objects', async () => {
  for (const source of [
    'export const environment = process.env;',
    "export const request = () => fetch('https://example.invalid');",
    'export const schedule = () => setTimeout(() => {}, 1);',
    'export const schedule = () => setInterval(() => {}, 1);',
    'export const schedule = () => queueMicrotask(() => {});',
    'export const schedule = () => AbortSignal.timeout(1);',
    'export const schedule = () => requestAnimationFrame(() => {});',
    'export const request = globalThis.fetch;',
    "export const environment = globalThis['process'];",
    'const { fetch: request } = globalThis; export { request };',
    'const runtime = globalThis; export const schedule = () => runtime.setTimeout(() => {}, 1);',
    'export const write = () => console.log("IO");',
    'export const load = Function("return import(\\"node:fs\\")");',
  ])
    await pureBoundaryRejected(source);
});
test('pure kernels allow explicit values, type-only contracts and guarded pure helpers', async () => {
  for (const filePath of pureKernelPaths) {
    const [result] = await eslint.lintText(
      `
      import type { Feature } from '@automaker/types';
      import { type Feature as FeatureAlias } from '@automaker/types';
      import { DomainError } from '@/core/errors/domain-errors.js';
      import { canTransitionFeatureRun } from '@/modules/orchestration/feature-run-state-machine.js';
      export { normalize } from '@/domain/normalize.js';
      export type { Feature as PublicFeature } from '@automaker/types';
      export function transition(from: 'queued', to: 'preparing', process: Feature | FeatureAlias) {
        if (!canTransitionFeatureRun(from, to)) throw new DomainError('Invalid transition', 'CONFLICT', 409);
        return { ...process, status: to };
      }
    `,
      { filePath }
    );
    assert.equal(result.errorCount, 0, `${filePath}: ${JSON.stringify(result.messages)}`);
  }
});
test('actual pure kernels and all current domain helpers satisfy the enforced boundary', async () => {
  const sources = [pureKernelPaths[0], pureKernelPaths[1]];
  if (ts.sys.directoryExists(path.join(cwd, 'src/domain'))) sources.push('src/domain/**/*.ts');
  const results = await eslint.lintFiles(sources);
  assert.ok(results.length >= 2);
  for (const result of results)
    assert.equal(result.errorCount, 0, `${result.filePath}: ${JSON.stringify(result.messages)}`);
});

test('pure-kernel overlay retains existing core/module import and ambient-environment guards', async () => {
  for (const filePath of pureKernelPaths.slice(0, 2)) {
    const [result] = await eslint.lintText(
      "export * from '@/routes/legacy.js'; export const environment = process.env.PORT;",
      { filePath }
    );
    for (const ruleId of [
      'no-restricted-imports',
      'no-restricted-syntax',
      'domain-boundaries/pure-kernel',
    ])
      assert.ok(
        result.messages.some((message) => message.ruleId === ruleId && message.severity === 2),
        `${filePath} lost ${ruleId}`
      );
  }
});

for (const filePath of ['src/core/example/consumer.ts', 'src/modules/example/consumer.ts']) {
  test(`${filePath} consumes AutoMode through ports and rejects runtime owner backdoors`, async () => {
    for (const source of [
      "import { AutoModeServiceCompat } from '@/services/auto-mode/index.js'; export const owner = AutoModeServiceCompat;",
      "import { AutoModeRuntime } from '@/services/auto-mode/runtime.js'; export const owner = AutoModeRuntime;",
      "export { AutoModeServiceCompat as Alias } from '../../services/auto-mode/compat.js';",
      "export * from '@/services/auto-mode/facade.js';",
      "import * as owner from '@/services/auto-mode'; export { owner };",
      "export const owner = import('@/services/auto-mode/global-service.js');",
      "export const owner = require('@/services/auto-mode/compat.js');",
      "import owner = require('@/services/auto-mode/compat.js'); export { owner };",
      'export const owner = import(`@/services/auto-mode/index.js`);',
      'export function load(name: string) { return import(name); }',
    ]) {
      const [result] = await eslint.lintText(source, { filePath });
      assert.ok(
        result.messages.some(
          (message) =>
            message.ruleId === 'auto-mode-boundaries/public-ports' && message.severity === 2
        ),
        `${filePath}: ${source}`
      );
    }
    const [allowed] = await eslint.lintText(
      "import { FEATURE_RUN_READ_MODEL, type FeatureRunReadModel } from '@/modules/auto-mode/auto-mode.ports.js'; import type { RunningAgentInfo } from '@/services/auto-mode/types.js'; export const token=FEATURE_RUN_READ_MODEL; export type Reader=Pick<FeatureRunReadModel,'getRunningAgents'>; export type Agent=RunningAgentInfo;",
      { filePath }
    );
    assert.equal(allowed.errorCount, 0, JSON.stringify(allowed.messages));
  });
}
test('only the native AutoMode module and factory assemble the runtime owner, retaining previous guards', async () => {
  for (const filePath of [
    'src/modules/auto-mode/auto-mode.module.ts',
    'src/modules/auto-mode/auto-mode.provider.ts',
  ]) {
    const [allowed] = await eslint.lintText(
      "import { AutoModeServiceCompat } from '../../services/auto-mode/index.js'; export const owner=AutoModeServiceCompat;",
      { filePath }
    );
    assert.equal(allowed.errorCount, 0, JSON.stringify(allowed.messages));
    const [legacy] = await eslint.lintText(
      "export * from '@/routes/legacy.js'; export const config=process.env.PORT;",
      { filePath }
    );
    for (const ruleId of ['no-restricted-imports', 'no-restricted-syntax'])
      assert.ok(
        legacy.messages.some((message) => message.ruleId === ruleId && message.severity === 2)
      );
  }
});

test('plain application services and independent inputs reject framework and transport DTO imports', async () => {
  const paths = [
    'src/modules/auto-mode/auto-mode-application.service.ts',
    'src/modules/features/feature-command.service.ts',
    'src/modules/settings/settings-query.service.ts',
    'src/modules/features/application.inputs.ts',
  ];
  for (const filePath of paths)
    for (const source of [
      "import {Injectable} from '@nestjs/common'; export const x=Injectable;",
      "import type {Request} from 'express'; export type Input=Request;",
      "import type {FeatureCreateRequest as Input} from './feature.schemas.js'; export type Command=Input;",
      "import type {FeatureCreateRequest as Input} from '@automaker/contracts'; export type Command=Input;",
      "export type {FeatureCreateRequest} from '@automaker/contracts';",
      "export * from './feature.schemas.js';",
      "const dependency=import('@nestjs/common'); export {dependency};",
      "const dependency=require('@nestjs/common'); export {dependency};",
    ]) {
      const [result] = await eslint.lintText(source, { filePath });
      assert.ok(
        result.messages.some(
          (message) =>
            message.ruleId === 'application-boundaries/plain-use-case' && message.severity === 2
        ),
        filePath + ' ' + source
      );
    }
});
test('plain application constructors accept explicit domain values; factories alone own Nest assembly', async () => {
  for (const [filePath, source] of [
    [
      'src/modules/features/feature-command.service.ts',
      "import type {Feature} from '@automaker/types'; import type {FeatureCreateInput} from './application.inputs.js'; export class UseCase {constructor(private readonly save:(input:FeatureCreateInput)=>Promise<Feature>){} run(input:FeatureCreateInput){return this.save(input);}}",
    ],
    [
      'src/modules/features/application.inputs.ts',
      'export interface FeatureCreateInput {projectPath:string;feature:Record<string,unknown>}',
    ],
    [
      'src/modules/features/application.providers.ts',
      "import type {FactoryProvider} from '@nestjs/common'; export const provider:FactoryProvider={provide:'usecase',inject:[],useFactory:()=>({})};",
    ],
  ]) {
    const [result] = await eslint.lintText(source, { filePath });
    assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
  }
  const results = await eslint.lintFiles([
    'src/modules/**/*application.service.ts',
    'src/modules/**/*command.service.ts',
    'src/modules/**/*query.service.ts',
    'src/modules/*/application.inputs.ts',
  ]);
  assert.ok(results.length >= 19);
  assert.equal(
    results
      .flatMap((result) => result.messages)
      .filter((message) => message.ruleId === 'application-boundaries/plain-use-case').length,
    0
  );
});

test('plain services reject runtime framework imports while retaining erased lifecycle type interfaces', async () => {
  for (const filePath of ['src/services/plain-service.ts', 'src/services/agent/agent-worker.ts']) {
    for (const source of [
      "import {Injectable} from '@nestjs/common'; export const decorator=Injectable;",
      "import express from 'express'; export const server=express();",
      "export {HttpException} from '@nestjs/common';",
    ]) {
      const [result] = await eslint.lintText(source, { filePath });
      assert.ok(
        result.messages.some(
          (message) => message.ruleId === 'no-restricted-imports' && message.severity === 2
        ),
        filePath + ' ' + source
      );
    }
    const [result] = await eslint.lintText(
      "import type {OnModuleDestroy} from '@nestjs/common'; export class Owner implements OnModuleDestroy {onModuleDestroy(){return Promise.resolve();}}",
      { filePath }
    );
    assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
  }
  const results = await eslint.lintFiles(['src/services/**/*.ts']);
  assert.equal(
    results
      .flatMap((result) => result.messages)
      .filter((message) => message.ruleId === 'no-restricted-imports' && message.severity === 2)
      .length,
    0
  );
});
test('auth verification and GitHub use cases retain the same plain application dependency rule', async () => {
  for (const filePath of [
    'src/modules/providers/github-authentication.service.ts',
    'src/modules/providers/setup-credentials.service.ts',
    'src/modules/providers/claude-verification.service.ts',
    'src/modules/providers/codex-verification.service.ts',
    'src/modules/github/github-discovery.service.ts',
    'src/modules/github/github-review.service.ts',
  ]) {
    const [result] = await eslint.lintText(
      "import {Injectable} from '@nestjs/common'; export const decorator=Injectable;",
      { filePath }
    );
    assert.ok(
      result.messages.some((message) => message.ruleId === 'application-boundaries/plain-use-case')
    );
  }
});
