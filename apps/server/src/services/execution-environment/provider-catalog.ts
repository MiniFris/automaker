import type { RemoteSdkProvider } from '@automaker/types';
import { createHash } from 'node:crypto';

/** Keep aligned with the server's tested SDKs. Never install a request-supplied package or tag. */
export const REMOTE_PROVIDER_PACKAGES = {
  claude: {
    sdk: '@anthropic-ai/claude-agent-sdk',
    version: '0.2.32',
    entry: 'sdk.mjs',
    dependencies: { '@anthropic-ai/claude-agent-sdk': '0.2.32' },
  },
  codex: {
    sdk: '@openai/codex-sdk',
    version: '0.98.0',
    entry: 'dist/index.js',
    dependencies: { '@openai/codex-sdk': '0.98.0' },
  },
  copilot: {
    sdk: '@github/copilot-sdk',
    version: '0.1.16',
    entry: 'dist/index.js',
    dependencies: { '@github/copilot-sdk': '0.1.16', '@github/copilot': '0.0.389' },
  },
} as const;

export function providerManifest(provider: RemoteSdkProvider) {
  const spec = REMOTE_PROVIDER_PACKAGES[provider];
  return {
    provider,
    ...spec,
    id: createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 24),
  };
}

/** Trusted code is carried in argv; secrets and prompts only in stdin. No project module resolution. */
export const PROVIDER_COMMON = String.raw`
const fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const request=JSON.parse(Buffer.concat(chunks).toString('utf8'));
const manifest=request.manifest;
if(process.platform!=='linux'||!['x64','arm64'].includes(process.arch)||!process.env.HOME||!path.isAbsolute(process.env.HOME))throw Error('Linux x64/arm64 and an absolute target HOME are required.');
const root=path.join(process.env.HOME,'.local/share/automaker/providers',manifest.provider+'-'+manifest.id);
const packagePath=name=>path.join(root,'node_modules',name);
const marker=path.join(root,'.automaker-provider.json');
const readJson=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const exists=async file=>fs.stat(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
async function installed(){
 if(!await exists(marker))return false;
 if(JSON.stringify(await readJson(marker))!==JSON.stringify(manifest))throw Error('Managed provider manifest changed.');
 for(const [name,version]of Object.entries(manifest.dependencies))if((await readJson(path.join(packagePath(name),'package.json'))).version!==version)throw Error('Managed provider version changed.');
 return true;
}
async function credentials(){
 const file=path.join(root,'credentials.json');
 if(!await exists(file))return {};
 const stat=await fs.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||stat.uid!==process.getuid())throw Error('Managed key must be a private regular file owned by the target user.');
 return readJson(file);
}
async function sdkModule(){
 return import(pathToFileURL(path.join(packagePath(manifest.sdk),manifest.entry)).href);
}
function cli(){
 if(manifest.provider==='claude')return [process.execPath,path.join(packagePath(manifest.sdk),'cli.js')];
 if(manifest.provider==='copilot')return [process.execPath,path.join(packagePath('@github/copilot'),'npm-loader.js')];
 return [path.join(packagePath(manifest.sdk),'vendor',process.arch==='x64'?'x86_64-unknown-linux-musl':'aarch64-unknown-linux-musl','codex/codex')];
}
`;

export const PROVIDER_ADMIN = `(async()=>{${PROVIDER_COMMON}
const {randomUUID}=require('node:crypto');
async function status(){
 const key=await credentials();
 const environment=manifest.provider==='claude'?(process.env.ANTHROPIC_API_KEY||process.env.CLAUDE_CODE_OAUTH_TOKEN):manifest.provider==='codex'?(process.env.CODEX_API_KEY||process.env.OPENAI_API_KEY):(process.env.COPILOT_GITHUB_TOKEN||process.env.GH_TOKEN||process.env.GITHUB_TOKEN);
 const cache=manifest.provider==='codex'?path.join(process.env.CODEX_HOME||path.join(process.env.HOME,'.codex'),'auth.json'):manifest.provider==='claude'?path.join(process.env.HOME,'.claude/.credentials.json'):path.join(process.env.HOME,'.copilot/config.json');
 const credentialSource=key.apiKey?'managed-key':environment?'target-environment':await exists(cache)?'target-cache':'not-detected';
 return {root,packageVersion:manifest.version,installed:await installed(),hasStoredKey:!!key.apiKey,credentialSource,authentication:credentialSource==='not-detected'?'not-detected':'configured-unverified'};
}
if(request.operation==='install'){
 await fs.mkdir(root,{recursive:true,mode:0o700});
 if((await fs.lstat(root)).isSymbolicLink())throw Error('Managed provider root is a symlink.');
 const lock=path.join(root,'.install.lock');
 try{const previous=await readJson(lock);try{process.kill(previous.pid,0);throw Error('Provider installation is already running.');}catch(error){if(error.code!=='ESRCH')throw error;}await fs.unlink(lock);}catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.writeFile(lock,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});
 try{
  if(!await installed()){
   if(await exists(path.join(root,'package.json'))){const dependencies=(await readJson(path.join(root,'package.json'))).dependencies;if(!dependencies||Object.keys(dependencies).length!==Object.keys(manifest.dependencies).length||Object.entries(manifest.dependencies).some(([name,version])=>dependencies[name]!==version))throw Error('Provider directory belongs to another manifest.');}
   else await fs.writeFile(path.join(root,'package.json'),JSON.stringify({private:true,dependencies:manifest.dependencies}),{flag:'wx',mode:0o600});
   await new Promise((resolve,reject)=>{
    const child=spawn('npm',['install','--prefix',root,'--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org'],{cwd:root,stdio:'ignore',env:{...process.env,npm_config_update_notifier:'false'}});
    child.once('error',()=>reject(Error('npm could not start. Install npm on the target.')));child.once('close',code=>code===0?resolve():reject(Error('Pinned SDK installation failed. Check npm, registry access, disk and permissions on the target.')));
   });
   for(const [name,version]of Object.entries(manifest.dependencies))if((await readJson(path.join(packagePath(name),'package.json'))).version!==version)throw Error('Installed package version does not match.');
   await sdkModule();
   const command=cli();if(!await exists(command.length===1?command[0]:command[1]))throw Error('Bundled provider CLI is unavailable.');
   await fs.writeFile(marker,JSON.stringify(manifest),{mode:0o600});
  }
 }finally{await fs.unlink(lock);}
}else if(request.operation==='key'){
 if(!await installed())throw Error('Install the pinned SDK before saving a target key.');
 const file=path.join(root,'credentials.json');
 await credentials();
 if(request.clear)await fs.unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
 else{
  const temporary=path.join(root,'.credentials-'+randomUUID());
  try{await fs.writeFile(temporary,JSON.stringify({apiKey:request.apiKey}),{flag:'wx',mode:0o600});await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(()=>{});}
 }
}else if(request.operation!=='inspect')throw Error('Unsupported provider action.');
process.stdout.write(JSON.stringify({ok:true,status:await status()}));
})().catch(()=>{process.stdout.write(JSON.stringify({ok:false,message:'Target SDK setup failed. Check installation, npm/registry access, ownership and private key file permissions. No Local fallback was performed.'}));process.exitCode=1;});`;
