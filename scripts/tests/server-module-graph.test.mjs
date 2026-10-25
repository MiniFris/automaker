import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkServerModuleGraph } from '../check-server-module-graph.mjs';

const nest = "import { Module, DynamicModule, forwardRef } from '@nestjs/common';\n";
const module = (name, imports = '') => `${nest}${imports}\n@Module({}) export class ${name} {}`;
async function fixture(files, run) {
  const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'automaker-module-graph-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(sourceRoot, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
    }
    return await run({ sourceRoot });
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
}
const reject = (files, pattern) =>
  fixture(files, (options) => assert.rejects(checkServerModuleGraph(options), pattern));

test('current production Nest graph has no import cycles and inspects all five dynamic factories', async () => {
  const result = await checkServerModuleGraph();
  assert.deepEqual(result, { modules: 40, importEdges: 52, dynamicFactories: 5, cycles: 0 });
});
test('resolves named aliases through a barrel and literal dynamic factory assembly', async () => {
  await fixture(
    {
      'app.module.ts': `${nest}import { Renamed } from './barrel.js'; @Module({}) export class AppModule { static register(): DynamicModule { return {module:AppModule,imports:[Renamed.register()]}; } }`,
      'barrel.ts': "export { BModule as Renamed } from './b.module.js';",
      'b.module.ts': `${nest}@Module({}) export class BModule { static register():DynamicModule { return { module:BModule }; } }`,
    },
    async (options) =>
      assert.deepEqual(await checkServerModuleGraph(options), {
        modules: 2,
        importEdges: 1,
        dynamicFactories: 2,
        cycles: 0,
      })
  );
});
test('detects direct and indirect module cycles including forwardRef', async () => {
  await reject(
    {
      'a.module.ts': `${nest}import { BModule } from './b.module.js'; @Module({imports:[forwardRef(()=>BModule)]}) export class AModule {}`,
      'b.module.ts': `${nest}import { AModule } from './a.module.js'; @Module({imports:[AModule]}) export class BModule {}`,
    },
    /Nest module import cycle: .*a\.module\.ts#AModule.*b\.module\.ts#BModule.*a\.module\.ts#AModule/
  );
  await reject(
    { 'a.module.ts': `${nest}@Module({imports:[AModule]}) export class AModule {}` },
    /Nest module import cycle/
  );
});
test('detects cycles introduced only by dynamic factory imports', async () => {
  await reject(
    {
      'a.module.ts': `${nest}import { BModule } from './b.module.js'; @Module({}) export class AModule { static register():DynamicModule { return {module:AModule,imports:[BModule.register()]}; } }`,
      'b.module.ts': `${nest}import { AModule } from './a.module.js'; @Module({}) export class BModule { static register():DynamicModule { return {module:BModule,imports:[AModule]}; } }`,
    },
    /Nest module import cycle/
  );
});
test('inspects every conditional literal dynamic return instead of ignoring a branch', async () => {
  await reject(
    {
      'a.module.ts': `${nest}import { BModule } from './b.module.js'; @Module({}) export class AModule { static register(flag:boolean):DynamicModule { if(flag) return {module:AModule}; return {module:AModule,imports:[BModule]}; } }`,
      'b.module.ts': `${nest}import { AModule } from './a.module.js'; @Module({imports:[AModule]}) export class BModule {}`,
    },
    /Nest module import cycle/
  );
});
test('rejects computed imports arrays and array spreads', async () => {
  for (const imports of ['pickModules()', '[...chosenModules]', 'flag ? [] : []'])
    await reject(
      {
        'a.module.ts': `${nest}@Module({imports:${imports}}) export class AModule {}`,
      },
      /imports must be a literal array|unknown Nest import expression/
    );
});
test('rejects unknown helper factories and fake forwardRef functions', async () => {
  for (const expression of [
    'chooseModule()',
    "import('./b.module.js')",
    'unknownForward(()=>BModule)',
  ])
    await reject(
      {
        'a.module.ts': `${nest}@Module({imports:[${expression}]}) export class AModule {}`,
      },
      /unknown Nest import expression/
    );
});
test('rejects metadata spread and computed property names that could conceal imports', async () => {
  for (const metadata of ['{...metadata}', "{['imports']:[]}", '{imports:[],imports:[]}'])
    await reject(
      {
        'a.module.ts': `${nest}@Module(${metadata}) export class AModule {}`,
      },
      /unknown @Module metadata property|duplicate @Module metadata property/
    );
});
test('rejects unknown dynamic return expressions, spreads and wrong module identities', async () => {
  for (const result of [
    'assemble()',
    '{...base,module:AModule}',
    '{module:BModule}',
    '{providers:[]}',
  ])
    await reject(
      {
        'a.module.ts': `${nest}import { BModule } from './b.module.js'; @Module({}) export class AModule { static register():DynamicModule { return ${result}; } }`,
        'b.module.ts': module('BModule'),
      },
      /dynamic module must be a literal object|unknown dynamic module property|different module class|no explicit module class/
    );
});
test('rejects module calls whose static assembly cannot be inspected', async () => {
  await reject(
    {
      'a.module.ts': `${nest}import { BModule } from './b.module.js'; @Module({imports:[BModule.forRoot()]}) export class AModule {}`,
      'b.module.ts': module('BModule'),
    },
    /unreviewed dynamic module factory: forRoot/
  );
});
test('handles inline dynamic import objects and imported forwardRef aliases', async () => {
  await fixture(
    {
      'a.module.ts':
        "import { Module, forwardRef as lazy } from '@nestjs/common'; import { BModule } from './b.module.js'; @Module({imports:[lazy(()=>({module:BModule,imports:[]}))]}) export class AModule {}",
      'b.module.ts': module('BModule'),
    },
    async (options) => assert.equal((await checkServerModuleGraph(options)).importEdges, 1)
  );
});
test('rejects unresolved references, external modules and non-module classes', async () => {
  await reject(
    { 'a.module.ts': `${nest}@Module({imports:[MissingModule]}) export class AModule {}` },
    /unknown exported module symbol/
  );
  await reject(
    {
      'a.module.ts': `${nest}import { ExternalModule } from 'external'; @Module({imports:[ExternalModule]}) export class AModule {}`,
    },
    /external module reference is not reviewed/
  );
  await reject(
    {
      'a.module.ts': `${nest}class NotModule {} @Module({imports:[NotModule]}) export class AModule {}`,
    },
    /not a discovered @Module/
  );
});
test('rejects unrecognized module files and syntax errors rather than omitting them', async () => {
  await reject(
    { 'a.module.ts': 'export class AModule {}' },
    /no statically recognized Nest @Module/
  );
  await reject(
    { 'a.module.ts': `${nest}@Module({imports:[}) export class AModule {}` },
    /parse diagnostics/
  );
});
test('resolves star exports and rejects ambiguous module symbols', async () => {
  const files = {
    'a.module.ts': `${nest}import { BModule } from './barrel.js'; @Module({imports:[BModule]}) export class AModule {}`,
    'barrel.ts': "export * from './b.module.js'; export * from './other.js';",
    'b.module.ts': module('BModule'),
    'other.ts': 'export const unrelated=1;',
  };
  await fixture(files, async (options) =>
    assert.equal((await checkServerModuleGraph(options)).importEdges, 1)
  );
  files['other.ts'] = 'export class BModule {}';
  await reject(files, /ambiguous module re-export/);
});
