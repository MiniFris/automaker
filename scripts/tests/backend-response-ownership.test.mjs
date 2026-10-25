import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { ownsResponseBody, manuallyParsedResponseSchema } from '../generate-backend-openapi.mjs';

function owns(body, helper = '', allowStatus = false) {
  const ast = ts.createSourceFile(
    'fixture.ts',
    `class Controller { async endpoint(@Res({passthrough:true}) response: Response) { ${body} } ${helper} }`,
    ts.ScriptTarget.Latest,
    true
  );
  const method = ast.statements[0].members[0];
  const parameter = method.parameters[0];
  return ownsResponseBody(
    method,
    parameter,
    ts.getDecorators(parameter)[0].expression,
    allowStatus
  );
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
test('status-only passthrough is recognized without granting fluent body writes', () => {
  assert.equal(owns('response.status(result.status); return Schema.parse(result.body);'), true);
  assert.equal(
    owns('response.status(result.status); return Schema.parse(result.body);', '', true),
    false
  );
  assert.equal(
    owns(
      'return Schema.parse(await this.reply(response));',
      'private async reply(res: Response) { res.status(value.status); return value.body; }',
      true
    ),
    false
  );
  for (const body of [
    'response.status(503).json(value); return Schema.parse(value);',
    'const alias = response.status(503); alias.end(); return Schema.parse(value);',
    'response.status(200).on("close", function () { this.end(); }); return Schema.parse(value);',
  ])
    assert.equal(owns(body, '', true), true, body);
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

function manual(body, decorator = '@Res()') {
  const ast = ts.createSourceFile(
    'fixture.ts',
    `class Controller { endpoint(${decorator} response: Response) { ${body} } }`,
    ts.ScriptTarget.Latest,
    true
  );
  const method = ast.statements[0].members[0],
    parameter = method.parameters[0];
  return manuallyParsedResponseSchema(method, parameter, ts.getDecorators(parameter)[0].expression);
}
test('manual JSON ownership requires the same shared parser on every body path', () => {
  assert.equal(
    manual(
      'if (response.destroyed) return; if (failed) { response.status(503).json(Schema.parse(error)); return; } response.json(Schema.parse(value));'
    ),
    'Schema'
  );
  for (const body of [
    'response.json(Schema.parse(value)); response.status(500).json(error);',
    'response.json(Schema.parse(value)); response.json(OtherSchema.parse(error));',
    'response.status(200).json(Schema.parse(value)).end();',
    'const alias = response; alias.json(Schema.parse(value));',
    'response.status(external(response)).json(Schema.parse(value));',
    'response.destroyed = true; response.json(Schema.parse(value));',
    'response.status(200).send(Schema.parse(value));',
    'response.json(Schema.safeParse(value));',
    'response.json(Schema.parse(value)); external(response);',
  ])
    assert.equal(manual(body), undefined, body);
  assert.equal(manual('return Schema.parse(value);', '@Res({passthrough:true})'), undefined);
});
