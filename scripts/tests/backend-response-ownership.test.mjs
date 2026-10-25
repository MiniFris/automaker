import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { ownsResponseBody } from '../generate-backend-openapi.mjs';

function owns(body, helper = '') {
  const ast = ts.createSourceFile(
    'fixture.ts',
    `class Controller { async endpoint(@Res({passthrough:true}) response: Response) { ${body} } ${helper} }`,
    ts.ScriptTarget.Latest,
    true
  );
  const method = ast.statements[0].members[0];
  const parameter = method.parameters[0];
  return ownsResponseBody(method, parameter, ts.getDecorators(parameter)[0].expression);
}
test('header-only and inspected cancellation helpers preserve Nest response serialization', () => {
  assert.equal(owns("response.cookie('a','b'); return Schema.parse(value);"), false);
  assert.equal(
    owns(
      'return Schema.parse(await this.cancel(response, operation));',
      `private async cancel(reply: Response, operation: Function) { const close = () => { if (!reply.writableEnded) controller.abort(); }; reply.on('close', close); try { return await operation(controller); } finally { reply.off('close', close); } }`
    ),
    false
  );
});
test('manual body writes, fluent body writes and escaped response aliases stay unverified', () => {
  for (const body of [
    'response.json(value); return Schema.parse(value);',
    "response.cookie('a','b').json(value); return Schema.parse(value);",
    "response.on('close', close).end(); return Schema.parse(value);",
    "const alias = response.cookie('a','b'); alias.json(value); return Schema.parse(value);",
    'external(response); return Schema.parse(value);',
    'const alias = response; return Schema.parse(value);',
    "response.on('close', function () { this.end(); }); return Schema.parse(value);",
    "response.once('finish', externalCallback); return Schema.parse(value);",
    'response.writableEnded = true; return Schema.parse(value);',
  ])
    assert.equal(owns(body), true, body);
});
test('same-class helper forwarding must prove the entire response path', () => {
  for (const helper of [
    'private cancel(reply: Response) { reply.json(value); }',
    'private cancel(reply: Response) { return external(reply); }',
    'private cancel(reply: Response) { return this.cancel(reply); }',
    'private cancel(reply: Response) { return this.other(reply); } private other(reply: Response) { reply.end(); }',
    "private cancel(reply: Response) { reply.on('close', () => reply.send(value)); }",
  ])
    assert.equal(owns('return Schema.parse(await this.cancel(response));', helper), true, helper);
});
