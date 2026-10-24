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

test('production compiler roots and transitive imports exclude characterization routes', () => {
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
