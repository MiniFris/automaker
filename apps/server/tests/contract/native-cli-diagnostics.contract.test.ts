import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { stripProviderPrefix, type ProviderMessage } from '@automaker/types';
import { createNestApplication } from '../../src/main.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';

it('native private CLI failures and OpenCode session retry suppress diagnostic secrets while retaining controlled errors', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-cli-diagnostics-'));
  const bin = path.join(root, 'bin');
  await fs.mkdir(bin);
  const secret = 'private-cli-diagnostic-secret';
  const source =
    `#!${process.execPath}\n` +
    String.raw`
const name=require('node:path').basename(process.argv[1]),args=process.argv.slice(2);
const secret='private-cli-diagnostic-secret';
if(args.includes('--version')){console.log('1.0.0');process.exit(0);}
if(name==='copilot'){
 const frame=value=>{const data=Buffer.from(JSON.stringify(value));process.stdout.write('Content-Length: '+data.length+'\r\n\r\n');process.stdout.write(data);};
 let pending=Buffer.alloc(0);process.stdin.on('data',chunk=>{pending=Buffer.concat([pending,chunk]);while(true){const at=pending.indexOf('\r\n\r\n');if(at<0)return;const size=Number(/Content-Length: (\d+)/i.exec(pending.subarray(0,at).toString())[1]);if(pending.length<at+4+size)return;const event=JSON.parse(pending.subarray(at+4,at+4+size));pending=pending.subarray(at+4+size);if(event.id!==undefined)frame((event.method==='session.create'||event.method==='session.resume')?{jsonrpc:'2.0',id:event.id,error:{code:-32603,message:secret}}:{jsonrpc:'2.0',id:event.id,result:event.method==='ping'?{protocolVersion:2,timestamp:Date.now()}:{}});}});process.stdin.on('end',()=>process.exit(0));
}else{
 const finish=()=>{
  if(name==='opencode'&&args.includes('--session')){process.stderr.write('Session not found '+secret);process.exitCode=2;return;}
  if(name==='opencode'&&require('node:fs').existsSync(require('node:path').join(process.env.HOME,'retry-success'))){console.log(JSON.stringify({type:'text',part:{text:'retry-success'}}));console.log(JSON.stringify({type:'step_finish',part:{reason:'stop'}}));return;}
  process.stderr.write(secret);process.stdout.write('invalid-'+secret+'\n'+'final-'+secret);process.exitCode=7;
 };
 if(name==='gemini')finish();else{process.stdin.resume();process.stdin.on('end',finish);}
}
`;
  for (const name of ['cursor-agent', 'gemini', 'opencode'])
    await fs.writeFile(path.join(bin, name), source, { mode: 0o700 });
  await fs.mkdir(path.join(root, '.local', 'bin'), { recursive: true });
  await fs.writeFile(path.join(root, '.local', 'bin', 'copilot'), source, { mode: 0o700 });
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: root,
    dataDir: path.join(root, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    environment: {
      NODE_ENV: 'test',
      HOME: root,
      PATH: bin,
      ALLOWED_ROOT_DIRECTORY: root,
      AUTOMAKER_API_KEY: 'backend-fixture',
    },
  });
  const logs = ['log', 'warn', 'error'].map((name) =>
    vi.spyOn(console, name as 'log').mockImplementation(() => {})
  );
  try {
    await runtime.start();
    const registry = runtime.app.get(ProviderRegistry);
    async function query(id: string, session?: string) {
      const messages: ProviderMessage[] = [];
      try {
        for await (const message of registry.providerForModel(id).executeQuery({
          prompt: 'private',
          model: stripProviderPrefix(id),
          cwd: root,
          abortController: new AbortController(),
          sdkSessionId: session,
          maxTurns: 1,
        }))
          messages.push(message);
      } catch (error) {
        messages.push({
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return messages;
    }
    for (const id of ['cursor-auto', 'gemini-2.5-pro', 'opencode-claude-sonnet', 'copilot-gpt-5']) {
      const messages = await query(id);
      expect(
        messages.some((message) => message.type === 'error'),
        id + ' ' + JSON.stringify(messages)
      ).toBe(true);
      expect(JSON.stringify(messages)).not.toContain(secret);
      expect(JSON.stringify(messages)).toMatch(/failed|Failed|error/i);
    }
    expect(JSON.stringify(await query('copilot-gpt-5', 'stale-session'))).not.toContain(secret);
    await fs.writeFile(path.join(root, 'retry-success'), '1');
    const messages = await query('opencode-claude-sonnet', 'private-stale-session');
    expect(messages.some((message) => message.type === 'error')).toBe(false);
    expect(JSON.stringify(messages)).toContain('retry-success');
    expect(JSON.stringify(logs.flatMap((log) => log.mock.calls))).not.toContain(secret);
  } finally {
    await runtime.app.close();
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  }
});
