/** Target-side, fixed Git API. Requests cannot supply commands, flags, hooks or executable paths. */
export const PROJECT_GIT_WORKER = String.raw`
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const p=JSON.parse(process.argv[1]),b=p.body;
const bad=(code,error)=>{throw Object.assign(Error(error),{code});};
const git=(cwd,...args)=>execFileSync('git',['--no-pager','--literal-pathspecs','-c','color.ui=false','-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','-c','core.fsmonitor=false','-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:3*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}});
const optional=(cwd,...args)=>{try{return git(cwd,...args).trim();}catch(e){if(e.status===1||e.status===128)return '';throw e;}};
const succeeds=(cwd,...args)=>{try{git(cwd,...args);return true;}catch{return false;}};
const inside=(root,file)=>file===root||file.startsWith(root+'/');
let cwd=p.cwd;
const root=fs.realpathSync(p.root);
const automaker=()=>{const dir=path.join(root,'.automaker');if(fs.existsSync(dir)){const actual=fs.realpathSync(dir);if(!inside(root,actual))bad('GIT_WORKSPACE_CHANGED','.automaker must stay inside the selected target project.');}return dir;};
const initScript=()=>path.join(automaker(),'worktree-init.sh');
const metadataFile=name=>{const safe=name.replace(/[/\\:*?"<>|]/g,'-').replace(/\s+/g,'_').replace(/\.+$/g,'').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,200)||'_branch';return path.join(automaker(),'worktrees',safe,'worktree.json');};
const writeMetadata=(name,updates)=>{const file=metadataFile(name);let current={};try{current=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}const value={branch:name,createdAt:current.createdAt??new Date().toISOString(),...current,...updates};fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.'+process.pid+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value,null,2),{mode:384});fs.renameSync(temporary,file);};
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
const copyFile=value=>{if(typeof value!=='string'||!value||value==='.'||value.includes('\0')||value.includes('\\')||path.isAbsolute(value)||value.split('/').some(part=>part==='..'||part==='.git'))bad('GIT_FILE_INVALID','Configured copy paths must be relative project paths.');return value;};
const files=()=>{if(!Array.isArray(b.files)||!b.files.length||b.files.length>1000)bad('GIT_FILE_INVALID','Select between 1 and 1000 relative files.');return b.files.map(file);};
const branch=value=>{if(typeof value!=='string'||!value||value.startsWith('-'))bad('GIT_BRANCH_INVALID','An existing local branch is required.');git(root,'check-ref-format','refs/heads/'+value);return value;};
const remote=value=>{if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,249}$/.test(value))bad('GIT_REMOTE_INVALID','Remote name is invalid.');return value;};
const stashIndex=value=>{const number=Number(value);if(!Number.isInteger(number)||number<0||number>100000)bad('GIT_STASH_INVALID','stashIndex must be a non-negative integer.');return number;};
const commit=value=>{if(typeof value!=='string'||!/^[a-fA-F0-9]{4,64}$/.test(value))bad('GIT_COMMIT_INVALID','Commit id must be a hexadecimal object id.');const oid=optional(cwd,'rev-parse','--verify',value+'^{commit}');if(!oid)bad('GIT_COMMIT_MISSING','Commit does not exist on the selected target.');return oid;};
const operation=()=>{const dir=path.resolve(cwd,git(cwd,'rev-parse','--git-dir').trim());return fs.existsSync(path.join(dir,'rebase-merge'))||fs.existsSync(path.join(dir,'rebase-apply'))?'rebase':fs.existsSync(path.join(dir,'MERGE_HEAD'))?'merge':fs.existsSync(path.join(dir,'CHERRY_PICK_HEAD'))?'cherry-pick':undefined;};
const currentBranch=()=>optional(cwd,'symbolic-ref','--quiet','--short','HEAD')||bad('GIT_DETACHED_HEAD','This network operation requires a checked-out branch.');
const conflictFiles=()=>entries(cwd).filter(x=>x.isConflicted).map(x=>x.path);
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
 if(p.action!=='init-git')verify(cwd);
 if(b.workspaceBranch){const list=worktrees().filter(item=>item.branch===b.workspaceBranch);if(list.length!==1)bad('GIT_WORKSPACE_REQUIRED','No unambiguous worktree exists for this branch. No project-root fallback was used.');cwd=list[0].runtimePath;verify(cwd);}
 let result;
 if(p.action==='init-git'){
  if(cwd!==root)bad('GIT_PROJECT_ROOT_REQUIRED','Git initialization must run at the selected target project root.');const directory=path.join(root,'.git');if(fs.existsSync(directory))result={result:{initialized:false,message:'Git repository already exists'}};else{let created=false;try{git(root,'init','--initial-branch=main');created=true;if(!optional(root,'config','user.name'))git(root,'config','user.name','Automaker');if(!optional(root,'config','user.email'))git(root,'config','user.email','automaker@localhost');git(root,'commit','--allow-empty','-m','Initial commit');result={result:{initialized:true,message:'Git repository initialized with initial commit'}};}catch(error){if(created)fs.rmSync(directory,{recursive:true,force:true});throw error;}}
 }
 else if(p.action==='environment')result={};
 else if(p.action==='init-script-get'){
  const script=initScript(),exists=fs.existsSync(script);if(exists){const stat=fs.lstatSync(script);if(!stat.isFile()||stat.size>1048576||!inside(root,fs.realpathSync(script)))bad('INIT_SCRIPT_INVALID','Init script must be a regular project file no larger than 1MB.');}result={exists,content:exists?fs.readFileSync(script,'utf8'):'',path:path.posix.join(p.controllerRoot,'.automaker','worktree-init.sh')};
 }
 else if(p.action==='init-script-put'){
  if(typeof b.content!=='string'||Buffer.byteLength(b.content)>1048576)bad('INIT_SCRIPT_INVALID','Init script must be text no larger than 1MB.');const script=initScript();fs.mkdirSync(path.dirname(script),{recursive:true});if(!inside(root,fs.realpathSync(path.dirname(script))))bad('GIT_WORKSPACE_CHANGED','.automaker escaped the selected target project.');fs.writeFileSync(script,b.content,{encoding:'utf8',mode:384});result={path:path.posix.join(p.controllerRoot,'.automaker','worktree-init.sh')};
 }
 else if(p.action==='init-script-delete'){
  fs.rmSync(initScript(),{force:true});result={};
 }
 else if(p.action==='run-init-script'){
  const name=branch(b.branch),current=optional(cwd,'symbolic-ref','--quiet','--short','HEAD');if(current!==name)bad('GIT_WORKSPACE_CHANGED','Requested branch is not checked out in the selected target worktree.');const script=initScript();if(!fs.existsSync(script))result={initScript:{success:true,skipped:true,stdout:'',stderr:''}};else{const stat=fs.lstatSync(script);if(!stat.isFile()||stat.size>1048576||!inside(root,fs.realpathSync(script)))bad('INIT_SCRIPT_INVALID','Init script must be a regular project file no larger than 1MB.');writeMetadata(name,{initScriptRan:false,initScriptStatus:'running'});const shell=fs.existsSync('/bin/sh')?'/bin/sh':'bash',env={PATH:process.env.PATH??'',HOME:process.env.HOME??'',USER:process.env.USER??'',TMPDIR:process.env.TMPDIR??'/tmp',SHELL:process.env.SHELL??'',LANG:process.env.LANG??'en_US.UTF-8',LC_ALL:process.env.LC_ALL??'',FORCE_COLOR:'1',npm_config_color:'always',CLICOLOR_FORCE:'1',GIT_TERMINAL_PROMPT:'0',AUTOMAKER_PROJECT_PATH:root,AUTOMAKER_WORKTREE_PATH:cwd,AUTOMAKER_BRANCH:name};let stdout='',stderr='',exitCode=0;try{stdout=execFileSync(shell,[script],{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:110000,maxBuffer:1024*1024});}catch(error){stdout=String(error.stdout??'');stderr=String(error.stderr??'');exitCode=Number.isInteger(error.status)?error.status:1;}const success=exitCode===0;writeMetadata(name,{initScriptRan:true,initScriptStatus:success?'success':'failed',initScriptError:success?undefined:'Exit code: '+exitCode});result={initScript:{success,stdout,stderr,exitCode}};}
 }
 else if(p.action==='commit-message-context'){
  const staged=git(cwd,'diff','--cached','--no-ext-diff','--no-textconv'),diff=(staged.trim()?staged:git(cwd,'diff','--no-ext-diff','--no-textconv')).slice(0,10000);result={diff:diff+(diff.length===10000?'\n\n[... diff truncated ...]':'')};
 }
 else if(p.action==='pr-description-context'){
  const base=branch(b.baseBranch??'main'),current=currentBranch(),local=optional(cwd,'rev-parse','--verify','refs/heads/'+base+'^{commit}')?'refs/heads/'+base:optional(cwd,'rev-parse','--verify','refs/remotes/origin/'+base+'^{commit}')?'refs/remotes/origin/'+base:undefined,committed=local?optional(cwd,'diff','--no-ext-diff','--no-textconv',local+'...HEAD'):'',staged=git(cwd,'diff','--cached','--no-ext-diff','--no-textconv'),unstaged=git(cwd,'diff','--no-ext-diff','--no-textconv'),combined=[committed,staged,unstaged].filter(Boolean).join('\n').slice(0,15000),commitLog=local?optional(cwd,'log',local+'..HEAD','--oneline','--no-decorate').slice(0,20000):'';result={branch:current,baseBranch:base,diff:combined+(combined.length===15000?'\n\n[... diff truncated ...]':''),commitLog};
 }
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
 else if(p.action==='stash-list'){
  const lines=git(cwd,'stash','list','--format=%gd%x00%s%x00%aI').trim().split('\n').filter(Boolean),stashes=[];
  for(const line of lines){const [ref,message,date]=line.split('\0'),match=/^stash@\{(\d+)\}$/.exec(ref);if(!match)continue;const branchMatch=/^(?:WIP on|On) ([^:]+):/.exec(message);stashes.push({index:Number(match[1]),message,branch:branchMatch?.[1]||'',date,files:git(cwd,'stash','show',ref,'--name-only','-z').split('\0').filter(Boolean)});}
  result={result:{stashes,total:stashes.length}};
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
 else if(p.action==='abort-operation'){
  const kind=operation();if(!kind)bad('GIT_OPERATION_MISSING','No merge, rebase, or cherry-pick is in progress.');git(cwd,kind,'--abort');result={result:{operation:kind,message:kind[0].toUpperCase()+kind.slice(1)+' aborted successfully'}};
 }
 else if(p.action==='continue-operation'){
  const kind=operation();if(!kind)bad('GIT_OPERATION_MISSING','No merge, rebase, or cherry-pick is in progress.');if(entries(cwd).some(x=>x.isConflicted))bad('GIT_CONFLICT_UNRESOLVED','Resolve every conflict before continuing.');git(cwd,'add','-A');if(kind==='merge')git(cwd,'-c','core.editor=true','commit','--no-edit');else git(cwd,'-c','core.editor=true',kind,'--continue');result={result:{operation:kind,message:kind[0].toUpperCase()+kind.slice(1)+' continued successfully'}};
 }
 else if(p.action==='add-remote'){
  const name=remote(b.remoteName),url=b.remoteUrl;if(typeof url!=='string'||url.length>2048||url.includes('\0')||!(/^(https?|git|ssh):\/\//.test(url)||/^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:.+/.test(url)))bad('GIT_REMOTE_URL_INVALID','Remote URL must use HTTPS, SSH, or git protocol.');if(git(cwd,'remote').trim().split('\n').includes(name))bad('REMOTE_EXISTS','Remote already exists.');git(cwd,'remote','add',name,url);let fetched=true;try{git(cwd,'fetch',name,'--quiet');}catch{fetched=false;}result={result:{remoteName:name,remoteUrl:url,fetched,message:fetched?'Successfully added remote and fetched its branches':'Successfully added remote (fetch failed)'}};
 }
 else if(p.action==='set-tracking'){
  const name=remote(b.remote),requested=b.branchName??b.branch,local=requested?branch(requested):(optional(cwd,'symbolic-ref','--quiet','--short','HEAD')||bad('GIT_DETACHED_HEAD','Cannot set tracking in detached HEAD state.'));git(cwd,'branch','--set-upstream-to',name+'/'+local,local);result={result:{branch:local,remote:name,upstream:name+'/'+local,message:'Set tracking branch to '+name+'/'+local}};
 }
 else if(p.action==='stash-push'){
  const list=entries(cwd);if(!list.length)result={result:{stashed:false,message:'No changes to stash'}};else{const args=['stash','push','--include-untracked'];if(b.message!==undefined){if(typeof b.message!=='string'||b.message.length>10000||b.message.includes('\0'))bad('GIT_MESSAGE_INVALID','Stash message is invalid.');if(b.message.trim())args.push('-m',b.message.trim());}if(b.files!==undefined)args.push('--',...files());git(cwd,...args);const current=optional(cwd,'symbolic-ref','--quiet','--short','HEAD')||'HEAD';result={result:{stashed:true,branch:current,message:b.message?.trim()||'WIP on '+current}};}
 }
 else if(p.action==='stash-apply'){
  const index=stashIndex(b.stashIndex),kind=b.pop?'pop':'apply',ref='stash@{'+index+'}';let failed;try{git(cwd,'stash',kind,ref);}catch(error){failed=error;}const conflicts=entries(cwd).filter(x=>x.isConflicted).map(x=>x.path);if(failed&&!conflicts.length)throw failed;result={result:{applied:true,hasConflicts:conflicts.length>0,conflictFiles:conflicts,operation:kind,stashIndex:index,message:'Stash '+(kind==='pop'?'popped':'applied')+(conflicts.length?' with conflicts':' successfully')}};
 }
 else if(p.action==='stash-drop'){
  const index=stashIndex(b.stashIndex),ref='stash@{'+index+'}';git(cwd,'stash','drop',ref);result={result:{dropped:true,stashIndex:index,message:'Stash '+ref+' dropped successfully'}};
 }
 else if(p.action==='checkout-branch'){
  const name=branch(b.branchName),previous=optional(cwd,'symbolic-ref','--quiet','--short','HEAD')||'HEAD';if(optional(cwd,'show-ref','--verify','--hash','refs/heads/'+name))bad('GIT_BRANCH_EXISTS','Branch already exists.');let base='HEAD';if(b.baseBranch!==undefined){base=b.baseBranch==='HEAD'?'HEAD':branch(b.baseBranch);if(!optional(cwd,'rev-parse','--verify',base+'^{commit}'))bad('GIT_BASE_MISSING','Base branch does not exist.');}let stashed=false;if(b.stashChanges&&entries(cwd).length){git(cwd,'stash','push',...(b.includeUntracked===false?[]:['--include-untracked']),'-m','Automaker checkout '+name);stashed=true;}try{git(cwd,'checkout','-b',name,base);}catch(error){if(stashed)optional(cwd,'stash','pop');throw error;}let conflicts=[];if(stashed){try{git(cwd,'stash','pop');}catch(error){conflicts=entries(cwd).filter(x=>x.isConflicted).map(x=>x.path);if(!conflicts.length)throw error;}}result={result:{previousBranch:previous,newBranch:name,message:conflicts.length?'Created branch with conflicts while reapplying local changes':"Created and checked out branch '"+name+"'",hasConflicts:conflicts.length>0,stashedChanges:stashed,conflictFiles:conflicts}};
 }
 else if(p.action==='switch-branch'){
  const requested=branch(b.branchName),previous=optional(cwd,'symbolic-ref','--quiet','--short','HEAD')||'HEAD';let target=requested,args;if(optional(cwd,'show-ref','--verify','--hash','refs/heads/'+requested))args=['checkout',requested];else if(optional(cwd,'show-ref','--verify','--hash','refs/remotes/'+requested)){target=requested.slice(requested.indexOf('/')+1);branch(target);args=optional(cwd,'show-ref','--verify','--hash','refs/heads/'+target)?['checkout',target]:['checkout','-b',target,'--track',requested];}else bad('GIT_BRANCH_MISSING','Branch does not exist in cached local or remote refs.');if(previous===target)result={result:{previousBranch:previous,currentBranch:target,message:"Already on branch '"+target+"'"}};else{let stashed=false;if(entries(cwd).length){git(cwd,'stash','push','--include-untracked','-m','Automaker branch switch');stashed=true;}try{git(cwd,...args);}catch(error){if(stashed)optional(cwd,'stash','pop');throw error;}let conflicts=[];if(stashed){try{git(cwd,'stash','pop');}catch(error){conflicts=entries(cwd).filter(x=>x.isConflicted).map(x=>x.path);if(!conflicts.length)throw error;}}result={result:{previousBranch:previous,currentBranch:target,message:conflicts.length?'Switched branch with conflicts while reapplying local changes':"Switched to branch '"+target+"'",hasConflicts:conflicts.length>0,stashedChanges:stashed,conflictFiles:conflicts}};}
 }
 else if(p.action==='discard-changes'){
  const before=entries(cwd),current=optional(cwd,'symbolic-ref','--quiet','--short','HEAD')||'HEAD';if(!before.length)result={result:{discarded:false,message:'No changes to discard'}};else{if(b.files!==undefined){const names=files();if(head(cwd))optional(cwd,'reset','HEAD','--',...names);optional(cwd,'checkout','HEAD','--',...names);git(cwd,'clean','-ffd','--',...names);}else{if(head(cwd))git(cwd,'reset','--hard','HEAD');git(cwd,'clean','-ffd','--');}const remaining=entries(cwd).length,discarded=Math.max(0,before.length-remaining);result={result:{discarded:true,filesDiscarded:discarded,filesRemaining:remaining,branch:current,message:'Discarded '+discarded+(remaining?', '+remaining+' files remaining':' files')}};}
 }
 else if(p.action==='pull'){
  const name=remote(b.remote??'origin'),current=currentBranch(),requested=b.remoteBranch?branch(b.remoteBranch):current,local=entries(cwd),changed=local.map(x=>x.path);let stashed=false;if(local.length&&!b.stashIfNeeded)result={result:{branch:current,pulled:false,hasLocalChanges:true,localChangedFiles:changed,hasConflicts:false,stashed:false,stashRestored:false,message:'Local changes must be stashed or committed before pulling.'}};else{if(local.length){git(cwd,'stash','push','--include-untracked','-m','Automaker pre-pull stash');stashed=true;}git(cwd,'fetch',name,'--',requested);const before=head(cwd),source=name+'/'+requested;let mergeError;try{git(cwd,'merge','--no-edit',source);}catch(error){mergeError=error;}const conflicts=conflictFiles();if(mergeError&&!conflicts.length){if(stashed)optional(cwd,'stash','pop');throw mergeError;}let restored=false,stashConflicts=[];if(stashed&&!conflicts.length){try{git(cwd,'stash','pop');restored=true;}catch(error){stashConflicts=conflictFiles();if(!stashConflicts.length)throw error;}}const after=head(cwd),allConflicts=conflicts.length?conflicts:stashConflicts;result={result:{branch:current,pulled:!mergeError,hasLocalChanges:local.length>0,localChangedFiles:changed,hasConflicts:allConflicts.length>0,conflictSource:conflicts.length?'pull':stashConflicts.length?'stash':undefined,conflictFiles:allConflicts,stashed,stashRestored:restored,message:allConflicts.length?'Pull produced conflicts':before===after?'Already up to date':'Pulled successfully',isFastForward:!mergeError&&before!==after&&succeeds(cwd,'merge-base','--is-ancestor',before,after),isMerge:!mergeError&&before!==after&&git(cwd,'rev-list','--parents','-n','1',after).trim().split(/\s+/).length>2}};}
 }
 else if(p.action==='push'){
  const name=remote(b.remote??'origin'),current=currentBranch(),args=['push',name,current];if(b.force)args.push('--force-with-lease');let pushed=true,autoResolved=false;try{git(cwd,...args);}catch(error){if(!b.autoResolve)throw error;git(cwd,'fetch',name,'--',current);try{git(cwd,'merge','--no-edit',name+'/'+current);}catch(mergeError){const conflicts=conflictFiles();if(conflicts.length){result={result:{branch:current,pushed:false,diverged:true,autoResolved:false,hasConflicts:true,conflictFiles:conflicts,message:'Push auto-resolution produced conflicts'}};pushed=false;}else throw mergeError;}if(pushed){git(cwd,...args);autoResolved=true;}}if(!result)result={result:{branch:current,pushed:true,diverged:autoResolved,autoResolved,message:autoResolved?'Pulled divergent changes and pushed':'Pushed successfully'}};
 }
 else if(p.action==='sync'){
  const name=remote(b.remote??'origin'),current=currentBranch(),local=entries(cwd);let stashed=false;if(local.length){git(cwd,'stash','push','--include-untracked','-m','Automaker pre-sync stash');stashed=true;}git(cwd,'fetch',name,'--',current);const before=head(cwd);let mergeError;try{git(cwd,'merge','--no-edit',name+'/'+current);}catch(error){mergeError=error;}const conflicts=conflictFiles();if(mergeError&&!conflicts.length)throw mergeError;if(conflicts.length)result={result:{branch:current,pulled:false,pushed:false,hasConflicts:true,conflictFiles:conflicts,conflictSource:'pull',message:'Sync pull produced conflicts'}};else{if(stashed)git(cwd,'stash','pop');git(cwd,'push',name,current);const after=head(cwd);result={result:{branch:current,pulled:true,pushed:true,isFastForward:before===after||succeeds(cwd,'merge-base','--is-ancestor',before,after),isMerge:before!==after&&git(cwd,'rev-list','--parents','-n','1',after).trim().split(/\s+/).length>2,autoResolved:false,message:'Synchronized successfully'}};}
 }
 else if(p.action==='rebase'){
  const onto=branch(b.ontoBranch),name=b.remote?remote(b.remote):undefined,current=currentBranch();if(name)git(cwd,'fetch',name,'--quiet');try{git(cwd,'rebase',onto);result={result:{branch:current,ontoBranch:onto,message:'Rebased successfully'}};}catch(error){const conflicts=conflictFiles();if(!conflicts.length)throw error;result={result:{branch:current,ontoBranch:onto,hasConflicts:true,conflictFiles:conflicts,aborted:false,message:'Rebase has conflicts; resolve and continue or abort.'}};}
 }
 else if(p.action==='cherry-pick'){
  if(!Array.isArray(b.commitHashes)||!b.commitHashes.length||b.commitHashes.length>100)bad('GIT_COMMIT_INVALID','Select between 1 and 100 commits.');if(operation())bad('GIT_OPERATION_IN_PROGRESS','Resolve the in-progress Git operation before cherry-picking.');const hashes=b.commitHashes.map(commit),current=currentBranch(),args=['cherry-pick',...(b.options?.noCommit?['--no-commit']:[]),...hashes];try{git(cwd,...args);result={result:{cherryPicked:!b.options?.noCommit,commitHashes:b.commitHashes,branch:current,hasConflicts:false,message:b.options?.noCommit?'Staged changes from '+hashes.length+' commit(s); no commit created due to --no-commit':'Successfully cherry-picked '+hashes.length+' commit(s)'}};}catch(error){const conflicts=conflictFiles();if(!conflicts.length)throw error;let aborted=false;try{git(cwd,'cherry-pick','--abort');aborted=true;}catch{}result={result:{cherryPicked:false,commitHashes:b.commitHashes,branch:current,hasConflicts:true,conflictFiles:conflicts,aborted,message:aborted?'Cherry-pick aborted due to conflicts; no changes were applied.':'Cherry-pick conflicted and abort failed; inspect the target before retrying.'}};}
 }
 else if(p.action==='merge'){
  if(cwd!==root||p.pinned)bad('GIT_PROJECT_ROOT_REQUIRED','Merge must run from the selected target project root.');if(operation())bad('GIT_OPERATION_IN_PROGRESS','Resolve the in-progress Git operation before merging.');const source=branch(b.branchName),target=branch(b.targetBranch??'main'),current=currentBranch();if(current!==target)bad('GIT_TARGET_BRANCH_NOT_CHECKED_OUT','The target project root must have branch '+target+' checked out before merge.');if(!optional(root,'show-ref','--verify','--hash','refs/heads/'+source))bad('GIT_BRANCH_MISSING','Source branch does not exist on the selected target.');if(!optional(root,'show-ref','--verify','--hash','refs/heads/'+target))bad('GIT_BRANCH_MISSING','Target branch does not exist on the selected target.');const sourceWorktree=worktrees().find(x=>x.branch===source);if(!sourceWorktree||sourceWorktree.path!==path.posix.normalize(b.worktreePath))bad('GIT_WORKSPACE_CHANGED','Source branch no longer belongs to the requested target worktree.');if(b.options?.remote){const name=remote(b.options.remote);try{git(root,'fetch',name,'--quiet');}catch{}}const message=b.options?.message??'Merge '+source+' into '+target,args=b.options?.squash?['merge','--squash',source]:['merge','--no-edit','-m',message,source];try{git(root,...args);}catch(error){const conflicts=conflictFiles();if(!conflicts.length)throw error;result={result:{mergedBranch:source,targetBranch:target,hasConflicts:true,conflictFiles:conflicts,message:'Merge has conflicts; resolve and continue or abort.'}};}if(!result){if(b.options?.squash)git(root,'commit','-m',message);let deleted;if(b.options?.deleteWorktreeAndBranch){let worktreeDeleted=false,branchDeleted=false;try{git(root,'worktree','remove','--force','--',sourceWorktree.runtimePath);worktreeDeleted=true;}catch{}if(worktreeDeleted&&source!=='main'&&source!=='master'){try{git(root,'branch','-D','--',source);branchDeleted=true;}catch{}}deleted={worktreeDeleted,branchDeleted};}result={result:{mergedBranch:source,targetBranch:target,hasConflicts:false,deleted,message:'Merge completed successfully',deletedBindingId:b.sourceBindingId}};}
 }
 else if(p.action==='create'){
  if(cwd!==root||p.pinned)bad('GIT_PINNED_WORKSPACE','Create worktrees only from the project root.');
  const name=branch(b.branchName),requestedBase=b.baseBranch??'HEAD',base=requestedBase==='HEAD'?'HEAD':requestedBase,localBase=base==='HEAD'?undefined:optional(root,'show-ref','--verify','--hash','refs/heads/'+branch(base)),remoteBase=base==='HEAD'?undefined:optional(root,'show-ref','--verify','--hash','refs/remotes/'+base),baseRef=base==='HEAD'?'HEAD':localBase?'refs/heads/'+base:remoteBase?'refs/remotes/'+base:bad('GIT_BASE_MISSING','Base branch does not exist in cached target refs.');
  try{git(root,'fetch','--all','--quiet');}catch{}
  const oid=git(root,'rev-parse','--verify',baseRef+'^{commit}').trim(),dir=path.join(root,'.worktrees','ui-'+createHash('sha256').update(name).digest('hex').slice(0,24));
  const registered=worktrees().find(x=>x.branch===name);if(registered)result={worktree:{path:registered.path,branch:name,isNew:false,baseCommitHash:git(registered.runtimePath,'rev-parse','HEAD').trim()}};
  else{
   if(fs.existsSync(dir))bad('GIT_BRANCH_EXISTS','Worktree path already exists; no deletion or overwrite was performed.');
   fs.mkdirSync(path.dirname(dir),{recursive:true});if(fs.realpathSync(path.dirname(dir))!==path.dirname(dir))bad('GIT_WORKSPACE_CHANGED','Worktree parent must not be a symlink.');
   const branchExists=!!optional(root,'show-ref','--verify','--hash','refs/heads/'+name);git(root,'worktree','add',...(branchExists?[]:['-b',name]),'--',dir,branchExists?name:oid);const copyResults=[];for(const raw of Array.isArray(b.copyFiles)?b.copyFiles.slice(0,1000):[]){let name;try{name=copyFile(raw);const source=path.join(root,name),destination=path.join(dir,name);if(!fs.existsSync(source)){copyResults.push({path:name,status:'skipped',reason:'File not found in project root'});continue;}const stat=fs.statSync(source);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.cpSync(source,destination,{recursive:stat.isDirectory(),force:true});copyResults.push({path:name,status:'copied',type:stat.isDirectory()?'directory':'file'});}catch(error){copyResults.push({path:String(raw),status:'failed',error:error.message});}}result={worktree:{path:alias(dir),branch:name,isNew:!branchExists,baseCommitHash:oid},copyResults};
  }
 }
 else if(p.action==='delete'){
  if(cwd!==root||p.pinned)bad('GIT_PROJECT_ROOT_REQUIRED','Delete must run from the selected target project root.');const requested=path.posix.normalize(b.worktreePath),entry=worktrees().find(item=>item.path===requested);if(!entry)bad('GIT_WORKSPACE_MISSING','Requested worktree is not registered on the selected target.');if(entry.isMain||entry.runtimePath===root)bad('GIT_MAIN_WORKTREE','The main project worktree cannot be deleted.');git(root,'worktree','remove','--force','--',entry.runtimePath);let branchDeleted=false;if(b.deleteBranch&&entry.branch!=='main'&&entry.branch!=='master'){try{git(root,'branch','-D','--',branch(entry.branch));branchDeleted=true;}catch{}}result={deleted:{worktreePath:entry.path,branch:branchDeleted?entry.branch:null,branchName:entry.branch,branchDeleted,worktreeDeleted:true,deletedBindingId:b.sourceBindingId}};
 }
 else bad('GIT_OPERATION_UNSUPPORTED','Operation not migrated.');
 const response={success:true,...result,resolvedCwd:cwd};const output=JSON.stringify(response);
 if(Buffer.byteLength(output)>3500000)bad('GIT_OUTPUT_LIMIT','Git response exceeds its display budget. Inspect the target before retrying mutations.');
 process.stdout.write(output);
}catch(error){process.stdout.write(JSON.stringify({success:false,code:typeof error.code==='string'?error.code:'GIT_TARGET_FAILED',error:error.code?error.message:'Target Git operation failed. Inspect the working tree/index on target; no controller fallback or retry was performed.'}));process.exitCode=1;}
`;
