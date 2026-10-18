/** Versioned, dependency-free worker. Sent over stdin/argv, never loaded from project files. */
export const WORKER_VERSION = '1';
export const MANAGED_DOCKERFILE = `FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git bash ca-certificates openssh-client python3 make g++ && rm -rf /var/lib/apt/lists/*
LABEL dev.automaker.worker="${WORKER_VERSION}"
ENTRYPOINT ["node"]
`;

// PID 1 exits after 15 idle minutes, including after a controller restart. The writable layer
// (home/cache) and the actual project/dependencies survive stop/start. No published ports.
export const DOCKER_INIT = String.raw`
const fs = require('node:fs/promises');
const jobs = '/tmp/automaker-jobs';
let last = Date.now();
(async () => {
  await fs.mkdir(jobs, {recursive:true, mode:0o700});
  await fs.unlink(jobs+'-stopping').catch(error=>{if(error.code!=='ENOENT') throw error;});
  await fs.mkdir(process.env.HOME, {recursive:true});
  setInterval(async () => {
    // Publish a stop intent BEFORE listing jobs. A new worker registers first,
    // then checks this flag, so an idle decision cannot kill an active command.
    const mayStop=Date.now()-last>900000;
    try {
      if(mayStop) await fs.writeFile(jobs+'-stopping','stopping');
      let active = false;
      for (const name of await fs.readdir(jobs)) {
        const file = jobs + '/' + name;
        const stat = await fs.stat(file);
        last = Math.max(last, stat.mtimeMs);
        if (name.endsWith('.running')) {
          const state = JSON.parse(await fs.readFile(file, 'utf8'));
          try { process.kill(state.pid, 0); active = true; } catch {}
        } else if (Date.now() - stat.mtimeMs > 3600000) await fs.unlink(file);
      }
      if (mayStop && !active && Date.now() - last > 900000) process.exit(0);
    } catch { /* Do not stop an environment whose job state cannot be checked. */ }
    finally {if(mayStop) await fs.unlink(jobs+'-stopping').catch(()=>{});}
  }, 30000);
})().catch(() => process.exit(1));
`;

