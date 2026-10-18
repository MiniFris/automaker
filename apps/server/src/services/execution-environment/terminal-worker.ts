/** Linux target PTY supervisor. Python's standard library only; no project modules. */
export const TERMINAL_WORKER = String.raw`
import os,sys,json,base64,pty,fcntl,termios,struct,select,time,signal,errno,ctypes
p=json.loads(sys.argv[1])
pid=None
master=None
marker=None
stopped=False
cleaned=False
child_status=None
def emit_final(data):
    os.set_blocking(1,False)
    deadline=time.monotonic()+2
    while data and time.monotonic()<deadline:
        if select.select([],[1],[],0.1)[1]:
            try: count=os.write(1,data);del data[:count]
            except BlockingIOError: pass
def stop(*args):
    global stopped
    stopped=True
def info(pid):
    with open('/proc/'+str(pid)+'/stat') as f: raw=f.read()
    return raw[raw.rfind(')')+2:].split()
def cleanup():
    global cleaned,child_status
    if cleaned: return
    if not pid: return
    # All foreground/background job groups belonging to this PTY session, not just bash.
    # Deliberate setsid/daemonization is outside terminal lifetime management.
    for _ in range(3):
        for entry in os.listdir('/proc'):
            if not entry.isdigit(): continue
            try:
                stat=info(int(entry))
                if int(stat[3])==pid and stat[0]!='Z':
                    if info(int(entry))[19]==stat[19]: os.kill(int(entry),signal.SIGKILL)
            except (ProcessLookupError,FileNotFoundError,PermissionError): pass
        time.sleep(0.02)
    try: _child,child_status=os.waitpid(pid,0)
    except ChildProcessError: pass
    # Reap adopted jobs too: container PID 1 is not necessarily a child subreaper.
    reap_deadline=time.monotonic()+1
    while time.monotonic()<reap_deadline:
        try:
            child,_status=os.waitpid(-1,os.WNOHANG)
            if not child: time.sleep(0.01)
        except ChildProcessError: break
    cleaned=True
def size(cols,rows):
    if type(cols)!=int or type(rows)!=int or not 1<=cols<=1000 or not 1<=rows<=500: raise ValueError('Invalid terminal dimensions')
    fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',rows,cols,0,0))
try:
    if sys.platform!='linux': raise RuntimeError('Managed terminal requires Linux and Python 3 on target')
    libc=ctypes.CDLL(None,use_errno=True)
    libc.prctl.argtypes=[ctypes.c_int]+[ctypes.c_ulong]*4
    # PR_SET_CHILD_SUBREAPER: adopted PTY jobs are reaped here, not left to container PID 1.
    if libc.prctl(36,1,0,0,0)!=0: raise RuntimeError('Cannot enable PTY child subreaper')
    if os.path.realpath(p['cwd'])!=p['cwd']: raise RuntimeError('Target working directory changed')
    os.chdir(p['cwd'])
    shell=p.get('shell') or ('/bin/bash' if os.path.isfile('/bin/bash') else '/bin/sh')
    if shell not in ['/bin/bash','/bin/sh']: raise ValueError('Managed terminal supports /bin/bash or /bin/sh')
    if not os.access(shell,os.X_OK): raise RuntimeError('Selected target shell is unavailable')
    command=p.get('command')
    if command is not None and (not isinstance(command,str) or not command or len(command)>32768 or '\x00' in command): raise ValueError('Invalid supervised command')
    for sig in [signal.SIGTERM,signal.SIGHUP,signal.SIGINT]: signal.signal(sig,stop)
    if p.get('jobs'):
        os.makedirs(p['jobs'],mode=0o700,exist_ok=True)
        marker=os.path.join(p['jobs'],p['id']+'.running')
        with open(marker,'x') as f: json.dump({'pid':os.getpid()},f)
        if os.path.exists(p['jobs']+'-stopping'): raise RuntimeError('Container is stopping; inspect before creating a terminal')
    pid,master=pty.fork()
    if pid==0:
        for sig in [signal.SIGTERM,signal.SIGHUP,signal.SIGINT]: signal.signal(sig,signal.SIG_DFL)
        env=dict(os.environ,TERM='xterm-256color',COLORTERM='truecolor',TERM_PROGRAM='automaker-terminal')
        if command is not None:
            env.update(FORCE_COLOR='1')
            if p.get('kind')=='dev':
                if type(p.get('port'))!=int or not 1024<=p['port']<=65535: raise ValueError('Invalid dev port')
                env.update(PORT=str(p['port']),HOST='127.0.0.1',BROWSER='none')
            else: env.update(CI='true')
        os.execve(shell,[shell,'-c',command] if command is not None else [shell,'-i'],env)
    size(p['cols'],p['rows'])
    os.set_blocking(master,False)
    os.set_blocking(0,False)
    os.set_blocking(1,False)
    # Outgoing protocol is bounded even if the controller/network stops draining.
    pending=bytearray((json.dumps({'type':'ready','shell':shell,'cwd':os.getcwd(),'pid':pid})+'\n').encode())
    incoming=bytearray()
    inputs=bytearray()
    last=time.monotonic()
    exitcode=-signal.SIGKILL
    master_eof=False
    while not stopped:
        if time.monotonic()-last>15: raise RuntimeError('Terminal heartbeat expired; closing target session')
        readable,writable,_=select.select([0]+([] if master_eof else [master]),([1] if pending else [])+([master] if inputs and not master_eof else []),[],0.2)
        if 0 in readable:
            data=os.read(0,65536)
            if not data: break
            incoming.extend(data)
            if len(incoming)>1500000: raise RuntimeError('Terminal input buffer exceeded')
            while b'\n' in incoming:
                line,_,rest=incoming.partition(b'\n');incoming=bytearray(rest)
                request=json.loads(line)
                last=time.monotonic()
                if request['type']=='input':
                    inputs.extend(base64.b64decode(request['data'],validate=True))
                    if len(inputs)>1048576: raise RuntimeError('Terminal input queue exceeded')
                elif request['type']=='resize': size(request['cols'],request['rows'])
                elif request['type']=='close': stopped=True
                elif request['type']!='ping': raise RuntimeError('Invalid terminal frame')
        if master in writable and inputs:
            try: count=os.write(master,inputs);del inputs[:count]
            except BlockingIOError: pass
        if master in readable:
            try: data=os.read(master,16384)
            except OSError as error:
                if error.errno!=errno.EIO: raise
                data=b''
            if not data:
                # EOF is not an exit status: a valid command can close/redirect all TTY fds
                # and keep working. Keep the heartbeat/Stop channel and child monitor alive.
                master_eof=True
                inputs.clear()
            else:
                pending.extend((json.dumps({'type':'data','data':base64.b64encode(data).decode()})+'\n').encode())
                if len(pending)>1048576: raise RuntimeError('Terminal output queue exceeded')
        if 1 in writable and pending:
            try: count=os.write(1,pending);del pending[:count]
            except BlockingIOError: pass
        result=os.waitid(os.P_PID,pid,os.WEXITED|os.WNOHANG|os.WNOWAIT)
        if result:
            exitcode=result.si_status if result.si_code==os.CLD_EXITED else -result.si_status
            if master_eof or master not in readable: break
    result=os.waitid(os.P_PID,pid,os.WEXITED|os.WNOHANG|os.WNOWAIT)
    if result: exitcode=result.si_status if result.si_code==os.CLD_EXITED else -result.si_status
    cleanup()
    if child_status is not None:
        exitcode=os.WEXITSTATUS(child_status) if os.WIFEXITED(child_status) else -os.WTERMSIG(child_status)
    pending.extend((json.dumps({'type':'exit','exitCode':exitcode})+'\n').encode())
    emit_final(pending)
except BaseException as error:
    cleanup()
    try:
        emit_final(bytearray((json.dumps({'type':'failure','message':str(error)})+'\n').encode()))
    except (BrokenPipeError,OSError): pass
finally:
    if master is not None: os.close(master)
    if marker:
        try:
            with open(marker[:-8]+'.done','x') as f: json.dump({'terminal':True},f)
        except FileExistsError: pass
        try: os.unlink(marker)
        except FileNotFoundError: pass
`;
