import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { ESLint } from 'eslint';

const cwd = path.resolve(import.meta.dirname, '../../apps/server');
const eslint = new ESLint({ cwd });
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