export const DOCKER_WORKER = String.raw`
const fs = require('node:fs/promises');
const {constants, createReadStream} = require('node:fs');
const path = require('node:path');
const jobsDirectory = process.argv[2] || '/tmp/automaker-jobs';
const {createHash, randomUUID} = require('node:crypto');
const {spawn} = require('node:child_process');
const requestId = process.argv[1];
if (!/^[a-f0-9-]{36}$/.test(requestId || '')) process.exit(2);
const base = path.join(jobsDirectory,requestId);
const controller = new AbortController();
process.on('SIGTERM', () => controller.abort());
process.on('SIGHUP', () => controller.abort());
const signal = controller.signal;
const fail = (code, message) => Object.assign(new Error(message), {code});
const processStart = async pid => {
  const stat=await fs.readFile('/proc/'+pid+'/stat','utf8');
  return stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
};
const resolve = (value) => {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw fail('INVALID_PATH', 'Invalid file path.');
  return path.resolve(process.cwd(), value);
};
let streaming = false;
const frame = value => process.stdout.write(JSON.stringify(value)+'\n');
async function runProcess(request) {
  if(typeof request.command!=='string'||!request.command||request.command.includes('\0')||
    !Array.isArray(request.args)||request.args.some(arg=>typeof arg!=='string'||arg.includes('\0'))||
    (request.stdin!==undefined&&typeof request.stdin!=='string'))throw fail('INVALID_PROCESS','Invalid process request.');
  const timer=setTimeout(()=>controller.abort(),Math.max(1,Math.min(request.timeoutMs??600000,600000)));
  let idle;
  const resetIdle=()=>{
    clearTimeout(idle);
    idle=setTimeout(()=>controller.abort(),Math.max(1,Math.min(request.idleTimeoutMs??120000,600000)));
  };
  try {
    return await new Promise((done,reject)=>{
      const home=process.env.HOME;
      const child=spawn(request.command,request.args,{
        cwd:process.cwd(),detached:true,shell:false,stdio:['pipe','pipe','pipe'],
        env:{...process.env,GEMINI_TELEMETRY_ENABLED:'false',
          PATH:[process.env.PATH,...(home?['.local/bin','.opencode/bin','.npm-global/bin'].map(dir=>path.join(home,dir)):[])].filter(Boolean).join(':')}
      });
      let bytes=0,failure;
      const stop=()=>{
        try{if(child.pid)process.kill(-child.pid,'SIGKILL');}
        catch(error){if(error.code!=='ESRCH')failure=fail('PROCESS_CLEANUP_FAILED','Container process-group cleanup failed. Inspect state before retrying.');}
      };
      const consume=stream=>chunk=>{
        resetIdle();bytes+=chunk.length;
        if(bytes>33554432){failure=fail('PROCESS_OUTPUT_LIMIT','Container process exceeded 32 MiB output. Inspect prior effects before retrying.');stop();return;}
        for(let offset=0;offset<chunk.length;offset+=65536){
          if(!frame({stream,data:chunk.subarray(offset,offset+65536).toString('base64')})){
            child.stdout.pause();child.stderr.pause();
          }
        }
      };
      const drain=()=>{child.stdout.resume();child.stderr.resume();};
      process.stdout.on('drain',drain);
      child.stdout.on('data',consume('stdout'));child.stderr.on('data',consume('stderr'));
      child.stdin.on('error',()=>{});child.stdin.end(request.stdin??'');
      child.on('error',error=>{failure=fail(error.code==='ENOENT'?'PROCESS_NOT_INSTALLED':'PROCESS_FAILED','Container CLI could not start. Install and authenticate it inside the selected environment; controller credentials are not forwarded.');});
      child.on('exit',stop);
      signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();resetIdle();
      child.on('close',code=>{
        signal.removeEventListener('abort',stop);process.stdout.off('drain',drain);
        if(failure)reject(failure);
        else if(signal.aborted)reject(fail('PROCESS_INTERRUPTED','Container process interrupted or timed out. Prior effects are not rolled back.'));
        else done({exitCode:code??1});
      });
    });
  } finally{clearTimeout(timer);clearTimeout(idle);}
}
async function execute(command, options = {}) {
  const maximum = Math.max(1, Math.min(options.maxOutputBytes ?? 12000, 1048576));
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(options.timeoutMs ?? 180000, 600000)));
  try {
    return await new Promise((done, reject) => {
      const child = spawn('/bin/sh', ['-c', command], {
        cwd: options.cwd ? resolve(options.cwd) : process.cwd(), detached: true,
        stdio: ['ignore','pipe','pipe'], env: {...process.env}
      });
      const chunks = []; let bytes = 0, truncated = false, failure;
      const stop = () => {
        try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') failure = fail('PROCESS_CLEANUP_FAILED', 'Container process-group cleanup failed. Inspect the project container before retrying.'); }
      };
      const consume = chunk => {
        const remaining = Math.max(0, maximum - bytes);
        if (chunk.length > remaining) truncated = true;
        if (remaining) chunks.push(chunk.subarray(0, remaining));
        bytes += Math.min(chunk.length, remaining);
      };
      child.stdout.on('data', consume); child.stderr.on('data', consume);
      child.on('error', () => { failure = fail('PROCESS_FAILED', 'Container command could not start.'); });
      child.on('exit', stop);
      signal.addEventListener('abort', stop, {once:true});
      if (signal.aborted) stop();
      child.on('close', code => {
        signal.removeEventListener('abort', stop);
        if (failure) reject(failure);
        else if (signal.aborted) reject(fail('PROCESS_INTERRUPTED', 'Container command interrupted or timed out. Effects are not rolled back; do not blindly retry.'));
        else done({exitCode: code ?? 1, output: Buffer.concat(chunks).toString('utf8'), truncated});
      });
    });
  } finally { clearTimeout(timer); }
}
async function main(request) {
  signal.throwIfAborted();
  const args = request.args;
  if (request.operation === 'process') {streaming=true;return runProcess(args);}
  if (request.operation === 'search') return search(args);
  if (request.operation === 'exec') return execute(args.command, args.options);
  const file = resolve(args.path);
  switch (request.operation) {
    case 'read': {
      if (!Number.isSafeInteger(args.offset) || args.offset < 0 || !Number.isSafeInteger(args.length) || args.length < 1 || args.length > 2097152)
        throw fail('INVALID_RANGE', 'Read at most 2 MiB per call.');
      const handle = await fs.open(file, constants.O_RDONLY | constants.O_NONBLOCK);
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw fail('NOT_A_FILE', 'Read requires a regular file.');
        const data = Buffer.alloc(Math.min(args.length, Math.max(0, stat.size - args.offset)));
        let count = 0;
        while (count < data.length) {
          signal.throwIfAborted();
          const next = await handle.read(data, count, Math.min(65536, data.length-count), args.offset+count);
          if (!next.bytesRead) break;
          count += next.bytesRead;
        }
        return {data: data.subarray(0,count).toString('base64'), size:stat.size};
      } finally { await handle.close(); }
    }
    case 'write': {
      const target = await fs.realpath(file).catch(error => { if (error.code !== 'ENOENT') throw error; return file; });
      const data = Buffer.from(args.data, 'base64');
      if (data.length > 2097152 || data.toString('base64') !== args.data) throw fail('INVALID_DATA', 'Invalid or oversized write.');
      await fs.mkdir(path.dirname(target), {recursive:true});
      const stat = await fs.stat(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (stat && !stat.isFile()) throw fail('NOT_A_FILE', 'Write requires a regular file.');
      if ((args.expectedSha256 === null && stat) || (typeof args.expectedSha256 === 'string' && !stat)) throw fail('FILE_CONFLICT', 'Read the changed file before writing.');
      if (typeof args.expectedSha256 === 'string') {
        const hasher = createHash('sha256');
        for await (const chunk of createReadStream(target, {signal})) hasher.update(chunk);
        if (hasher.digest('hex') !== args.expectedSha256) throw fail('FILE_CONFLICT', 'Read the changed file before writing.');
      }
      const temporary = path.join(path.dirname(target), '.automaker-docker-' + randomUUID() + '.tmp');
      try {
        await fs.writeFile(temporary, data, {flag:'wx', mode:stat ? stat.mode & 0o777 : 0o644, signal});
        signal.throwIfAborted();
        await fs.rename(temporary, target);
      } finally { await fs.unlink(temporary).catch(() => {}); }
      return null;
    }
    case 'list': {
      const handle = await fs.opendir(file); const entries = []; let truncated = false;
      try {
        for await (const entry of handle) {
          signal.throwIfAborted();
          if (entries.length >= args.maximum) {truncated = true; break;}
          entries.push({name:entry.name, type:entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'symlink' : 'other'});
        }
      } finally { await handle.close().catch(() => {}); }
      return {entries, truncated};
    }
    case 'mkdir': await fs.mkdir(file, {recursive:true}); return null;
    case 'remove':
      if (file === '/') throw fail('INVALID_PATH', 'Use an explicit non-root removal target.');
      await fs.rm(file, {recursive:args.recursive, force:false}); return null;
    default: throw fail('INVALID_OPERATION', 'Unknown worker operation.');
  }
}
// Same bounded literal/glob semantics as search.ts; traversal stays inside the worker.
async function search(options) {
  const pattern = options.glob ?? '**/*';
  const parts = pattern.split('/');
  if (!pattern || pattern.length > 256 || /[\x00-\x1f]/.test(pattern) || parts.some(part => !part || part === '.' || part === '..' || (part.includes('**') && part !== '**')))
    throw fail('INVALID_PATTERN','Use a relative glob with *, ? and whole-segment **.');
  const segment = (pattern,value) => {
    const chars = Array.from(value); let states = new Array(chars.length+1).fill(false); states[0]=true;
    for (const char of pattern) {
      const next = new Array(chars.length+1).fill(false); if (char === '*') next[0]=states[0];
      for (let i=1;i<=chars.length;i++) next[i] = char === '*' ? states[i] || next[i-1] : (char === '?' || char === chars[i-1]) && states[i-1];
      states=next;
    }
    return states[chars.length];
  };
  const test = value => {
    const names=value.split('/'); let states=new Array(names.length+1).fill(false); states[0]=true;
    for (const part of parts) {
      const next=new Array(names.length+1).fill(false); if (part === '**') next[0]=states[0];
      for(let i=1;i<=names.length;i++) next[i] = part === '**' ? states[i] || next[i-1] : states[i-1] && segment(part,names[i-1]);
      states=next;
    }
    return states[names.length];
  };
  const queue=[{directory:options.path ?? '.',relative:'',depth:0}];
  const result={files:[],matches:[],truncated:false}; let visited=0,scanned=0;
  const maximum=Math.max(1,Math.min(options.maxResults ?? 100,500));
  const needle=options.caseSensitive === false ? options.text?.toLowerCase() : options.text;
  while(queue.length) {
    signal.throwIfAborted(); const current=queue.shift();
    const listing=await main({operation:'list',args:{path:current.directory,maximum:10000-visited}});
    result.truncated ||= listing.truncated;
    for(const entry of listing.entries) {
      if(++visited>10000) return {...result,truncated:true};
      signal.throwIfAborted();
      if(visited%32===0) await new Promise(resolve=>setImmediate(resolve));
      const relative=current.relative ? current.relative+'/'+entry.name : entry.name;
      const target=path.join(current.directory,entry.name);
      if(entry.type==='directory') {
        if(!options.includeDependencies && ['node_modules','.git','dist','build','.next'].includes(entry.name)) continue;
        if(current.depth<32) queue.push({directory:target,relative,depth:current.depth+1}); else result.truncated=true;
      } else if(entry.type==='file' && test(relative)) {
        if(needle===undefined) result.files.push(target);
        else {
          if(scanned>=8388608) return {...result,truncated:true};
          const read=await main({operation:'read',args:{path:target,offset:0,length:Math.min(262144,8388608-scanned)}});
          const data=Buffer.from(read.data,'base64'); scanned+=data.length; result.truncated ||= data.length<read.size;
          let text; try {text=new TextDecoder('utf8',{fatal:true}).decode(data);} catch {continue;}
          if(text.includes('\0')) continue;
          for(const [index,line] of text.split('\n').entries()) {
            if((options.caseSensitive===false ? line.toLowerCase() : line).includes(needle)) {
              result.matches.push({path:target,line:index+1,text:line.slice(0,1000)});
              if(result.matches.length>=maximum) return {...result,truncated:true};
            }
          }
        }
        if(result.files.length>=maximum) return {...result,truncated:true};
      }
    }
    if(visited>=10000) return {...result,truncated:true};
  }
  return result;
}
(async () => {
  await fs.mkdir(jobsDirectory, {recursive:true, mode:0o700});
  await fs.writeFile(base + '.running', JSON.stringify({pid:process.pid,start:await processStart(process.pid)}), {flag:'wx',mode:0o600});
  let response;
  try {
    for(let i=0;await fs.stat(jobsDirectory+'-stopping').then(()=>true,()=>false);i++) {
      signal.throwIfAborted();
      if(i>=100) throw fail('ENVIRONMENT_STOPPING','Environment is stopping; no command was executed.');
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    if (await fs.stat(base + '.cancel').then(() => true, () => false)) controller.abort();
    const chunks=[]; let bytes=0; for await (const chunk of process.stdin) {
      bytes += chunk.length; if (bytes > 3000000) throw fail('INVALID_DATA', 'Worker request too large.');
      chunks.push(chunk);
    }
    response = {ok:true, value:await main(JSON.parse(Buffer.concat(chunks).toString('utf8')))};
  } catch (error) {
    response = {ok:false, error:{code:/^[A-Z_0-9]{1,64}$/.test(error.code || '') ? error.code : 'ENVIRONMENT_IO_ERROR', message:'Container operation failed. Inspect state before retrying.'}};
    if (['PROCESS_INTERRUPTED','PROCESS_CLEANUP_FAILED','PROCESS_NOT_INSTALLED','PROCESS_FAILED','PROCESS_OUTPUT_LIMIT','INVALID_PROCESS','FILE_CONFLICT','INVALID_PATH','INVALID_RANGE','NOT_A_FILE'].includes(error.code)) response.error.message = error.message;
  } finally {
    await fs.writeFile(base + '.done', 'done', {mode:0o600});
    await fs.unlink(base + '.running').catch(() => {});
  }
  if(streaming)frame(response);else process.stdout.write(JSON.stringify(response));
})().catch(() => process.exit(1));
`;

