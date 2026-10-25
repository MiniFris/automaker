import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { RemoteSdkProvider } from '@automaker/types';
import { providerManifest } from '../../src/services/execution-environment/provider-catalog.js';

/** Fake npm and SDK packages, running on the SSH/Docker target. Never install or call a model. */
export async function sdkInstallerFixture(home: string) {
  await fs.mkdir(path.join(home, '.local/bin'), { recursive: true });
  const source = String.raw`
import fs from 'node:fs';import path from 'node:path';
const record=(name,value)=>fs.writeFileSync(name,JSON.stringify(value));
function work(prompt,settings,key){
 if(process.env.AUTOMAKER_API_KEY)throw Error('CONTROLLER_ENV_LEAKED');
 if(!key)throw Error('target key missing');
 record('sdk-invocation.json',{prompt,settings,hasTargetKey:!!key,home:process.env.HOME,cwd:process.cwd()});
 if(prompt.includes('FAIL'))throw Error('authentication failed '+key);
 if(!settings.readOnly&&settings.sandboxMode!=='read-only'&&!Array.isArray(settings.tools))fs.writeFileSync('sdk-result.txt','remote-only');
}

export async function* query({prompt,options}){
 const key=options.env.ANTHROPIC_API_KEY;
 work(prompt,{tools:options.tools,readOnly:options.permissionMode==='dontAsk',strictMcpConfig:options.strictMcpConfig,resume:options.resume},key);
 yield {type:'system',subtype:'init',session_id:'claude-session'};
 yield {type:'assistant',session_id:'claude-session',message:{role:'assistant',content:[{type:'text',text:'Remote SDK implementation completed. '.repeat(8)}]}};
 yield {type:'result',subtype:'success',session_id:'claude-session'};
}
export class Codex {
 constructor(options){this.options=options;}
 startThread(settings){return this.thread(settings);}
 resumeThread(id,settings){if(id==='missing-session')throw Error('Session not found');return this.thread({...settings,resume:id});}
 thread(settings){const key=this.options.apiKey;return {id:'codex-session',async runStreamed(prompt){
 work(prompt,settings,key);
 return {events:(async function*(){
 yield {type:'thread.started',thread_id:'codex-session'};
 yield {type:'item.started',item:{id:'tool',type:'command_execution',command:'echo target'}};
 yield {type:'item.completed',item:{id:'tool',type:'command_execution',aggregated_output:'target',exit_code:0}};
 yield {type:'item.completed',item:{id:'answer',type:'agent_message',text:'Remote SDK implementation completed. '.repeat(8)}};
 if(!prompt.includes('INCOMPLETE'))yield {type:'turn.completed',usage:{input_tokens:1,output_tokens:1}};
 })()};}};}
}
export class CopilotClient{
 constructor(options){this.options=options;}
 async start(){}
 async createSession(settings){return this.session(settings);}
 async resumeSession(id,settings){if(id==='missing-session')throw Error('Session not found');return this.session({...settings,resume:id});}
 session(settings){let emit;const key=this.options.env.COPILOT_GITHUB_TOKEN;return {sessionId:'copilot-session',on(callback){emit=callback;return ()=>{};},async send({prompt}){
 work(prompt,{...settings,systemMessage:settings.systemMessage},key);
 emit({type:'assistant.message',data:{content:'Remote SDK implementation completed. '.repeat(8)}});
 emit({type:'session.idle',data:{}});
 },async destroy(){fs.writeFileSync('sdk-session-cleaned','done');}};}
 async stop(){fs.writeFileSync('sdk-client-cleaned','done');}
}
`;
  await fs.writeFile(path.join(home, '.fixture-sdk.mjs'), source);
  await fs.writeFile(
    path.join(home, '.local/bin/npm'),
    `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2);fs.writeFileSync(path.join(process.env.HOME,'npm-argv.json'),JSON.stringify(args));
const root=args[args.indexOf('--prefix')+1];
const spec=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
for(const [name,version]of Object.entries(spec.dependencies)){
 const directory=path.join(root,'node_modules',name);fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({name,version,type:'module',exports:'./index.js'}));
 const entry=name==='@anthropic-ai/claude-agent-sdk'?'sdk.mjs':'dist/index.js';fs.mkdirSync(path.dirname(path.join(directory,entry)),{recursive:true});fs.copyFileSync(path.join(process.env.HOME,'.fixture-sdk.mjs'),path.join(directory,entry));
 fs.writeFileSync(path.join(directory,'cli.js'),'');fs.writeFileSync(path.join(directory,'npm-loader.js'),'');
 for(const triple of ['x86_64-unknown-linux-musl','aarch64-unknown-linux-musl']){const vendor=path.join(directory,'vendor',triple,'codex');fs.mkdirSync(vendor,{recursive:true});fs.writeFileSync(path.join(vendor,'codex'),'');}
}
`,
    { mode: 0o700 }
  );
}

