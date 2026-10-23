#!/usr/bin/env node

import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const repositoryRoot = resolve(import.meta.dirname, '..');
const routeRoot = join(repositoryRoot, 'apps/server/src/routes');
const nestSourceRoot = join(repositoryRoot, 'apps/server/src');
const serverEntry = join(repositoryRoot, 'apps/server/src/legacy-application.ts');
const ownershipSource = join(repositoryRoot, 'apps/server/src/legacy/legacy-router.middleware.ts');
const outputPath = join(repositoryRoot, 'docs/backend-nestjs-migration/artifacts/http-routes.json');
const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
const nestMethods = new Map([
  ['Get', 'GET'],
  ['Post', 'POST'],
  ['Put', 'PUT'],
  ['Patch', 'PATCH'],
  ['Delete', 'DELETE'],
  ['Options', 'OPTIONS'],
  ['Head', 'HEAD'],
]);

const groupMounts = {
  'app-spec': ['/api/spec-regeneration'],
  'auto-mode': ['/api/auto-mode'],
  'backlog-plan': ['/api/backlog-plan'],
  'enhance-prompt': ['/api/enhance-prompt'],
  'event-history': ['/api/event-history'],
  'running-agents': ['/api/running-agents'],
};

const publicGroups = new Set(['auth', 'health', 'setup']);
const middlewareOnlyEndpoints = [
  {
    method: 'POST',
    path: '/api/git/environment',
    group: 'git',
    owner: 'legacy-express',
    access: 'protected',
    source: 'apps/server/src/routes/environment-git.ts',
    line: 39,
    middleware: ["environmentGitDispatcher(settings, 'git', isProjectBusy)"],
    potentialMutation: true,
    validatesProjectPath: false,
    streamsResponse: false,
  },
  {
    method: 'POST',
    path: '/api/worktree/environment',
    group: 'worktree',
    owner: 'legacy-express',
    access: 'protected',
    source: 'apps/server/src/routes/environment-git.ts',
    line: 39,
    middleware: ["environmentGitDispatcher(settings, 'worktree', isProjectBusy)"],
    potentialMutation: true,
    validatesProjectPath: false,
    streamsResponse: false,
  },
];

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

function mountsFor(sourcePath) {
  const relativePath = slash(relative(routeRoot, sourcePath));
  const [group] = relativePath.split('/');
  if (group === 'common.ts') return [];
  if (relativePath === 'environment-dev-server.ts' || relativePath === 'environment-tests.ts') {
    return ['/api/worktree'];
  }
  if (relativePath === 'environment-git.ts') return ['/api/git', '/api/worktree'];
  if (group === 'settings') {
    if (relativePath === 'settings/model-timeouts.ts') return ['/api/settings/model-timeouts'];
    if (relativePath === 'settings/execution-environments.ts') {
      return ['/api/settings/execution-environments'];
    }
    if (relativePath === 'settings/openai-compatible.ts') {
      return ['/api/settings/openai-compatible'];
    }
  }
  return groupMounts[group] ?? [`/api/${group}`];
}

function groupFor(sourcePath) {
  const relativePath = slash(relative(routeRoot, sourcePath));
  if (relativePath.startsWith('environment-')) return 'worktree';
  return relativePath.split('/')[0];
}

function routePaths(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (!ts.isTemplateExpression(node) || node.templateSpans.length !== 1) return [];
  const expression = node.templateSpans[0].expression;
  if (!ts.isIdentifier(expression)) return [];
  let parent = node.parent;
  while (parent && !ts.isForOfStatement(parent)) parent = parent.parent;
  if (
    !parent ||
    !ts.isVariableDeclarationList(parent.initializer) ||
    parent.initializer.declarations.length !== 1 ||
    !ts.isIdentifier(parent.initializer.declarations[0].name) ||
    parent.initializer.declarations[0].name.text !== expression.text
  ) {
    return [];
  }
  const values = parent.expression;
  if (!ts.isAsExpression(values) || !ts.isArrayLiteralExpression(values.expression)) return [];
  return values.expression.elements.flatMap((element) => {
    if (!ts.isStringLiteral(element)) return [];
    return [`${node.head.text}${element.text}${node.templateSpans[0].literal.text}`];
  });
}

function argumentSummary(call, sourceFile) {
  return call.arguments.slice(1).map((argument) => {
    const value = argument.getText(sourceFile).replace(/\s+/g, ' ').trim();
    return value.length > 180 ? `${value.slice(0, 177)}...` : value;
  });
}