// Writes a cancellation tombstone first: cancellation before the exec starts is not lost.
// Completion must be observed; killing the local docker client alone is never success.
export const DOCKER_CANCEL = String.raw`
const fs = require('node:fs/promises');
const id = process.argv[1];
const jobsDirectory = process.argv[2] || '/tmp/automaker-jobs';
if (!/^[a-f0-9-]{36}$/.test(id || '')) process.exit(2);
(async () => {
  const base = jobsDirectory + '/' + id;
  await fs.mkdir(jobsDirectory, {recursive:true,mode:0o700});
  await fs.writeFile(base + '.cancel', 'cancel', {mode:0o600});
  for (let i=0; i<40; i++) {
    if (await fs.stat(base + '.done').then(() => true, () => false)) return;
    const state = await fs.readFile(base + '.running','utf8').then(JSON.parse, () => null);
    if (!state && process.argv[3] === 'recover') return;
    if (state) { try {
      const stat=await fs.readFile('/proc/'+state.pid+'/stat','utf8');
      if (stat.slice(stat.lastIndexOf(')')+2).split(' ')[19] === state.start) process.kill(state.pid, 'SIGTERM');
    } catch {} }
    await new Promise(resolve => setTimeout(resolve,100));
  }
  process.exitCode = 1;
})().catch(() => {process.exitCode=1;});
`;
