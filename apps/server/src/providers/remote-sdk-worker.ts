import { PROVIDER_COMMON } from '../services/execution-environment/provider-catalog.js';

/** Executed on the target, not in the Automaker server. SDKs load only from a managed prefix. */
export const REMOTE_SDK_WORKER = String.raw`(async()=>{${PROVIDER_COMMON}
let secrets=[];
const redact=value=>secrets.reduce((text,key)=>text.replaceAll(key,'[REDACTED]'),String(value));
const send=value=>process.stdout.write(secrets.reduce((text,key)=>text.replaceAll(JSON.stringify(key).slice(1,-1),'[REDACTED]'),JSON.stringify(value))+'\n');
if(!await installed()){send({kind:'failure',code:'REMOTE_SDK_NOT_INSTALLED',message:'Install this pinned SDK in Project Settings > Execution Environment > Remote providers.'});return;}
const key=await credentials();
secrets=[key.apiKey,process.env.ANTHROPIC_API_KEY,process.env.ANTHROPIC_AUTH_TOKEN,process.env.CLAUDE_CODE_OAUTH_TOKEN,process.env.CODEX_API_KEY,process.env.OPENAI_API_KEY,process.env.COPILOT_GITHUB_TOKEN,process.env.GH_TOKEN,process.env.GITHUB_TOKEN].filter(Boolean);
console.log=console.info=console.debug=()=>{};console.warn=console.error=(...args)=>process.stderr.write(redact(args.join(' '))+'\n');
const sdk=await sdkModule(),options=request.options;
const controller=new AbortController();
process.on('SIGTERM',()=>controller.abort());process.on('SIGHUP',()=>controller.abort());
const heartbeat=setInterval(()=>send({kind:'heartbeat'}),10000);
try{
 if(manifest.provider==='claude'){
  const env={...process.env,...(key.apiKey?{ANTHROPIC_API_KEY:key.apiKey}:{} )};
  if(options.sandboxed)env.IS_SANDBOX='1';
  if(key.apiKey){delete env.CLAUDE_CODE_OAUTH_TOKEN;delete env.ANTHROPIC_AUTH_TOKEN;}
  const settings={model:options.model,cwd:process.cwd(),env,abortController:controller,maxTurns:options.maxTurns,
   permissionMode:options.readOnly?'dontAsk':'bypassPermissions',allowDangerouslySkipPermissions:!options.readOnly,
   systemPrompt:options.systemPrompt,resume:options.sdkSessionId,
   tools:options.readOnly?['Read','Glob','Grep']:options.tools,
   allowedTools:options.allowedTools,maxThinkingTokens:options.maxThinkingTokens,outputFormat:options.outputFormat,
   mcpServers:{},strictMcpConfig:true,settingSources:['user','project','local'],stderr:()=>{}};
  const query=sdk.query({prompt:options.prompt,options:settings});
  try{for await(const event of query)send({kind:'event',event});}finally{query.close?.();}
 }else if(manifest.provider==='codex'){
  const codex=new sdk.Codex({env:{...process.env},...(key.apiKey?{apiKey:key.apiKey}:{})});
  const settings={model:options.model,workingDirectory:process.cwd(),skipGitRepoCheck:true,
   sandboxMode:options.readOnly?'read-only':(options.codexSettings?.sandboxMode||'workspace-write'),approvalPolicy:'never',
   modelReasoningEffort:options.reasoningEffort,webSearchEnabled:options.readOnly?false:options.codexSettings?.enableWebSearch,
   ...(options.readOnly&&{networkAccessEnabled:false})};
  const thread=options.sdkSessionId?codex.resumeThread(options.sdkSessionId,settings):codex.startThread(settings);
  const {events}=await thread.runStreamed([options.systemPrompt,options.prompt].filter(Boolean).join('\n\n'),{signal:controller.signal,...(options.outputFormat&&{outputSchema:options.outputFormat.schema})});
  for await(const event of events)send({kind:'event',event,sessionId:thread.id});
 }else{
  const [executable,...args]=cli();
  const client=new sdk.CopilotClient({cliPath:executable,cliArgs:args,cwd:process.cwd(),env:{...process.env,...(key.apiKey?{COPILOT_GITHUB_TOKEN:key.apiKey}:{})},autoRestart:false,useStdio:true,logLevel:'error'});
  let session;
  try{
   await client.start();
   const settings={model:options.model,streaming:true,systemMessage:{mode:'append',content:options.systemPrompt||''},
    onPermissionRequest:async()=>({kind:'approved'})};
   session=options.sdkSessionId?await client.resumeSession(options.sdkSessionId,settings):await client.createSession(settings);
   let resolve,reject;const done=new Promise((yes,no)=>{resolve=yes;reject=no;});done.catch(()=>{});
   const unsubscribe=session.on(event=>{send({kind:'event',event,sessionId:session.sessionId});if(event.type==='session.idle')resolve();if(event.type==='session.error')reject(Error(event.data.message||'Copilot session failed.'));});
   try{await session.send({prompt:options.prompt});await done;}finally{unsubscribe();}
  }finally{try{if(session)await session.destroy();}finally{const errors=await client.stop();if(errors?.length)throw Error('Copilot SDK cleanup reported errors; inspect the target before continuing.');}}
 }
 send({kind:'complete'});
}catch(error){send({kind:'failure',code:'REMOTE_SDK_FAILED',message:redact(error.message).slice(0,4000)});}
finally{clearInterval(heartbeat);}
})().catch(()=>{process.stdout.write(JSON.stringify({kind:'failure',code:'REMOTE_SDK_FAILED',message:'Target SDK loading/authentication failed. Inspect its managed installation and credentials; no Local fallback was performed.'})+'\n');});`;
