/** Fixed target-side memory storage protocol. Never loaded from project/node_modules. */
export const MEMORY_WORKER = String.raw`
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const p=JSON.parse(process.argv[1]);
const bad=(code,message)=>{throw Object.assign(Error(message),{code});};
const digest=data=>createHash('sha256').update(data).digest('hex');
const name=value=>{
 if(typeof value!=='string'||!value||value.length>255||/[\\/\0]/.test(value)||! /\.md$/i.test(value)||value.toLowerCase()==='_index.md')bad('MEMORY_PATH_INVALID','Expected a memory category filename, not a path.');
 return value;
};
const directory=(dir,create)=>{
 if(create){try{fs.mkdirSync(dir);}catch(e){if(e.code!=='EEXIST')throw e;}}
 try{if(!fs.lstatSync(dir).isDirectory()||fs.realpathSync(dir)!==dir)bad('MEMORY_PATH_INVALID','Memory directories must not be symlinks.');return true;}
 catch(e){if(!create&&e.code==='ENOENT')return false;throw e;}
};
let root,folder;
const prepare=create=>{
 if(typeof p.root!=='string'||!path.isAbsolute(p.root)||fs.realpathSync(p.root)!==p.root)bad('MEMORY_PATH_INVALID','Authoritative project root changed.');
 root=p.root;folder=path.join(root,'.automaker','memory');
 return directory(path.join(root,'.automaker'),create)&&directory(folder,create);
};
const read=filename=>{
 const file=path.join(folder,name(filename));let handle;
 try{handle=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}
 catch(e){if(e.code==='ENOENT')return null;if(e.code==='ELOOP')bad('MEMORY_PATH_INVALID','Memory files must not be symlinks.');throw e;}
 try{
  const stat=fs.fstatSync(handle);if(!stat.isFile())bad('MEMORY_PATH_INVALID','Memory requires a regular text file.');
  if(stat.size>32768)bad('MEMORY_BUDGET','Memory exceeds 32 KiB per file.');
  const buffer=Buffer.alloc(32769);let count=0;
  while(count<buffer.length){const next=fs.readSync(handle,buffer,count,buffer.length-count,null);if(!next)break;count+=next;}
  const data=buffer.subarray(0,count);if(data.length>32768)bad('MEMORY_BUDGET','Memory exceeds 32 KiB per file.');
  new TextDecoder('utf8',{fatal:true}).decode(data);
  return {name:filename,data:data.toString('base64'),sha256:digest(data),mode:stat.mode&0o777};
 }finally{fs.closeSync(handle);}
};
try{
 let result;
 if(p.action==='list'){
  const files=[];let bytes=0;
  if(prepare(false)){
   const entries=[],directory=fs.opendirSync(folder);
   try{let entry;while((entry=directory.readSync())){entries.push(entry);if(entries.length>50)bad('MEMORY_BUDGET','Too many memory entries (maximum 50).');}}
   finally{directory.closeSync();}
   for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
    if(! /\.md$/i.test(entry.name)||entry.name.toLowerCase()==='_index.md')continue;
    const file=read(entry.name);if(!file)continue;
    bytes+=Buffer.from(file.data,'base64').length;
    if(bytes>Math.min(p.maximumBytes??65536,65536))bad('MEMORY_BUDGET','Automatic context exceeds 64 KiB total.');
    files.push(file);
   }
  }
  result={files,bytes};
 }else if(p.action==='read'){name(p.name);result=prepare(false)?read(p.name):null;}
 else if(p.action==='write'){
  name(p.name);
  const data=Buffer.from(p.data,'base64');
  if(data.toString('base64')!==p.data||data.length>32768)bad('MEMORY_BUDGET','Memory write exceeds 32 KiB.');
  new TextDecoder('utf8',{fatal:true}).decode(data);
  if(p.expected!==null&&!/^[a-f0-9]{64}$/.test(p.expected??''))bad('MEMORY_REQUEST_INVALID','A previous snapshot is required.');
  prepare(true);
  const lock=path.join(folder,'.automaker-memory.lock');let handle,temporary;
  try{
   try{handle=fs.openSync(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')bad('MEMORY_BUSY','Memory is locked by another writer or an interrupted operation. Inspect the target lock before retrying.');throw e;}
   fs.writeFileSync(handle,JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));
   const current=read(p.name);
   if((current?.sha256??null)!==p.expected)bad('MEMORY_CONFLICT','Memory changed since reading. No overwrite or automatic retry was performed.');
   temporary=path.join(folder,'.automaker-memory-'+randomUUID()+'.tmp');
   const output=fs.openSync(temporary,'wx',current?.mode??0o644);
   try{fs.writeFileSync(output,data);if(current)fs.fchmodSync(output,current.mode);fs.fsyncSync(output);}finally{fs.closeSync(output);}
   fs.renameSync(temporary,path.join(folder,p.name));temporary=undefined;
   result=null;
  }finally{
   if(temporary)fs.unlinkSync(temporary);
   if(handle!==undefined){fs.closeSync(handle);fs.unlinkSync(lock);}
  }
 }else bad('MEMORY_REQUEST_INVALID','Unsupported memory operation.');
 process.stdout.write(JSON.stringify({ok:true,result}));
}catch(e){process.stdout.write(JSON.stringify({ok:false,code:e.code||'MEMORY_FAILED',error:e.code==='ERR_ENCODING_INVALID_ENCODED_DATA'?'Memory must be valid UTF-8.':e.message}));}
`;
