#!/usr/bin/env node

import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const repositoryRoot = resolve(import.meta.dirname, '..');
const uiRoot = join(repositoryRoot, 'apps/ui/src');
const routeInventoryPath = join(
  repositoryRoot,
  'docs/backend-nestjs-migration/artifacts/http-routes.json'
);
const outputPath = join(
  repositoryRoot,
  'docs/backend-nestjs-migration/artifacts/api-consumers.json'
);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files.sort();
}

function slash(path) {
  return path.split(sep).join('/');
}

function renderPath(node, sourceFile) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text +
      node.templateSpans
        .map((span) => {
          const expression = span.expression.getText(sourceFile);
          const replacement = /[`'"]\?/.test(expression) ? '?dynamic' : `:${expression}`;
          return `${replacement}${span.literal.text}`;
        })
        .join('')
    );
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = renderPath(node.left, sourceFile);
    const right = renderPath(node.right, sourceFile);
    if (left !== null && right !== null) return left + right;
    if (left?.startsWith('/api/')) return `${left}:dynamic`;
  }
  return null;
}

function apiPart(value) {
  const index = value.indexOf('/api/');
  if (index < 0) return null;
  return value.slice(index).split('?')[0];
}

function methodFromHelper(name) {
  if (name === 'get') return 'GET';
  if (name === 'post') return 'POST';
  if (name === 'put') return 'PUT';
  if (name === 'httpDelete') return 'DELETE';
  return null;
}

function fetchMethod(call, sourceFile) {
  const options = call.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return 'GET';
  for (const property of options.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      property.name.getText(sourceFile) === 'method' &&
      ts.isStringLiteral(property.initializer)
    ) {
      return property.initializer.text.toUpperCase();
    }
  }
  return 'GET';
}

function pathPattern(path) {
  const escaped = path
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\:[^/]+/g, '[^/]+')
    .replace(/:[^/]+/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}

function referenceMatches(reference, endpoint) {
  if (reference.method !== endpoint.method) return false;
  const normalizedReference = reference.path.replace(/:[^/]+/g, ':value');
  const normalizedEndpoint = endpoint.path.replace(/:[^/]+/g, ':value');
  if (normalizedReference === normalizedEndpoint) return true;
  return pathPattern(endpoint.path).test(reference.path.replace(/:[^/]+/g, 'value'));
}

async function generate() {
  const files = await walk(uiRoot);
  const references = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if (!text.includes('/api/')) continue;
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    function visit(node) {
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        let method = null;
        if (ts.isPropertyAccessExpression(node.expression)) {
          method = methodFromHelper(node.expression.name.text);
        } else if (ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
          method = fetchMethod(node, sourceFile);
        }
        if (method) {
          const rendered = renderPath(node.arguments[0], sourceFile);
          const path = rendered ? apiPart(rendered) : null;
          if (path) {
            references.push({
              method,
              path,
              source: slash(relative(repositoryRoot, file)),
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  references.sort((left, right) =>
    `${left.path}\0${left.method}\0${left.source}\0${left.line}`.localeCompare(
      `${right.path}\0${right.method}\0${right.source}\0${right.line}`
    )
  );
  const inventory = JSON.parse(await readFile(routeInventoryPath, 'utf8'));
  const endpoints = inventory.endpoints.map((endpoint) => ({
    method: endpoint.method,
    path: endpoint.path,
    consumers: references.filter((reference) => referenceMatches(reference, endpoint)),
  }));
  return {
    schemaVersion: 1,
    sourceRoot: 'apps/ui/src',
    summary: {
      references: references.length,
      serverEndpoints: endpoints.length,
      endpointsWithDetectedConsumers: endpoints.filter((endpoint) => endpoint.consumers.length > 0)
        .length,
    },
    references,
    endpoints,
  };
}

const generatedInventory = await generate();
const inventory = `${JSON.stringify(generatedInventory, null, 2)}\n`;
if (process.argv.includes('--check')) {
  let current;
  try {
    await access(outputPath);
    current = JSON.parse(await readFile(outputPath, 'utf8'));
  } catch {
    // The comparison below reports the missing artifact.
  }
  if (JSON.stringify(current) !== JSON.stringify(generatedInventory)) {
    console.error('API consumer inventory is stale. Run npm run inventory:api-consumers.');
    process.exitCode = 1;
  } else {
    console.log('API consumer inventory is up to date.');
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, inventory);
  console.log(`Wrote ${inventory.length} bytes to ${slash(relative(repositoryRoot, outputPath))}.`);
}
