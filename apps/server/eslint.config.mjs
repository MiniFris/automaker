import { defineConfig, globalIgnores } from 'eslint/config';
import { dirname, relative, resolve } from 'node:path';
import js from '@eslint/js';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

const serverSource = resolve(import.meta.dirname, 'src');
const pureKernels = new Set([
  resolve(serverSource, 'modules/orchestration/feature-run-state-machine.ts'),
  resolve(serverSource, 'core/errors/domain-errors.ts'),
]);
const domainDirectory = resolve(serverSource, 'domain');
const ambientRuntime = new Set([
  'process',
  'globalThis',
  'global',
  'window',
  'self',
  'require',
  'module',
  '__dirname',
  '__filename',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Worker',
  'SharedWorker',
  'navigator',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'AbortSignal',
  'console',
  'performance',
  'eval',
  'Function',
]);
const pureKernelRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      dependency:
        'Pure kernels may import only guarded domain helpers and type-only @automaker/types; pass infrastructure results as values.',
      dynamic:
        'Pure kernels cannot load modules dynamically or through require; use a guarded static dependency.',
      ambient: 'Pure kernels cannot access ambient runtime {{name}}; supply values explicitly.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    function dependency(node) {
      const name = node.source?.value;
      const typeOnly =
        node.importKind === 'type' ||
        node.exportKind === 'type' ||
        (node.specifiers?.length > 0 &&
          node.specifiers.every(
            (item) => item.importKind === 'type' || item.exportKind === 'type'
          ));
      if (name === '@automaker/types' && typeOnly) return;
      let target;
      if (typeof name === 'string' && name.startsWith('.'))
        target = resolve(dirname(context.filename), name);
      else if (typeof name === 'string' && name.startsWith('@/'))
        target = resolve(serverSource, name.slice(2));
      if (target) {
        target = target.replace(/\.js$/, '.ts');
        const withinDomain = relative(domainDirectory, target);
        if (
          pureKernels.has(target) ||
          (withinDomain && !withinDomain.startsWith('..') && !withinDomain.startsWith('/'))
        )
          return;
      }
      context.report({ node, messageId: 'dependency' });
    }
    return {
      ImportDeclaration: dependency,
      ExportNamedDeclaration(node) {
        if (node.source) dependency(node);
      },
      ExportAllDeclaration: dependency,
      ImportExpression(node) {
        context.report({ node, messageId: 'dynamic' });
      },
      TSImportEqualsDeclaration(node) {
        context.report({ node, messageId: 'dynamic' });
      },
      Identifier(node) {
        if (!ambientRuntime.has(node.name)) return;
        let scope = sourceCode.getScope(node);
        let reference;
        while (scope && !reference) {
          reference = scope.references.find((item) => item.identifier === node);
          scope = scope.upper;
        }
        if (reference && !reference.resolved?.defs.length)
          context.report({ node, messageId: 'ambient', data: { name: node.name } });
      },
    };
  },
};

const eslintConfig = defineConfig([
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        FormData: 'readonly',
        RequestInit: 'readonly',
        // Timers
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        queueMicrotask: 'readonly',
        // Node.js types
        NodeJS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': ts,
    },
    rules: {
      ...ts.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      // Server code frequently works with terminal output containing ANSI escape codes
      'no-control-regex': 'off',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-nocheck': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts', 'src/modules/**/*.ts'],
    ignores: ['src/core/config/runtime-config.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env']",
          message: 'Inject RuntimeConfig instead of reading process.env in Nest modules.',
        },
        {
          selector: "CallExpression[callee.object.name='process'][callee.property.name='cwd']",
          message: 'Inject RuntimePathsService instead of reading process.cwd() in Nest modules.',
        },
      ],
    },
  },
  {
    files: ['src/services/**/*.ts', 'src/providers/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'FunctionDeclaration[id.name=/^get.*Service$/]',
          message:
            'Pass the application-owned service explicitly instead of a service locator getter.',
        },
        {
          selector:
            'VariableDeclarator[id.name=/^get.*Service$/] > :matches(ArrowFunctionExpression, FunctionExpression)',
          message:
            'Pass the application-owned service explicitly instead of a service locator getter.',
        },
        {
          selector:
            ':matches(Program > VariableDeclaration, ExportNamedDeclaration > VariableDeclaration) > VariableDeclarator > NewExpression[callee.name=/Service$/]',
          message: 'Compose service instances inside application factories, not at module scope.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/routes/**', 'routes/**', '**/*.controller.*'],
              message: 'Services/providers depend on domain ports, not HTTP routes or controllers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts', 'src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/routes/**', 'routes/**'],
              message:
                'Native core/modules depend on domain ports, not legacy route implementations.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.controller.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            'child_process',
            'node:child_process',
            'fs',
            'node:fs',
            'fs/promises',
            'node:fs/promises',
          ],
          patterns: [
            { group: ['**/routes/**'], message: 'Controllers delegate IO to application ports.' },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/modules/orchestration/feature-run-state-machine.ts',
      'src/core/errors/domain-errors.ts',
      'src/domain/**/*.ts',
    ],
    plugins: { 'domain-boundaries': { rules: { 'pure-kernel': pureKernelRule } } },
    rules: { 'domain-boundaries/pure-kernel': 'error' },
  },
  globalIgnores(['dist/**', 'node_modules/**']),
]);

export default eslintConfig;
