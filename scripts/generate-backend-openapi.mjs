#!/usr/bin/env node
// Source inspection only: never import a controller, provider or application runtime.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { z } from 'zod';
import { API_CONTRACT_VERSION } from '@automaker/contracts';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'docs/backend-nestjs-migration/artifacts/openapi.json');
const sourceCache = new Map();
const schemaCache = new Map();
const components = {};
const optionalInputs = new Map();

async function source(file) {
  if (!sourceCache.has(file))
    sourceCache.set(
      file,
      ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true)
    );
  return sourceCache.get(file);
}

async function resolveSchema(file, name, seen = new Set(), io = 'input') {
  const key = `${file}#${name}#${io}`;
  if (seen.has(key)) throw new Error(`Schema export cycle: ${key}`);
  seen.add(key);
  if (schemaCache.has(key)) return schemaCache.get(key);
  const ast = await source(file);
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
    if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const bindings = ts.isImportDeclaration(node)
      ? node.importClause?.namedBindings
      : node.exportClause;
    let exportedName = name;
    if (bindings) {
      if (!ts.isNamedImports(bindings) && !ts.isNamedExports(bindings)) continue;
      const binding = bindings.elements.find((item) => item.name.text === name);
      if (!binding) continue;
      exportedName = (binding.propertyName ?? binding.name).text;
    } else if (ts.isImportDeclaration(node)) continue;
    const specifier = node.moduleSpecifier.text;
    let found;
    if (
      specifier === '@automaker/contracts' ||
      specifier.startsWith('@automaker/contracts/domains/')
    ) {
      const shared = await import(specifier);
      const schema = shared[exportedName];
      if (schema && typeof schema.safeParse === 'function') {
        const id = `${specifier === '@automaker/contracts' ? 'shared' : specifier.split('/').at(-1)}.${exportedName}${io === 'output' ? '.Response' : ''}`;
        components[id] = z.toJSONSchema(schema, { io });
        if (io === 'input')
          optionalInputs.set(`#/components/schemas/${id}`, schema.safeParse(undefined).success);
        found = { $ref: `#/components/schemas/${id}` };
      }
    } else if (specifier.startsWith('.')) {
      found = await resolveSchema(
        resolve(dirname(file), specifier.replace(/\.js$/, '.ts')),
        exportedName,
        new Set(seen),
        io
      );
    }
    if (found) {
      schemaCache.set(key, found);
      return found;
    }
  }
  return undefined;
}

