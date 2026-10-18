import { DOCKER_CANCEL, DOCKER_WORKER } from './docker-worker.js';
import { sshDigest } from './ssh-state.js';

// The same bounded filesystem/exec/search implementation; SSH gets a private per-install
// job directory instead of the container-local /tmp default. Neither source contains keys.
export const SSH_WORKER = DOCKER_WORKER.replaceAll('Container', 'Remote').replaceAll(
  'container',
  'remote'
);
export const SSH_CANCEL = DOCKER_CANCEL;
export const SSH_WORKER_HASH = sshDigest(SSH_WORKER);
export const SSH_CANCEL_HASH = sshDigest(SSH_CANCEL);

export const SSH_CHECK = String.raw`
const fs=require('node:fs/promises'),os=require('node:os');
const {execFileSync}=require('node:child_process');
(async()=>{
 if(process.platform!=='linux'||Number(process.versions.node.split('.')[0])<22)throw Error('requires Linux and Node 22+');
 execFileSync('git',['--version'],{stdio:'ignore'});
 process.stdout.write(JSON.stringify({platform:'linux',node:process.versions.node,user:os.userInfo().username}));
})().catch(()=>{process.stderr.write('Linux, Node 22+ and Git are required on the SSH host.');process.exitCode=1;});
`;

export const SSH_INSTALL = String.raw`
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash}=require('node:crypto');const {execFileSync}=require('node:child_process');
const digest=value=>createHash('sha256').update(value).digest('hex');
(async()=>{
 if(process.platform!=='linux'||Number(process.versions.node.split('.')[0])<22)throw Error('prerequisites');
 execFileSync('git',['--version'],{stdio:'ignore'});
 const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
 const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(!/^[a-f0-9]{64}$/.test(input.owner)||digest(input.worker)!==input.workerHash||digest(input.cancel)!==input.cancelHash)throw Error('source');
 await fs.mkdir(input.basePath,{recursive:true});const basePath=await fs.realpath(input.basePath);
 if(basePath==='/')throw Error('root');
 const root=path.join(basePath,'.automaker-ssh-'+input.owner);
 await fs.mkdir(root,{recursive:true,mode:0o700});
 if((await fs.lstat(root)).isSymbolicLink()|| (await fs.stat(root)).uid!==process.getuid())throw Error('owner');
 const directory=path.join(root,'worker-'+input.workerHash);
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 for(const [name,source,hash] of [['worker.cjs',input.worker,input.workerHash],['cancel.cjs',input.cancel,input.cancelHash]]) {
   const file=path.join(directory,name);
   try {await fs.writeFile(file,source,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
   if(digest(await fs.readFile(file))!==hash)throw Error('worker changed');
 }
 const jobsDirectory=path.join(root,'jobs');await fs.mkdir(jobsDirectory,{recursive:true,mode:0o700});
 process.stdout.write(JSON.stringify({basePath,root,workerPath:path.join(directory,'worker.cjs'),cancelPath:path.join(directory,'cancel.cjs'),workerHash:input.workerHash,cancelHash:input.cancelHash,jobsDirectory,identity:digest(os.hostname()+'\0'+process.getuid()+'\0'+basePath)}));
})().catch(()=>{process.stderr.write('Remote worker preparation failed. Check Linux/Node 22+/Git, directory ownership, free space and any modified worker files.');process.exitCode=1;});
`;

/** Validate the pinned installed source before executing it. Model data goes only to stdin. */
export const SSH_LOAD = String.raw`
const fs=require('node:fs'),{createHash}=require('node:crypto'),Module=require('node:module');
const [file,expected,id,jobs,mode,cwd]=process.argv.slice(1);
try {
 const source=fs.readFileSync(file);
 if(createHash('sha256').update(source).digest('hex')!==expected)throw Error('hash');
 if(cwd)process.chdir(cwd);
 process.argv=[process.execPath,id,jobs,mode];
 const worker=new Module(file);worker.filename=file;worker._compile(source.toString('utf8'),file);
}catch{process.stderr.write('Pinned remote worker is unavailable or changed.');process.exitCode=72;}
`;

export const SSH_VERIFY = String.raw`
const fs=require('node:fs/promises'),{createHash}=require('node:crypto'),os=require('node:os');
const [base,identity,worker,workerHash,cancel,cancelHash,project]=process.argv.slice(1);
const digest=value=>createHash('sha256').update(value).digest('hex');
(async()=>{
 if(process.platform!=='linux'||Number(process.versions.node.split('.')[0])<22 || digest(os.hostname()+'\0'+process.getuid()+'\0'+await fs.realpath(base))!==identity)throw Error('identity');
 for(const [file,hash] of [[worker,workerHash],[cancel,cancelHash]])if(digest(await fs.readFile(file))!==hash)throw Error('worker');
 if(project && ((await fs.realpath(project))!==project||!(await fs.stat(project)).isDirectory()))throw Error('project');
 process.stdout.write('verified');
})().catch(()=>{process.stderr.write('Pinned SSH user, directory or worker no longer matches.');process.exitCode=72;});
`;
