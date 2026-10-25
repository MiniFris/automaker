#!/usr/bin/env node

// Conservative source proof of Nest module imports; this does not execute providers.
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const defaultSource = resolve(import.meta.dirname, '../apps/server/src');
const unwrap = (node) => {
  while (
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node))
  )
    node = node.expression;
  return node;
};
const nameOf = (node) =>
  node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : undefined;

export async function checkServerModuleGraph({ sourceRoot = defaultSource } = {}) {
  sourceRoot = resolve(sourceRoot);
  const cache = new Map(),
    nodes = new Map(),
    edges = new Map(),
    inspectedFactories = new Set();
  const fail = (file, message) => {
    throw new Error(`${relative(sourceRoot, file)}: ${message}`);
  };
  async function source(file) {
    if (!cache.has(file)) {
      const text = await readFile(file, 'utf8');
      const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      if (ast.parseDiagnostics.length)
        fail(file, 'TypeScript parse diagnostics prevent graph proof');
      cache.set(file, ast);
    }
    return cache.get(file);
  }
  async function locate(file, specifier) {
    if (!specifier.startsWith('.'))
      fail(file, `external module reference is not reviewed: ${specifier}`);
    const target = resolve(dirname(file), specifier.replace(/\.js$/, '.ts'));
    if (relative(sourceRoot, target).startsWith('..'))
      fail(file, `module reference escapes source root: ${specifier}`);
    for (const candidate of [target, `${target}.ts`, join(target, 'index.ts')]) {
      try {
        await source(candidate);
        return candidate;
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
      }
    }
    fail(file, `unresolved module source: ${specifier}`);
  }
  function imports(ast) {
    const result = new Map();
    for (const statement of ast.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.importClause?.isTypeOnly
      )
        continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const item of bindings.elements)
          if (!item.isTypeOnly)
            result.set(item.name.text, {
              imported: item.propertyName?.text ?? item.name.text,
              specifier: statement.moduleSpecifier.text,
            });
    }
    return result;
  }
  async function binding(file, name, seen = new Set()) {
    const key = `${file}#${name}`;
    if (seen.has(key)) fail(file, `circular or unresolved re-export: ${name}`);
    seen = new Set(seen).add(key);
    const ast = await source(file);
    const local = ast.statements.find(
      (statement) => ts.isClassDeclaration(statement) && statement.name?.text === name
    );
    if (local) return { file, declaration: local, id: key };
    const imported = imports(ast).get(name);
    if (imported) return binding(await locate(file, imported.specifier), imported.imported, seen);
    for (const statement of ast.statements) {
      if (!ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        const item = statement.exportClause.elements.find(
          (item) => item.name.text === name && !item.isTypeOnly
        );
        if (item)
          return binding(
            specifier ? await locate(file, specifier.text) : file,
            item.propertyName?.text ?? item.name.text,
            seen
          );
      }
    }
    // Star exports are resolved only when exactly one path defines this symbol.
    const matches = [];
    for (const statement of ast.statements)
      if (
        ts.isExportDeclaration(statement) &&
        !statement.exportClause &&
        statement.moduleSpecifier &&
        !statement.isTypeOnly
      ) {
        const target = await locate(file, statement.moduleSpecifier.text);
        try {
          matches.push(await binding(target, name, seen));
        } catch (error) {
          if (!error.message.endsWith(`unknown exported module symbol: ${name}`)) throw error;
        }
      }
    const unique = new Map(matches.map((item) => [item.id, item]));
    if (unique.size === 1) return [...unique.values()][0];
    if (unique.size > 1) fail(file, `ambiguous module re-export: ${name}`);
    fail(file, `unknown exported module symbol: ${name}`);
  }
  function nestFunction(file, name, expected) {
    const item = imports(cache.get(file)).get(name);
    return item?.specifier === '@nestjs/common' && item.imported === expected;
  }
  function properties(file, value, context) {
    value = unwrap(value);
    if (!value || !ts.isObjectLiteralExpression(value))
      fail(file, `${context} must be a literal object`);
    const result = new Map();
    for (const property of value.properties) {
      if (!ts.isPropertyAssignment(property) || nameOf(property.name) === undefined)
        fail(file, `unknown ${context} property/spread could alter imports`);
      const name = nameOf(property.name);
      if (result.has(name)) fail(file, `duplicate ${context} property: ${name}`);
      result.set(name, property.initializer);
    }
    return result;
  }
  async function moduleFor(file, expression) {
    expression = unwrap(expression);
    if (!ts.isIdentifier(expression))
      fail(file, `unknown module reference: ${expression?.getText(cache.get(file))}`);
    const target = await binding(file, expression.text);
    if (!nodes.has(target.id))
      fail(file, `reference is not a discovered @Module class: ${expression.text}`);
    return target;
  }
  async function readImports(owner, file, expression) {
    expression = unwrap(expression);
    if (!ts.isArrayLiteralExpression(expression))
      fail(file, 'imports must be a literal array; computed/spread assembly requires review');
    for (const item of expression.elements) await readImport(owner, file, item);
  }
  async function dynamicObject(owner, file, expression, expected) {
    const object = properties(file, expression, 'dynamic module');
    if (!object.has('module')) fail(file, 'dynamic module has no explicit module class');
    const target = await moduleFor(file, object.get('module'));
    if (expected && expected.id !== target.id)
      fail(file, 'dynamic factory returns a different module class');
    if (owner !== target.id) edges.get(owner).add(target.id);
    if (object.has('imports')) await readImports(target.id, file, object.get('imports'));
  }
  async function factory(target, methodName) {
    const key = `${target.id}.${methodName}`;
    if (inspectedFactories.has(key)) return;
    inspectedFactories.add(key);
    const method = target.declaration.members.find(
      (member) =>
        ts.isMethodDeclaration(member) &&
        nameOf(member.name) === methodName &&
        member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
    );
    if (!method?.body) fail(target.file, `unreviewed dynamic module factory: ${methodName}`);
    const returns = [];
    function visit(node) {
      if (ts.isReturnStatement(node)) {
        returns.push(node.expression);
        return;
      }
      if (node !== method.body && ts.isFunctionLike(node)) return;
      ts.forEachChild(node, visit);
    }
    visit(method.body);
    if (returns.length === 0)
      fail(target.file, `dynamic module factory has no return: ${methodName}`);
    for (const expression of returns)
      await dynamicObject(target.id, target.file, expression, target);
  }
  async function readImport(owner, file, expression) {
    expression = unwrap(expression);
    if (ts.isIdentifier(expression)) {
      edges.get(owner).add((await moduleFor(file, expression)).id);
      return;
    }
    if (ts.isObjectLiteralExpression(expression)) {
      await dynamicObject(owner, file, expression);
      return;
    }
    if (ts.isCallExpression(expression)) {
      const callee = expression.expression;
      if (ts.isIdentifier(callee) && nestFunction(file, callee.text, 'forwardRef')) {
        const fn = expression.arguments[0];
        if (
          expression.arguments.length !== 1 ||
          !fn ||
          !ts.isArrowFunction(fn) ||
          fn.parameters.length ||
          ts.isBlock(fn.body)
        )
          fail(file, 'forwardRef must have a concise zero-argument callback');
        await readImport(owner, file, fn.body);
        return;
      }
      if (ts.isPropertyAccessExpression(callee)) {
        const target = await moduleFor(file, callee.expression);
        edges.get(owner).add(target.id);
        await factory(target, callee.name.text);
        return;
      }
    }
    fail(file, `unknown Nest import expression: ${expression?.getText(cache.get(file))}`);
  }
  async function walk(directory) {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) result.push(...(await walk(file)));
      else if (entry.isFile() && entry.name.endsWith('.module.ts')) result.push(file);
    }
    return result.sort();
  }
  for (const file of await walk(sourceRoot)) {
    const ast = await source(file);
    let discovered = 0;
    for (const declaration of ast.statements.filter(ts.isClassDeclaration)) {
      for (const decorator of ts.getDecorators(declaration) ?? []) {
        const call = decorator.expression;
        if (
          !ts.isCallExpression(call) ||
          !ts.isIdentifier(call.expression) ||
          !nestFunction(file, call.expression.text, 'Module')
        )
          continue;
        if (!declaration.name || call.arguments.length !== 1)
          fail(file, 'unknown @Module declaration');
        const id = `${file}#${declaration.name.text}`;
        if (nodes.has(id)) fail(file, 'duplicate @Module decorators');
        nodes.set(id, { id, file, declaration, metadata: call.arguments[0] });
        edges.set(id, new Set());
        discovered++;
      }
    }
    if (!discovered) fail(file, 'module file has no statically recognized Nest @Module');
  }
  if (!nodes.size) throw new Error('No Nest modules discovered');
  for (const target of nodes.values()) {
    const object = properties(target.file, target.metadata, '@Module metadata');
    if (object.has('imports')) await readImports(target.id, target.file, object.get('imports'));
    for (const member of target.declaration.members) {
      if (
        ts.isMethodDeclaration(member) &&
        member.modifiers?.some((item) => item.kind === ts.SyntaxKind.StaticKeyword) &&
        member.type &&
        ts.isTypeReferenceNode(member.type) &&
        ts.isIdentifier(member.type.typeName)
      ) {
        const typeImport = cache
          .get(target.file)
          .statements.filter(ts.isImportDeclaration)
          .filter((item) => item.moduleSpecifier.text === '@nestjs/common')
          .flatMap((item) =>
            item.importClause?.namedBindings && ts.isNamedImports(item.importClause.namedBindings)
              ? item.importClause.namedBindings.elements
              : []
          )
          .find(
            (item) =>
              item.name.text === member.type.typeName.text &&
              (item.propertyName?.text ?? item.name.text) === 'DynamicModule'
          );
        if (typeImport) await factory(target, nameOf(member.name));
      }
    }
  }
  const active = new Set(),
    complete = new Set(),
    stack = [];
  function visit(id) {
    if (active.has(id)) {
      const cycle = [...stack.slice(stack.indexOf(id)), id].map((item) =>
        relative(sourceRoot, item)
      );
      throw new Error(`Nest module import cycle: ${cycle.join(' -> ')}`);
    }
    if (complete.has(id)) return;
    active.add(id);
    stack.push(id);
    for (const target of edges.get(id)) visit(target);
    stack.pop();
    active.delete(id);
    complete.add(id);
  }
  for (const id of nodes.keys()) visit(id);
  return {
    modules: nodes.size,
    importEdges: [...edges.values()].reduce((sum, targets) => sum + targets.size, 0),
    dynamicFactories: inspectedFactories.size,
    cycles: 0,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await checkServerModuleGraph()));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
