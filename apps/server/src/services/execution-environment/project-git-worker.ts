/** Target-side, fixed Git API. Requests cannot supply commands, flags, hooks or executable paths. */
export const PROJECT_GIT_WORKER = String.raw`
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const p=JSON.parse(process.argv[1]),b=p.body;
const bad=(code,error)=>{throw Object.assign(Error(error),{code});};
const git=(cwd,...args)=>execFileSync('git',['--no-pager','--literal-pathspecs','-c','color.ui=false','-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','-c','core.fsmonitor=false','-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:3*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}});
const optional=(cwd,...args)=>{try{return git(cwd,...args).trim();}catch(e){if(e.status===1||e.status===128)return '';throw e;}};
const inside=(root,file)=>file===root||file.startsWith(root+'/');
let cwd=p.cwd;
const root=fs.realpathSync(p.root);
const verify=dir=>{
 if(fs.realpathSync(dir)!==dir||!inside(root,dir)||fs.realpathSync(git(dir,'rev-parse','--show-toplevel').trim())!==dir||fs.realpathSync(path.resolve(dir,git(dir,'rev-parse','--git-common-dir').trim()))!==path.join(root,'.git'))bad('GIT_WORKSPACE_CHANGED','Target working copy identity changed. No host fallback was performed.');
};
const alias=dir=>path.posix.join(p.controllerRoot,path.posix.relative(root,dir));
const worktrees=()=>git(root,'worktree','list','--porcelain','-z').split('\0\0').filter(Boolean).map(record=>{
 const lines=record.split('\0');const dir=lines.find(s=>s.startsWith('worktree '))?.slice(9);
 const branch=lines.find(s=>s.startsWith('branch '))?.slice(7).replace(/^refs\/heads\//,'')||'HEAD';
 if(!dir||!inside(root,dir))return null;verify(dir);
 const status=entries(dir),conflicts=status.filter(x=>x.isConflicted).map(x=>x.path);
 return {path:alias(dir),runtimePath:dir,branch,isMain:dir===root,isCurrent:dir===cwd,hasWorktree:true,hasChanges:status.length>0,changedFilesCount:status.length,hasConflicts:conflicts.length>0,conflictFiles:conflicts};
}).filter(Boolean);
const stats=(dir,cached)=>{
 const result=new Map();const parts=git(dir,'diff','--no-ext-diff','--no-textconv','--numstat','--no-renames','-z',...(cached?['--cached']:[])).split('\0');
 for(const item of parts){const match=/^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(item);if(match)result.set(match[3],{added:Number(match[1])||0,removed:Number(match[2])||0});}return result;
};
const entries=dir=>{
 const tokens=git(dir,'status','--porcelain=v1','-z','--untracked-files=all').split('\0'),wt=stats(dir,false),st=stats(dir,true),result=[];
 for(let i=0;i<tokens.length;i++){
  const line=tokens[i];if(!line)continue;const x=line[0],y=line[1],name=line.slice(3);if(x==='R'||x==='C'||y==='R'||y==='C')i++;
  const conflict=x==='U'||y==='U'||(x==='A'&&y==='A')||(x==='D'&&y==='D');
  const staged=x!==' '&&x!=='?',unstaged=y!==' '&&y!=='?';
  const label=conflict?'Conflicted':staged?(unstaged?'Staged + Modified':'Staged'):({M:'Modified',A:'Added',D:'Deleted',R:'Renamed',C:'Copied','?':'Untracked'}[y!==' '?y:x]||'');
  result.push({path:name,status:x==='?'?'?':(x!==' '?x:y),indexStatus:x,workTreeStatus:y,isConflicted:conflict,isStaged:staged,isUnstaged:unstaged,linesAdded:(wt.get(name)?.added||0)+(st.get(name)?.added||0),linesRemoved:(wt.get(name)?.removed||0)+(st.get(name)?.removed||0),statusLabel:label});
 }return result;
};
const file=value=>{
 if(typeof value!=='string'||!value||value==='.'||value.includes('\0')||value.includes('\\')||path.isAbsolute(value)||value.split('/').some(part=>part==='..'||part==='.git'))bad('GIT_FILE_INVALID','Only relative project file paths (not .git, traversal or absolute paths) are supported.');
 let probe=path.resolve(cwd,value);if(!inside(cwd,probe))bad('GIT_FILE_INVALID','File path escaped the worktree.');
 while(!fs.existsSync(probe)&&probe!==cwd)probe=path.dirname(probe);
 if(!inside(cwd,fs.realpathSync(probe)))bad('GIT_FILE_INVALID','File path follows a symlink outside the worktree.');
 return value;
};
const files=()=>{if(!Array.isArray(b.files)||!b.files.length||b.files.length>1000)bad('GIT_FILE_INVALID','Select between 1 and 1000 relative files.');return b.files.map(file);};
const branch=value=>{if(typeof value!=='string'||!value||value.startsWith('-'))bad('GIT_BRANCH_INVALID','An existing local branch is required.');git(root,'check-ref-format','refs/heads/'+value);return value;};
const head=dir=>optional(dir,'rev-parse','--verify','HEAD');
const fileDiff=(dir,name)=>{
 file(name);const untracked=git(dir,'ls-files','--others','--exclude-standard','-z','--',name).split('\0').includes(name);
 if(!untracked)return git(dir,'diff','--no-ext-diff','--no-textconv',...(head(dir)?['HEAD']:['--cached']),'--',name);
 const full=path.join(dir,name),stat=fs.lstatSync(full);
 if(!stat.isFile()||stat.size>262144)return 'diff --git a/'+name+' b/'+name+'\nNew binary, symlink or large file (content omitted)\n';
 const data=fs.readFileSync(full);if(data.includes(0))return 'Binary file '+name+' added\n';
 const lines=data.toString('utf8').split('\n');if(lines.at(-1)==='')lines.pop();
 return 'diff --git a/'+name+' b/'+name+'\nnew file mode 100644\n--- /dev/null\n+++ b/'+name+'\n@@ -0,0 +1,'+lines.length+' @@\n'+lines.map(s=>'+'+s).join('\n')+'\n';
};
const mergeState=()=>{
 const dir=path.resolve(cwd,git(cwd,'rev-parse','--git-dir').trim());
 const kind=fs.existsSync(path.join(dir,'rebase-merge'))||fs.existsSync(path.join(dir,'rebase-apply'))?'rebase':fs.existsSync(path.join(dir,'MERGE_HEAD'))?'merge':fs.existsSync(path.join(dir,'CHERRY_PICK_HEAD'))?'cherry-pick':null;
 const conflictFiles=kind?entries(cwd).filter(x=>x.isConflicted).map(x=>x.path):[];
 return kind?{isMerging:true,mergeOperationType:kind,isCleanMerge:conflictFiles.length===0,mergeAffectedFiles:entries(cwd).map(x=>x.path),conflictFiles}:undefined;
};
try{
 verify(cwd);
 if(b.workspaceBranch){const list=worktrees().filter(item=>item.branch===b.workspaceBranch);if(list.length!==1)bad('GIT_WORKSPACE_REQUIRED','No unambiguous worktree exists for this branch. No project-root fallback was used.');cwd=list[0].runtimePath;verify(cwd);}
 let result;
 if(p.action==='environment')result={};
 else if(p.action==='list')result={worktrees:worktrees()};
 else if(p.action==='info')result={worktreePath:alias(cwd),branchName:git(cwd,'rev-parse','--abbrev-ref','HEAD').trim()};
 else if(p.action==='status'){const list=entries(cwd);result={modifiedFiles:list.length,files:list.map(x=>x.path),diffStat:git(cwd,'diff','--no-ext-diff','--no-textconv','--stat').trim(),recentCommits:head(cwd)?git(cwd,'log','--oneline','-5').trim().split('\n'):[]};}
 else if(p.action==='check-changes'){const list=entries(cwd),staged=list.filter(x=>x.isStaged).map(x=>x.path),unstaged=list.filter(x=>x.isUnstaged).map(x=>x.path),untracked=list.filter(x=>x.status==='?').map(x=>x.path);result={result:{hasChanges:list.length>0,staged,unstaged,untracked,totalFiles:list.length}};}
 else if(p.action==='enhanced-status')result={branch:optional(cwd,'symbolic-ref','--quiet','--short','HEAD')||'HEAD',files:entries(cwd)};
 else if(p.action==='diffs'){const list=entries(cwd);if(list.length>300)bad('GIT_OUTPUT_LIMIT','Too many changed files to display automatically.');result={files:list.map(x=>({path:x.path,status:x.status,statusText:x.statusLabel,indexStatus:x.indexStatus,workTreeStatus:x.workTreeStatus,isMergeAffected:x.isConflicted})),hasChanges:list.length>0,diff:list.map(x=>fileDiff(cwd,x.path)).join('\n'),mergeState:mergeState()};}
 else if(p.action==='file-diff')result={filePath:file(b.filePath),diff:fileDiff(cwd,b.filePath)};
 else if(p.action==='details'){
  const current=optional(cwd,'symbolic-ref','--quiet','--short','HEAD')||'HEAD';
  if(!b.filePath)result={details:{branch:current}};
  else{const name=file(b.filePath),list=entries(cwd),item=list.find(x=>x.path===name);let meta=[];
   if(head(cwd))meta=git(cwd,'log','-1','--format=%H%x00%s%x00%an%x00%aI','--',name).trim().split('\0');
   result={details:{branch:current,lastCommitHash:meta[0]||'',lastCommitMessage:meta[1]||'',lastCommitAuthor:meta[2]||'',lastCommitTimestamp:meta[3]||'',linesAdded:item?.linesAdded||0,linesRemoved:item?.linesRemoved||0,isConflicted:!!item?.isConflicted,isStaged:!!item?.isStaged,isUnstaged:!!item?.isUnstaged,statusLabel:item?.statusLabel||''}};}
 }
 else if(p.action==='list-branches'){
  const current=optional(cwd,'symbolic-ref','--quiet','--short','HEAD')||'HEAD',remotes=git(cwd,'remote').trim().split('\n').filter(Boolean);
  const refs=git(cwd,'for-each-ref','--format=%(refname:short)%00%(refname)%00%(symref)','refs/heads',...(b.includeRemote?['refs/remotes']:[])).trim().split('\n').filter(Boolean).map(line=>{const [name,ref,sym]=line.split('\0');return {name,isCurrent:name===current,isRemote:ref.startsWith('refs/remotes/'),sym};}).filter(x=>!x.sym).map(({sym,...rest})=>rest);
  const upstream=optional(cwd,'rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}');
  const counts=upstream?git(cwd,'rev-list','--left-right','--count','@{upstream}...HEAD').trim().split(/\s+/).map(Number):[0,0];
  result={result:{currentBranch:current,branches:refs,aheadCount:counts[1]||0,behindCount:counts[0]||0,hasRemoteBranch:!!upstream,hasAnyRemotes:remotes.length>0,trackingRemote:upstream.split('/')[0]||undefined,remotesWithBranch:remotes.filter(name=>optional(cwd,'show-ref','--verify','--hash','refs/remotes/'+name+'/'+current))},remoteRefsCached:true};
 }
 else if(p.action==='list-remotes'){const names=git(cwd,'remote').trim().split('\n').filter(Boolean);result={result:{remotes:names.map(name=>({name,url:git(cwd,'remote','get-url',name).trim().replace(/(https?:\/\/)[^/@\s]+@/g,'$1[redacted]@'),branches:git(cwd,'for-each-ref','--format=%(refname:short)','refs/remotes/'+name+'/').trim().split('\n').filter(x=>x&&!x.endsWith('/HEAD')).map(fullRef=>({fullRef,name:fullRef.slice(name.length+1)}))}))},remoteRefsCached:true};}
 else if(p.action==='commit-log'||p.action==='branch-commit-log'){
  const ref=b.branchName?('refs/heads/'+branch(b.branchName)):'HEAD',limit=Math.max(1,Math.min(100,Number.isFinite(Number(b.limit))?Math.floor(Number(b.limit)):20));
  const commits=head(cwd)?git(cwd,'log','--no-color','--max-count='+limit,'--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00',ref,'--').split('\0\n').filter(Boolean).map(record=>{const [hash,shortHash,author,authorEmail,date,subject,body]=record.split('\0');if(!/^[a-f0-9]{40,64}$/.test(hash))bad('GIT_OUTPUT_INVALID','Invalid Git log object identity.');return {hash,shortHash,author,authorEmail,date,subject,body,files:git(cwd,'diff-tree','--root','--no-commit-id','--name-only','-r','-z',hash,'--').split('\0').filter(Boolean)};}):[];
  result={result:{branch:b.branchName||optional(cwd,'symbolic-ref','--quiet','--short','HEAD')||'HEAD',commits,total:commits.length}};
 }
 else if(p.action==='stage-files'){
  if(b.operation!=='stage'&&b.operation!=='unstage')bad('GIT_OPERATION_INVALID','operation must be stage or unstage');const names=files();
  git(cwd,...(b.operation==='stage'?['add','--',...names]:head(cwd)?['reset','HEAD','--',...names]:['rm','--cached','--',...names]));result={result:{operation:b.operation,filesCount:names.length}};
 }
 else if(p.action==='commit'){
  if(typeof b.message!=='string'||!b.message.trim()||b.message.length>10000||b.message.includes('\0'))bad('GIT_MESSAGE_INVALID','A commit message (1–10000 characters) is required.');
  if(mergeState())bad('GIT_OPERATION_IN_PROGRESS','Resolve the in-progress Git operation on target before committing in this UI.');
  if(!entries(cwd).length)result={result:{committed:false,message:'No changes to commit'}};
  else{
   if(b.files!==undefined){const names=files();git(cwd,...(head(cwd)?['reset','HEAD','--','.']:['rm','-r','--cached','--ignore-unmatch','--','.']));git(cwd,'add','--',...names);}
   else git(cwd,'add','-A');
   git(cwd,'-c','user.name=Automaker','-c','user.email=automaker@localhost','commit','-m',b.message);
   result={result:{committed:true,commitHash:git(cwd,'rev-parse','HEAD').trim().slice(0,8),branch:git(cwd,'symbolic-ref','--quiet','--short','HEAD').trim(),message:b.message}};
  }
 }
 else if(p.action==='create'){
  if(cwd!==root||p.pinned)bad('GIT_PINNED_WORKSPACE','Create worktrees only from the project root.');
  const name=branch(b.branchName),base=b.baseBranch?branch(b.baseBranch):git(root,'symbolic-ref','--quiet','--short','HEAD').trim();
  const oid=git(root,'rev-parse','--verify','refs/heads/'+base+'^{commit}').trim(),dir=path.join(root,'.worktrees','ui-'+createHash('sha256').update(name).digest('hex').slice(0,24));
  const registered=worktrees().find(x=>x.branch===name);if(registered)result={worktree:{path:registered.path,branch:name,isNew:false,baseCommitHash:git(registered.runtimePath,'rev-parse','HEAD').trim()}};
  else{
   if(optional(root,'show-ref','--verify','--hash','refs/heads/'+name)||fs.existsSync(dir))bad('GIT_BRANCH_EXISTS','Branch/path already exists; no branch reset, deletion or overwrite was performed.');
   fs.mkdirSync(path.dirname(dir),{recursive:true});if(fs.realpathSync(path.dirname(dir))!==path.dirname(dir))bad('GIT_WORKSPACE_CHANGED','Worktree parent must not be a symlink.');
   git(root,'worktree','add','-b',name,'--',dir,oid);result={worktree:{path:alias(dir),branch:name,isNew:true,baseCommitHash:oid},initScriptSkipped:true};
  }
 }
 else bad('GIT_OPERATION_UNSUPPORTED','Operation not migrated.');
 const response={success:true,...result,resolvedCwd:cwd};const output=JSON.stringify(response);
 if(Buffer.byteLength(output)>3500000)bad('GIT_OUTPUT_LIMIT','Git response exceeds its display budget. Inspect the target before retrying mutations.');
 process.stdout.write(output);
}catch(error){process.stdout.write(JSON.stringify({success:false,code:typeof error.code==='string'?error.code:'GIT_TARGET_FAILED',error:error.code?error.message:'Target Git operation failed. Inspect the working tree/index on target; no controller fallback or retry was performed.'}));process.exitCode=1;}
`;
