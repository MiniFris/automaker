#!/usr/bin/env node

import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const repositoryRoot = resolve(import.meta.dirname, '..');
const routeRoot = join(repositoryRoot, 'apps/server/src/routes');
const nestSourceRoot = join(repositoryRoot, 'apps/server/src');
const outputPath = join(repositoryRoot, 'docs/backend-nestjs-migration/artifacts/http-routes.json');
const nestMethods = new Map([
  ['Get', 'GET'],
  ['Post', 'POST'],
  ['Put', 'PUT'],
  ['Patch', 'PATCH'],
  ['Delete', 'DELETE'],
  ['Options', 'OPTIONS'],
  ['Head', 'HEAD'],
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
  }
  return files.sort();
}

function slash(path) {
  return path.split(sep).join('/');
}

function joinUrl(base, routePath) {
  const normalizedBase = base === '/' ? '' : base.replace(/\/$/, '');
  const normalizedRoute =
    routePath === '/' || routePath === '' ? '' : `/${routePath.replace(/^\//, '')}`;
  return `${normalizedBase}${normalizedRoute}` || '/';
}

function decoratorsOf(node) {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

function decoratorCall(node, name) {
  for (const decorator of decoratorsOf(node)) {
    if (ts.isCallExpression(decorator.expression)) {
      const expression = decorator.expression.expression;
      if (ts.isIdentifier(expression) && expression.text === name) return decorator.expression;
    } else if (ts.isIdentifier(decorator.expression) && decorator.expression.text === name) {
      return decorator.expression;
    }
  }
  return undefined;
}

function staticDecoratorPath(call) {
  if (!call || !ts.isCallExpression(call) || call.arguments.length === 0) return '';
  const [argument] = call.arguments;
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.text;
  }
  return undefined;
}

function parseNestControllerEndpoints(sourcePath, sourceText) {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const endpoints = [];
  const source = slash(relative(repositoryRoot, sourcePath));

  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    const controllerCall = decoratorCall(statement, 'Controller');
    if (!controllerCall) continue;
    const controllerPath = staticDecoratorPath(controllerCall);
    if (controllerPath === undefined) continue;
    const classIsPublic = Boolean(decoratorCall(statement, 'Public'));

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      for (const [decoratorName, method] of nestMethods) {
        const methodCall = decoratorCall(member, decoratorName);
        if (!methodCall) continue;
        const methodPath = staticDecoratorPath(methodCall);
        if (methodPath === undefined) continue;
        const path = joinUrl('/api', joinUrl(controllerPath, methodPath));
        const line =
          sourceFile.getLineAndCharacterOfPosition(methodCall.getStart(sourceFile)).line + 1;
        const handler = member.name?.getText(sourceFile) ?? '<anonymous>';
        endpoints.push({
          method,
          path,
          group: path.split('/')[2] || 'root',
          owner: 'nestjs',
          access:
            classIsPublic || Boolean(decoratorCall(member, 'Public'))
              ? 'public-before-global-auth'
              : 'protected',
          source,
          line,
          middleware: [`${statement.name?.text ?? '<anonymous>'}.${handler}`],
          potentialMutation: method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS',
          validatesProjectPath: Boolean(
            decoratorCall(statement, 'AllowedPathFields') ||
            decoratorCall(member, 'AllowedPathFields')
          ),
          streamsResponse: false,
        });
      }
    }
  }
  return endpoints;
}

function sortEndpoints(endpoints) {
  return endpoints.sort((left, right) =>
    [left.path, left.method, left.source, left.line]
      .join('\0')
      .localeCompare([right.path, right.method, right.source, right.line].join('\0'))
  );
}

function buildSummary(endpoints) {
  const groups = {};
  for (const endpoint of endpoints) {
    groups[endpoint.group] = (groups[endpoint.group] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(groups).sort(([left], [right]) => left.localeCompare(right))
  );
}

async function generate() {
  let legacy = [];
  try {
    legacy = await walk(routeRoot);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (legacy.length) throw new Error('Legacy route sources must not be reintroduced.');
  const files = (await walk(nestSourceRoot)).filter((file) => file.endsWith('.controller.ts'));
  const endpoints = [];
  for (const file of files)
    endpoints.push(...parseNestControllerEndpoints(file, await readFile(file, 'utf8')));
  sortEndpoints(endpoints);
  return {
    schemaVersion: 2,
    sourceRoot: 'apps/server/src',
    total: endpoints.length,
    groups: buildSummary(endpoints),
    endpoints,
  };
}

const generatedInventory = await generate();
const inventory = `${JSON.stringify(generatedInventory, null, 2)}\n`;
if (process.argv.includes('--check')) {
  let current;
  try {
    current = JSON.parse(await readFile(outputPath, 'utf8'));
  } catch {
    // The comparison below reports the missing artifact.
  }
  if (JSON.stringify(current) !== JSON.stringify(generatedInventory)) {
    console.error('Server route inventory is stale. Run npm run inventory:server.');
    process.exitCode = 1;
  } else {
    console.log('Server route inventory is up to date.');
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, inventory);
  console.log(`Wrote ${inventory.length} bytes to ${slash(relative(repositoryRoot, outputPath))}.`);
}
