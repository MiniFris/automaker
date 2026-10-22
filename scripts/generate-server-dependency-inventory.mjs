#!/usr/bin/env node

import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourceRoot = join(repositoryRoot, 'apps/server/src');
const outputPath = join(
  repositoryRoot,
  'docs/backend-nestjs-migration/artifacts/server-dependencies.json'
);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(path);
    }
  }
  return files.sort();
}

function slash(path) {
  return path.split(sep).join('/');
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveRelativeImport(sourcePath, specifier) {
  if (!specifier.startsWith('.')) return null;
  const unresolved = resolve(dirname(sourcePath), specifier);
  const candidates = extname(unresolved)
    ? [unresolved.replace(/\.js$/, '.ts')]
    : [`${unresolved}.ts`, join(unresolved, 'index.ts')];
  for (const candidate of candidates) {
    if (candidate.startsWith(sourceRoot) && (await exists(candidate))) return candidate;
  }
  return null;
}

function layer(path) {
  const [first] = slash(relative(sourceRoot, path)).split('/');
  return first.endsWith('.ts') ? 'root' : first;
}

function tarjan(nodes, adjacency) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indexes = new Map();
  const lowLinks = new Map();
  const components = [];

  function strongConnect(node) {
    indexes.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const target of adjacency.get(node) ?? []) {
      if (!indexes.has(target)) {
        strongConnect(target);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(target)));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indexes.get(target)));
      }
    }

    if (lowLinks.get(node) === indexes.get(node)) {
      const component = [];
      while (stack.length > 0) {
        const member = stack.pop();
        onStack.delete(member);
        component.push(member);
        if (member === node) break;
      }
      if (component.length > 1 || (adjacency.get(node) ?? new Set()).has(node)) {
        components.push(component.sort());
      }
    }
  }

  for (const node of nodes) if (!indexes.has(node)) strongConnect(node);
  return components.sort((left, right) => left[0].localeCompare(right[0]));
}

async function generate() {
  const files = await walk(sourceRoot);
  const nodes = files.map((file) => slash(relative(repositoryRoot, file)));
  const edges = [];
  const externalImports = new Map();
  const signals = {
    processEnv: [],
    processCwd: [],
    processOn: [],
    childProcess: [],
    timers: [],
    singletonFactories: [],
    exportedInstances: [],
  };

  for (const file of files) {
    const source = slash(relative(repositoryRoot, file));
    const text = await readFile(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const specifier = statement.moduleSpecifier.text;
      const targetFile = await resolveRelativeImport(file, specifier);
      if (targetFile) {
        edges.push({ source, target: slash(relative(repositoryRoot, targetFile)) });
      } else if (!specifier.startsWith('.')) {
        externalImports.set(specifier, (externalImports.get(specifier) ?? 0) + 1);
      }
    }

    if (/process\.env/.test(text)) signals.processEnv.push(source);
    if (/process\.cwd\s*\(/.test(text)) signals.processCwd.push(source);
    if (/process\.on\s*\(/.test(text)) signals.processOn.push(source);
    if (/node:child_process|from ['"]child_process['"]/.test(text))
      signals.childProcess.push(source);
    if (/\bsetInterval\s*\(|\bsetTimeout\s*\(/.test(text)) signals.timers.push(source);
    if (/export function get[A-Z][A-Za-z0-9]*Service\s*\(/.test(text)) {
      signals.singletonFactories.push(source);
    }
    if (/export const [A-Za-z0-9]*Service\s*=\s*new /.test(text)) {
      signals.exportedInstances.push(source);
    }
  }

  edges.sort((left, right) =>
    `${left.source}\0${left.target}`.localeCompare(`${right.source}\0${right.target}`)
  );
  for (const values of Object.values(signals)) values.sort();

  const adjacency = new Map(nodes.map((node) => [node, new Set()]));
  for (const edge of edges) adjacency.get(edge.source)?.add(edge.target);
  const layerEdges = {};
  for (const edge of edges) {
    const key = `${layer(resolve(repositoryRoot, edge.source))} -> ${layer(
      resolve(repositoryRoot, edge.target)
    )}`;
    layerEdges[key] = (layerEdges[key] ?? 0) + 1;
  }

  return {
    schemaVersion: 1,
    sourceRoot: 'apps/server/src',
    summary: {
      files: nodes.length,
      internalEdges: edges.length,
      stronglyConnectedComponents: tarjan(nodes, adjacency).length,
    },
    layerEdges: Object.fromEntries(
      Object.entries(layerEdges).sort(([a], [b]) => a.localeCompare(b))
    ),
    cycles: tarjan(nodes, adjacency),
    signals,
    externalImports: Object.fromEntries(
      [...externalImports.entries()].sort(([left], [right]) => left.localeCompare(right))
    ),
    edges,
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
    console.error('Server dependency inventory is stale. Run npm run inventory:server-deps.');
    process.exitCode = 1;
  } else {
    console.log('Server dependency inventory is up to date.');
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, inventory);
  console.log(`Wrote ${inventory.length} bytes to ${slash(relative(repositoryRoot, outputPath))}.`);
}
