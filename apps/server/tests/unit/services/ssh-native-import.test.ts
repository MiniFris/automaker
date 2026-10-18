import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('production SSH imports in native Node ESM', () => {
  for (const name of ['ssh-state', 'ssh-transport']) {
    it(`loads ${name} ssh2 imports without the test bundler's CommonJS interop`, () => {
      const file = fileURLToPath(
        new URL(`../../../src/services/execution-environment/${name}.ts`, import.meta.url)
      );
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.ES2022
      );
      const imports = source.statements.filter(
        (statement) =>
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text === 'ssh2'
      );
      expect(imports).toHaveLength(1);
      const { outputText } = ts.transpileModule(
        imports.map((statement) => statement.getText(source)).join('\n'),
        {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            verbatimModuleSyntax: true,
          },
        }
      );
      execFileSync(process.execPath, ['--input-type=module', '--eval', outputText], {
        cwd: path.dirname(file),
        timeout: 10_000,
        stdio: 'pipe',
      });
    });
  }
});