/** Real installed SDKs speak to a fixture CLI, not a model API. Override executable only. */
export async function useActualSDK(root: string, provider: RemoteSdkProvider) {
  const manifest = providerManifest(provider);
  const locations = createRequire(import.meta.url).resolve.paths(manifest.sdk) ?? [];
  let entry = '';
  for (const directory of locations) {
    const candidate = path.join(directory, manifest.sdk, manifest.entry);
    if (
      await fs.stat(candidate).then(
        () => true,
        () => false
      )
    ) {
      entry = candidate;
      break;
    }
  }
  if (!entry) throw Error('Installed SDK entrypoint not found.');
  const cli = path.join(root, 'fixture-cli.cjs');
  const common = String.raw`
const fs=require('node:fs');
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const answer='Actual installed SDK protocol completed. '.repeat(8);
fs.writeFileSync('actual-sdk-invocation.json',JSON.stringify({cwd:process.cwd(),home:process.env.HOME,args:process.argv.slice(2),hasTargetKey:!!(process.env.ANTHROPIC_API_KEY||process.env.CODEX_API_KEY||process.env.COPILOT_GITHUB_TOKEN)}));
if(process.env.AUTOMAKER_API_KEY)process.exit(3);
`;
  const source =
    provider === 'codex'
      ? common +
        String.raw`
let prompt='';process.stdin.on('data',chunk=>{prompt+=chunk;});process.stdin.on('end',()=>{
fs.writeFileSync('actual-sdk-result.txt',prompt);
send({type:'thread.started',thread_id:'codex-actual-session'});
send({type:'item.completed',item:{id:'answer',type:'agent_message',text:answer}});
send({type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}});
});
`
      : provider === 'claude'
        ? common +
          String.raw`
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
const event=JSON.parse(line);
if(event.type==='control_request')send({type:'control_response',response:{subtype:'success',request_id:event.request_id,response:{commands:[],models:[],output_style:'default',available_output_styles:['default']}}});
if(event.type==='user'){
fs.writeFileSync('actual-sdk-result.txt',JSON.stringify(event.message));
send({type:'system',subtype:'init',session_id:'claude-actual-session',tools:[],mcp_servers:[],model:'sonnet',cwd:process.cwd()});
send({type:'assistant',session_id:'claude-actual-session',parent_tool_use_id:null,message:{role:'assistant',content:[{type:'text',text:answer}]}});
send({type:'result',subtype:'success',session_id:'claude-actual-session',is_error:false,result:answer,duration_ms:1,duration_api_ms:1,num_turns:1,total_cost_usd:0,usage:{input_tokens:1,output_tokens:1}});
}
});
`
        : common +
          String.raw`
const frame=value=>{const data=Buffer.from(JSON.stringify(value));process.stdout.write('Content-Length: '+data.length+'\r\n\r\n');process.stdout.write(data);};
let pending=Buffer.alloc(0);
process.stdin.on('data',chunk=>{
pending=Buffer.concat([pending,chunk]);
while(true){
 const end=pending.indexOf('\r\n\r\n');if(end<0)return;
 const length=Number(/Content-Length: (\d+)/i.exec(pending.subarray(0,end).toString())[1]);if(pending.length<end+4+length)return;
 const event=JSON.parse(pending.subarray(end+4,end+4+length));pending=pending.subarray(end+4+length);
 const sessionId=event.params?.sessionId??'copilot-actual-session';
 let result={};
 if(event.method==='ping')result={protocolVersion:2,timestamp:Date.now()};
 if(event.method==='session.create'||event.method==='session.resume'){result={sessionId};fs.writeFileSync('actual-sdk-session-id.txt',sessionId);}
 if(event.method==='session.send')result={messageId:'message'};
 if(event.id!==undefined)frame({jsonrpc:'2.0',id:event.id,result});
 if(event.method==='session.send'){
  fs.writeFileSync('actual-sdk-result.txt',event.params.prompt);
  for(const [index,event]of [{type:'assistant.message',data:{content:answer,messageId:'message'}},{type:'session.idle',data:{}}].entries())frame({jsonrpc:'2.0',method:'session.event',params:{sessionId,event:{id:String(index),timestamp:new Date().toISOString(),parentId:null,...event}}});
 }
}
});
`;
  await fs.writeFile(cli, '#!/usr/bin/env node\n' + source, { mode: 0o700 });
  const wrapper =
    provider === 'claude'
      ? `import {query as realQuery} from ${JSON.stringify(entry)};export const query=input=>realQuery({...input,options:{...input.options,pathToClaudeCodeExecutable:${JSON.stringify(cli)}}});`
      : provider === 'codex'
        ? `import {Codex as RealCodex} from ${JSON.stringify(entry)};export class Codex extends RealCodex{constructor(options){super({...options,codexPathOverride:${JSON.stringify(cli)}});}}`
        : `import {CopilotClient as RealClient} from ${JSON.stringify(entry)};export class CopilotClient extends RealClient{constructor(options){super({...options,cliPath:process.execPath,cliArgs:[${JSON.stringify(cli)}]});}}`;
  await fs.writeFile(path.join(root, 'node_modules', manifest.sdk, manifest.entry), wrapper);
}