function decorators(node) {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

// Recognize an explicit early rejection of the whole decorated input, not a partial object.
function guardedInputSchema(method, parameterName) {
  for (const statement of method.body?.statements ?? []) {
    if (
      !ts.isIfStatement(statement) ||
      !ts.isPrefixUnaryExpression(statement.expression) ||
      statement.expression.operator !== ts.SyntaxKind.ExclamationToken
    )
      continue;
    const success = statement.expression.operand;
    if (
      !ts.isPropertyAccessExpression(success) ||
      success.name.text !== 'success' ||
      !ts.isCallExpression(success.expression)
    )
      continue;
    const call = success.expression;
    if (
      !ts.isPropertyAccessExpression(call.expression) ||
      call.expression.name.text !== 'safeParse' ||
      !ts.isIdentifier(call.expression.expression) ||
      call.arguments.length !== 1 ||
      !ts.isIdentifier(call.arguments[0]) ||
      call.arguments[0].text !== parameterName
    )
      continue;
    if (
      !ts.isBlock(statement.thenStatement) ||
      !statement.thenStatement.statements.some(
        (child) => ts.isReturnStatement(child) && !child.expression
      )
    )
      continue;
    return call.expression.expression.text;
  }
  return undefined;
}

function ownsResponseBody(method, parameter, decorator) {
  const options = decorator.arguments[0];
  const passthrough =
    options &&
    ts.isObjectLiteralExpression(options) &&
    options.properties.some(
      (p) =>
        ts.isPropertyAssignment(p) &&
        p.name.getText() === 'passthrough' &&
        p.initializer.kind === ts.SyntaxKind.TrueKeyword
    );
  if (!passthrough || !ts.isIdentifier(parameter.name)) return true;
  const name = parameter.name.text;
  let manual = false;
  function visit(node) {
    if (ts.isIdentifier(node) && node.text === name) {
      const parent = node.parent;
      if (
        !ts.isPropertyAccessExpression(parent) ||
        parent.expression !== node ||
        !['cookie', 'clearCookie', 'setHeader', 'header', 'append'].includes(parent.name.text)
      )
        manual = true;
    }
    ts.forEachChild(node, visit);
  }
  if (method.body) visit(method.body);
  return manual;
}

async function operation(endpoint) {
  const ast = await source(resolve(root, endpoint.source));
  const handler = endpoint.middleware[0];
  const [className, methodName] = handler.split('.');
  const controller = ast.statements.find(
    (n) => ts.isClassDeclaration(n) && n.name?.text === className
  );
  const method = controller?.members.find(
    (n) => ts.isMethodDeclaration(n) && n.name.getText(ast) === methodName
  );
  if (!method) throw new Error(`Cannot resolve controller handler ${handler}`);
  const parameters = [];
  const unresolved = [];
  let requestBody;
  for (const parameter of method.parameters) {
    for (const decorator of decorators(parameter)) {
      const call = decorator.expression;
      if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
      if (call.expression.text === 'Req') {
        unresolved.push({
          in: 'request',
          reason: 'Raw request access is not a shared input contract.',
        });
        continue;
      }
      const location = { Body: 'body', Query: 'query', Param: 'path' }[call.expression.text];
      if (!location) continue;
      const field = call.arguments.find(ts.isStringLiteral)?.text;
      const pipe = call.arguments.find(
        (a) => ts.isNewExpression(a) && a.expression.getText(ast) === 'ZodValidationPipe'
      );
      const schemaName =
        pipe?.arguments?.[0]?.getText(ast) ??
        (ts.isIdentifier(parameter.name)
          ? guardedInputSchema(method, parameter.name.text)
          : undefined);
      const schema = schemaName
        ? await resolveSchema(resolve(root, endpoint.source), schemaName)
        : undefined;
      if (!schema)
        unresolved.push({
          in: location,
          ...(field && { name: field }),
          ...(schemaName && { schema: schemaName }),
        });
      if (location === 'body') {
        requestBody = {
          required: !parameter.questionToken && !(schema && optionalInputs.get(schema.$ref)),
          content: { 'application/json': { schema: schema ?? {} } },
        };
      } else if (field) {
        parameters.push({
          name: field,
          in: location,
          required: location === 'path' || !parameter.questionToken,
          schema: schema ?? { type: 'string' },
        });
      } else if (schema) {
        const definition = components[schema.$ref.split('/').at(-1)];
        for (const [name, property] of Object.entries(definition.properties ?? {}))
          parameters.push({
            name,
            in: location,
            required: location === 'path' || !!definition.required?.includes(name),
            schema: property,
          });
      }
    }
  }
  // Express-style placeholders must be declared, including handlers using @Req.
  for (const match of endpoint.path.matchAll(/:([A-Za-z0-9_]+)/g))
    if (!parameters.some((p) => p.in === 'path' && p.name === match[1]))
      parameters.push({ name: match[1], in: 'path', required: true, schema: { type: 'string' } });
  const statusDecorator = decorators(method)
    .map((d) => d.expression)
    .find((d) => ts.isCallExpression(d) && d.expression.getText(ast) === 'HttpCode');
  const status =
    statusDecorator?.arguments?.[0]?.getText(ast) ?? (endpoint.method === 'POST' ? '201' : '200');
  // Manual @Res methods own their status/content. Header-only passthrough remains serialized.
  const ownsResponse = method.parameters.some((p) =>
    decorators(p).some(
      (d) =>
        ts.isCallExpression(d.expression) &&
        d.expression.expression.getText(ast) === 'Res' &&
        ownsResponseBody(method, p, d.expression)
    )
  );
  const returns = [];
  function collectReturns(node) {
    if (node !== method.body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) returns.push(node);
    ts.forEachChild(node, collectReturns);
  }
  if (method.body) collectReturns(method.body);
  const returned = returns.length === 1 ? returns[0].expression : undefined;
  const parsed =
    returned &&
    ts.isCallExpression(returned) &&
    ts.isPropertyAccessExpression(returned.expression) &&
    returned.expression.name.text === 'parse' &&
    ts.isIdentifier(returned.expression.expression)
      ? returned.expression.expression.text
      : undefined;
  const responseSchema =
    !ownsResponse && parsed
      ? await resolveSchema(resolve(root, endpoint.source), parsed, new Set(), 'output')
      : undefined;
  return {
    operationId: handler.replace('.', '_'),
    tags: [endpoint.group],
    'x-source': `${endpoint.source}:${endpoint.line}`,
    'x-access': endpoint.access,
    'x-request-contract': unresolved.length ? 'incomplete' : 'shared-or-no-input',
    ...(unresolved.length && { 'x-unresolved-inputs': unresolved }),
    // Response schemas are not inferred from TypeScript annotations or arbitrary examples.
    'x-response-contract': responseSchema ? 'shared-runtime' : 'unverified',
    ...(parameters.length && { parameters }),
    ...(requestBody && { requestBody }),
    responses: ownsResponse
      ? {
          default: {
            description:
              'Status and body controlled by the handler; response contract not yet shared.',
          },
        }
      : {
          [status]: responseSchema
            ? {
                description: 'Response validated by the shared runtime schema.',
                content: { 'application/json': { schema: responseSchema } },
              }
            : { description: 'Successful response; response schema not yet verified.' },
          default: { description: 'Error response; see endpoint implementation.' },
        },
  };
}

export async function generateDocument() {
  const inventory = JSON.parse(
    await readFile(
      resolve(root, 'docs/backend-nestjs-migration/artifacts/http-routes.json'),
      'utf8'
    )
  );
  const paths = {};
  let incomplete = 0;
  let sharedResponses = 0;
  for (const endpoint of inventory.endpoints) {
    if (endpoint.owner !== 'nestjs') throw new Error(`Non-native endpoint: ${endpoint.path}`);
    const path = endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const key = endpoint.method.toLowerCase();
    paths[path] ??= {};
    if (paths[path][key]) throw new Error(`Duplicate route: ${key} ${path}`);
    paths[path][key] = await operation(endpoint);
    if (paths[path][key]['x-request-contract'] === 'incomplete') incomplete++;
    if (paths[path][key]['x-response-contract'] === 'shared-runtime') sharedResponses++;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Automaker HTTP API',
      version: API_CONTRACT_VERSION,
      description:
        'Generated from native controller routes and shared Zod input schemas. Incomplete inputs and unverified responses are explicitly marked; this is not a complete response contract. JSON Schema cannot express every Zod refinement: shared runtime schemas remain authoritative for validation.',
    },
    'x-coverage': {
      operations: inventory.endpoints.length,
      sharedOrNoInput: inventory.endpoints.length - incomplete,
      incompleteInput: incomplete,
      sharedRuntimeResponses: sharedResponses,
      unverifiedResponses: inventory.endpoints.length - sharedResponses,
    },
    paths,
    components: {
      schemas: Object.fromEntries(
        Object.entries(components).sort(([a], [b]) => a.localeCompare(b))
      ),
    },
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const content = `${JSON.stringify(await generateDocument(), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    if ((await readFile(output, 'utf8')) !== content)
      throw new Error('OpenAPI artifact is stale. Run npm run generate:backend:openapi.');
    console.log('Backend OpenAPI artifact is up to date.');
  } else {
    await writeFile(output, content);
    console.log(`Generated ${relative(root, output)}`);
  }
}