function endpointFlags(method, middleware) {
  const joined = middleware.join(' ');
  return {
    potentialMutation: method !== 'GET',
    validatesProjectPath: joined.includes('validatePathParams'),
    streamsResponse: /download|stream|raw/i.test(joined),
  };
}

function parseRouterEndpoints(sourcePath, sourceText) {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const endpoints = [];
  const mounts = mountsFor(sourcePath);
  const source = slash(relative(repositoryRoot, sourcePath));
  const group = groupFor(sourcePath);

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'router' &&
      methods.has(node.expression.name.text) &&
      node.arguments.length > 0
    ) {
      const paths = routePaths(node.arguments[0]);
      if (paths.length > 0) {
        const method = node.expression.name.text.toUpperCase();
        const middleware = argumentSummary(node, sourceFile);
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        for (const routePath of paths) {
          for (const mount of mounts) {
            endpoints.push({
              method,
              path: joinUrl(mount, routePath),
              group,
              owner: 'legacy-express',
              access: publicGroups.has(group) ? 'public-before-global-auth' : 'protected',
              source,
              line,
              middleware,
              ...endpointFlags(method, middleware),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return endpoints;
}

function parseDirectAppEndpoints(sourceText) {
  const sourceFile = ts.createSourceFile(
    serverEntry,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const endpoints = [];

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'app' &&
      methods.has(node.expression.name.text) &&
      node.arguments.length > 0
    ) {
      const [path] = routePaths(node.arguments[0]);
      if (path?.startsWith('/api/')) {
        const method = node.expression.name.text.toUpperCase();
        const middleware = argumentSummary(node, sourceFile);
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        endpoints.push({
          method,
          path,
          group: path.split('/')[2] || 'root',
          owner: 'legacy-express',
          access: line > 492 ? 'protected' : 'public-before-global-auth',
          source: slash(relative(repositoryRoot, serverEntry)),
          line,
          middleware,
          ...endpointFlags(method, middleware),
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return endpoints;
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

function parseRouteGroupOwners(sourceText) {
  const owners = new Map();
  for (const match of sourceText.matchAll(
    /^\s*(?:'([^']+)'|([A-Za-z0-9-]+)):\s*'(nest|legacy)'/gm
  )) {
    owners.set(match[1] ?? match[2], match[3]);
  }
  if (owners.size === 0) {
    throw new Error('Could not parse ROUTE_GROUP_OWNERS');
  }
  return owners;
}

function parseNestOwnedRoutePaths(sourceText) {
  const declaration = sourceText.match(
    /export const NEST_OWNED_ROUTE_PATHS = new Set<string>\(\[([\s\S]*?)\]\);/
  );
  if (!declaration) {
    throw new Error('Could not parse NEST_OWNED_ROUTE_PATHS');
  }
  return new Set([...declaration[1].matchAll(/'([A-Z]+ \/api\/[^']+)'/g)].map((match) => match[1]));
}

async function generate() {
  const ownershipText = await readFile(ownershipSource, 'utf8');
  const routeGroupOwners = parseRouteGroupOwners(ownershipText);
  const nestOwnedRoutePaths = parseNestOwnedRoutePaths(ownershipText);
  const files = await walk(routeRoot);
  const nestControllerFiles = (await walk(nestSourceRoot)).filter((file) =>
    file.endsWith('.controller.ts')
  );
  const endpoints = [];
  for (const file of files) {
    endpoints.push(...parseRouterEndpoints(file, await readFile(file, 'utf8')));
  }
  endpoints.push(...parseDirectAppEndpoints(await readFile(serverEntry, 'utf8')));
  for (const file of nestControllerFiles) {
    endpoints.push(...parseNestControllerEndpoints(file, await readFile(file, 'utf8')));
  }
  endpoints.push(...middlewareOnlyEndpoints);
  const activeEndpoints = endpoints.filter((endpoint) => {
    if (endpoint.owner !== 'legacy-express') return true;
    const apiGroup = endpoint.path.split('/')[2];
    return (
      routeGroupOwners.get(apiGroup) !== 'nest' &&
      !nestOwnedRoutePaths.has(`${endpoint.method} ${endpoint.path}`)
    );
  });
  sortEndpoints(activeEndpoints);
  return {
    schemaVersion: 2,
    sourceRoot: 'apps/server/src',
    total: activeEndpoints.length,
    groups: buildSummary(activeEndpoints),
    endpoints: activeEndpoints,
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
