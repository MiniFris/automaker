import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { stripProviderPrefix, type ProviderMessage } from '@automaker/types';
import { createNestApplication } from '../../src/main.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { HostCliDiscovery } from '../../src/core/platform/host-cli-discovery.js';
import { SetupStatusRuntime } from '../../src/core/platform/setup-status.runtime.js';
import { ApplicationCredentialsService } from '../../src/modules/providers/application-credentials.service.js';

const sdk = vi.hoisted(() => ({
  calls: [] as Array<{ environment: NodeJS.ProcessEnv; apiKey: string }>,
}));
// Explicit offline SDK boundary: the tests exercise mode selection, never a vendor request.
vi.mock('../../src/providers/codex-sdk-client.js', () => ({
  executeCodexSdkQuery: async function* (
    _options: unknown,
    _prompt: unknown,
    context: { environment: NodeJS.ProcessEnv; apiKey: string }
  ) {
    sdk.calls.push(context);
    yield { type: 'result', subtype: 'success', result: 'offline-sdk-branch' };
  },
}));
const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [],
  roots: string[] = [];
afterEach(async () => {
  const results = await Promise.allSettled(apps.splice(0).map(({ app }) => app.close()));
  vi.unstubAllEnvs();
  sdk.calls.length = 0;
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
});
function source(owner: string) {
  return (
    `#!${process.execPath}\n` +
    String.raw`
const fs=require('node:fs'),path=require('node:path');
const name=path.basename(process.argv[1]),args=process.argv.slice(2),owner=` +
    JSON.stringify(owner) +
    String.raw`;
fs.appendFileSync(path.join(process.env.HOME,'invocations.jsonl'),JSON.stringify({owner,name,file:process.argv[1],args,home:process.env.HOME,path:process.env.PATH,codexHome:process.env.CODEX_HOME,google:process.env.GEMINI_API_KEY,backend:!!(process.env.AUTOMAKER_API_KEY||process.env.DATA_DIR||process.env.PORT||process.env.NODE_PATH)})+'\n');
const answer=owner+'-'+name,send=value=>process.stdout.write(JSON.stringify(value)+'\n');
if(args.includes('--version')){console.log(answer+' 1.0.0');process.exit(0);}
if(args[0]==='models'){console.log('fixture/model');process.exit(0);}
if(args[0]==='auth'){console.log('{}');process.exit(0);}
if(name==='copilot'){
const frame=value=>{const data=Buffer.from(JSON.stringify(value));process.stdout.write('Content-Length: '+data.length+'\r\n\r\n');process.stdout.write(data);};
let pending=Buffer.alloc(0);process.stdin.on('data',chunk=>{pending=Buffer.concat([pending,chunk]);while(true){const at=pending.indexOf('\r\n\r\n');if(at<0)return;const size=Number(/Content-Length: (\d+)/i.exec(pending.subarray(0,at).toString())[1]);if(pending.length<at+4+size)return;const event=JSON.parse(pending.subarray(at+4,at+4+size));pending=pending.subarray(at+4+size);const sessionId=event.params?.sessionId??'private-session';let result={};if(event.method==='ping')result={protocolVersion:2,timestamp:Date.now()};if(event.method==='session.create'||event.method==='session.resume')result={sessionId};if(event.method==='session.send')result={messageId:'message'};if(event.id!==undefined)frame({jsonrpc:'2.0',id:event.id,result});if(event.method==='session.send')for(const [index,event]of [{type:'assistant.message',data:{content:answer,messageId:'message'}},{type:'session.idle',data:{}}].entries())frame({jsonrpc:'2.0',method:'session.event',params:{sessionId,event:{id:String(index),timestamp:new Date().toISOString(),parentId:null,...event}}});}});process.stdin.on('end',()=>process.exit(0));
}else{
 const finish=()=>{if(name==='cursor-agent'){send({type:'assistant',message:{role:'assistant',content:[{type:'text',text:answer}]}});send({type:'result',subtype:'success',result:answer});}else if(name==='gemini'){send({type:'message',role:'assistant',content:answer});send({type:'result',status:'success'});}else if(name==='opencode'){send({type:'text',part:{text:answer}});send({type:'step_finish',part:{reason:'stop'}});}else if(name==='codex'){send({type:'thread.started',thread_id:'private-thread'});send({type:'item.completed',item:{id:'answer',type:'agent_message',text:answer}});send({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}});}};
 if(name==='gemini')finish();else{process.stdin.resume();process.stdin.on('end',finish);}
}
`
  );
}
async function fixture(owner: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `native-cli-${owner}-`));
  roots.push(root);
  const bin = path.join(root, 'bin');
  await fs.mkdir(bin);
  for (const name of ['cursor-agent', 'gemini', 'opencode'])
    await fs.writeFile(path.join(bin, name), source(owner), { mode: 0o700 });
  await fs.mkdir(path.join(root, '.local', 'bin'), { recursive: true });
  for (const name of ['codex', 'copilot'])
    await fs.writeFile(path.join(root, '.local', 'bin', name), source(owner), { mode: 0o700 });
  await fs.mkdir(path.join(root, 'relative-codex'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'relative-codex', 'auth.json'),
    JSON.stringify({ tokens: { access_token: 'private-offline-oauth' } })
  );
  const environment = {
    NODE_ENV: 'test',
    HOME: root,
    PATH: bin,
    CODEX_HOME: 'relative-codex',
    ALLOWED_ROOT_DIRECTORY: root,
    AUTOMAKER_API_KEY: 'backend-' + owner,
    OPENAI_API_KEY: 'private-key-' + owner,
    GEMINI_API_KEY: 'private-google-' + owner,
  };
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    environment,
  });
  apps.push(runtime);
  await runtime.start();
  const registry = runtime.app.get(ProviderRegistry);
  async function query(id: string, cwd = root) {
    const provider = registry.providerForModel(id),
      messages: ProviderMessage[] = [];
    for await (const message of provider.executeQuery({
      prompt: 'Private fixture only',
      model: stripProviderPrefix(id),
      cwd,
      abortController: new AbortController(),
      maxTurns: 1,
      codexSettings: { autoLoadAgents: false },
    }))
      messages.push(message);
    expect(messages.some((message) => message.type === 'error')).toBe(false);
    expect(
      messages.some((message) => message.type === 'result' && message.subtype === 'success')
    ).toBe(true);
    return messages;
  }
  async function calls() {
    try {
      return (await fs.readFile(path.join(root, 'invocations.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  return { root, bin, runtime, registry, environment, query, calls };
}
it.skipIf(process.platform !== 'linux')(
  'five actual native Local adapters select their own executable/profile after ambient changes; Copilot SDK uses its common-path binary',
  async () => {
    const one = await fixture('one'),
      two = await fixture('two'),
      ambient = await fs.mkdtemp(path.join(os.tmpdir(), 'native-cli-ambient-'));
    roots.push(ambient);
    for (const name of ['cursor-agent', 'gemini', 'opencode', 'copilot', 'codex'])
      await fs.writeFile(path.join(ambient, name), source('must-not-execute'), { mode: 0o700 });
    vi.stubEnv('PATH', ambient);
    vi.stubEnv('HOME', ambient);
    vi.stubEnv('CODEX_HOME', ambient);
    for (const f of [one, two]) {
      f.environment.PATH = '/mutated-input';
      f.environment.HOME = '/mutated-home';
      for (const id of [
        'cursor-auto',
        'gemini-2.5-pro',
        'opencode-claude-sonnet',
        'copilot-gpt-5',
        'codex-gpt-5.2-codex',
      ])
        await f.query(id);
      const invoked = await f.calls();
      for (const name of ['cursor-agent', 'gemini', 'opencode', 'copilot', 'codex']) {
        const call = invoked.find((call) => call.name === name);
        expect(call).toMatchObject({
          owner: f === one ? 'one' : 'two',
          home: f.root,
          path: f.bin,
          backend: false,
        });
        expect(call.file.startsWith(f.root + '/')).toBe(true);
      }
      expect(invoked.find((call) => call.name === 'codex').codexHome).toBe(
        path.join(f.root, 'relative-codex')
      );
      expect((await f.runtime.app.get(SetupStatusRuntime).detect('gemini')).path).toBe(
        path.join(f.bin, 'gemini')
      );
      expect((await f.runtime.app.get(SetupStatusRuntime).detect('copilot')).path).toBe(
        path.join(f.root, '.local', 'bin', 'copilot')
      );
      const catalog = f.registry.providerForModel(
        'opencode-claude-sonnet'
      ) as import('../../src/providers/opencode-provider.js').OpencodeProvider;
      await catalog.refreshModels();
      expect(
        (await f.calls())
          .filter((call) => call.name === 'opencode' && call.args[0] === 'models')
          .at(-1)
      ).toMatchObject({ home: f.root, path: f.bin, backend: false });
      expect((await f.runtime.app.get(SetupStatusRuntime).codexIndicators()).hasOAuthToken).toBe(
        true
      );
    }
    await expect(fs.access(path.join(ambient, 'invocations.jsonl'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await one.runtime.app
      .get(ApplicationCredentialsService)
      .change('google', 'rotated-private-key');
    await one.query('gemini-2.5-pro');
    expect((await one.calls()).filter((call) => call.name === 'gemini').at(-1).google).toBe(
      'rotated-private-key'
    );
    await one.runtime.app.close();
    await two.query('gemini-2.5-pro');
  }
);
it.skipIf(process.platform !== 'linux')(
  'Cursor versions and native passive profile hints use each own home rather than module-import globals',
  async () => {
    const one = await fixture('one'),
      two = await fixture('two');
    for (const f of [one, two]) {
      await fs.unlink(path.join(f.bin, 'cursor-agent'));
      const version = path.join(f.root, '.local', 'share', 'cursor-agent', 'versions', 'v2');
      await fs.mkdir(version, { recursive: true });
      await fs.writeFile(path.join(version, 'cursor-agent'), source(f === one ? 'one' : 'two'), {
        mode: 0o700,
      });
      await fs.mkdir(path.join(f.root, '.cursor'), { recursive: true });
      await fs.writeFile(
        path.join(f.root, '.cursor', 'credentials.json'),
        JSON.stringify({ accessToken: 'private-hint' })
      );
    }
    vi.stubEnv('HOME', '/hostile-home');
    vi.stubEnv('PATH', '/no-host-tooling');
    for (const f of [one, two]) {
      await f.query('cursor-auto');
      expect((await f.calls()).find((call) => call.name === 'cursor-agent').file).toContain(
        f.root + '/.local/share/cursor-agent/versions/v2/'
      );
      expect(await f.runtime.app.get(SetupStatusRuntime).cursorCredentials()).toBe(true);
      expect(f.runtime.app.get(SetupStatusRuntime).platformInfo().homeDir).toBe(f.root);
    }
  }
);
it.skipIf(process.platform !== 'linux')(
  'Codex ignores foreign OAuth, keeps own OAuth CLI priority, and normalizes relative CODEX_HOME for changed query cwd',
  async () => {
    const one = await fixture('one');
    const nested = path.join(one.root, 'worktree');
    await fs.mkdir(nested);
    vi.stubEnv('HOME', one.root);
    vi.stubEnv('CODEX_HOME', path.join(one.root, 'relative-codex'));
    await one.query('codex-gpt-5.2-codex', nested);
    expect(sdk.calls).toHaveLength(0);
    expect((await one.calls()).at(-1).codexHome).toBe(path.join(one.root, 'relative-codex'));
    await fs.unlink(path.join(one.root, 'relative-codex', 'auth.json'));
    const foreign = path.join(one.root, '.codex');
    await fs.mkdir(foreign);
    await fs.writeFile(
      path.join(foreign, 'auth.json'),
      JSON.stringify({ access_token: 'foreign-must-not-select-cli' })
    );
    const before = (await one.calls()).length;
    await one.query('codex-gpt-5.2-codex', nested);
    expect((await one.calls()).length).toBe(before);
    expect(sdk.calls).toHaveLength(1);
    expect(sdk.calls[0]).toMatchObject({
      apiKey: 'private-key-one',
      environment: { CODEX_HOME: path.join(one.root, 'relative-codex'), HOME: one.root },
    });
    expect(await one.runtime.app.get(HostCliDiscovery).codexIndicators()).toEqual({
      hasAuthFile: false,
      hasOAuthToken: false,
      hasApiKey: false,
    });
  }
);

it.skipIf(process.platform !== 'linux')(
  'native discovery refuses an ambient-only PATH candidate without executing any fallback CLI',
  async () => {
    const own = await fixture('one'),
      ambient = await fs.mkdtemp(path.join(os.tmpdir(), 'native-cli-ambient-only-'));
    roots.push(ambient);
    await fs.unlink(path.join(own.bin, 'gemini'));
    await fs.writeFile(path.join(ambient, 'gemini'), source('must-not-execute'), { mode: 0o700 });
    vi.stubEnv('PATH', ambient);
    vi.stubEnv('HOME', ambient);
    const provider = own.registry.providerForModel(
      'gemini-2.5-pro'
    ) as import('../../src/providers/gemini-provider.js').GeminiProvider;
    expect(provider.getCliPath()).not.toBe(path.join(ambient, 'gemini'));
    await expect(fs.access(path.join(ambient, 'invocations.jsonl'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }
);
