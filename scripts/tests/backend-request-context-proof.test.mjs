import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { contextSchemaName } from '../generate-backend-openapi.mjs';

function inspect(code, factorySource = '@nestjs/common') {
  const ast = ts.createSourceFile(
    'context.ts',
    `import { createParamDecorator as factory } from '${factorySource}'; ${code}`,
    ts.ScriptTarget.Latest,
    true
  );
  return contextSchemaName(ast, 'Context');
}
test('transport decorators must return the shared parser, including inspected local projections', () => {
  assert.equal(
    inspect('const Context = factory((_data, context) => Schema.parse(project(context)));'),
    'Schema'
  );
  assert.equal(
    inspect(
      'function project(request) { return Schema.parse({ value: request.ip }); } const Context = factory((_data, context) => { const request = context.getRequest(); return project(request); });'
    ),
    'Schema'
  );
});
test('unparsed, partial, recursive and foreign factories do not prove a context contract', () => {
  for (const code of [
    'const Context = factory((_data, context) => project(context));',
    'function project(request) { if (request.raw) return request; return Schema.parse(request); } const Context = factory((_data, context) => project(context));',
    'function project(request) { return project(request); } const Context = factory((_data, context) => project(context));',
    'const Context = factory((_data, context) => Schema.safeParse(context));',
    'const Context = factory((_data, context) => { Schema.parse(context); return context; });',
  ])
    assert.equal(inspect(code), undefined, code);
  assert.equal(
    inspect('const Context = factory((_data, context) => Schema.parse(context));', 'foreign'),
    undefined
  );
});
