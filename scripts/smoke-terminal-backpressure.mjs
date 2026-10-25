#!/usr/bin/env node
// Finite Linux acceptance on an owned production backend, PTYs and loopback TCP peers.
// Run after build:server: node scripts/smoke-terminal-backpressure.mjs (requires python3).
// Terminal delivery intentionally retains a bounded, lossy tail. Produced and received
// byte counts are separate measurements; this probe does not require full stdout replay.
// FD/RSS/TCP queue values come from /proc, not logical application buffer counters.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import { assertProductionServerArtifact } from '../apps/server/scripts/check-build.mjs';

assert.equal(process.platform, 'linux', 'Linux /proc acceptance only');
const repository = path.resolve(import.meta.dirname, '..');
await assertProductionServerArtifact(path.join(repository, 'apps/server/dist'));
const WebSocket = createRequire(new URL('../apps/server/package.json', import.meta.url))('ws');
const root = await mkdtemp(path.join(os.tmpdir(), 'terminal-backpressure-'));
const project = path.join(root, 'project');
await mkdir(project);
const reservation = createServer().listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const key = randomUUID(),
  base = `http://127.0.0.1:${port}`;
const backend = spawn(process.execPath, ['apps/server/dist/main.js'], {
  cwd: repository,
  env: {
    PATH: '/usr/bin:/bin',
    HOME: path.join(root, 'home'),
    USERPROFILE: path.join(root, 'home'),
    XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_CACHE_HOME: path.join(root, 'cache'),
    APPDATA: path.join(root, 'config'),
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: path.join(root, 'data'),
    ALLOWED_ROOT_DIRECTORY: root,
    AUTOMAKER_API_KEY: key,
    AUTOMAKER_HIDE_API_KEY: 'true',
    ENABLE_REQUEST_LOGGING: 'false',
    LOG_LEVEL: 'error',
    SHELL: '/bin/sh',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let diagnostics = '';
for (const stream of [backend.stdout, backend.stderr])
  stream.on('data', (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-16000);
  });
const backendExit = once(backend, 'exit');
backendExit.catch(() => {});
const sockets = new Set(),
  observed = new Map();
let slow, slowExit, slowIdentity;
async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function until(check, ms, label) {
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`${label} did not settle`);
}
async function identity(pid) {
  try {
    const raw = await readFile(`/proc/${pid}/stat`, 'utf8'),
      fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
    return { pid, state: fields[0], group: Number(fields[2]), start: fields[19] };
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
}
async function live(record) {
  const now = await identity(record.pid);
  return now && now.start === record.start && !['Z', 'X', 'x'].includes(now.state);
}
async function children(pid) {
  // PTYs may be forked by a native worker thread, not the thread-group leader.
  const tasks = await readdir(`/proc/${pid}/task`).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const contents = await Promise.all(
    tasks.map((task) =>
      readFile(`/proc/${pid}/task/${task}/children`, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return '';
        throw error;
      })
    )
  );
  const childIds = new Set(
    contents.flatMap((content) => content.trim().split(/\s+/).filter(Boolean).map(Number))
  );
  const result = [];
  for (const id of childIds) {
    const record = await identity(id);
    if (!record) continue;
    observed.set(`${id}:${record.start}`, record);
    if (!['Z', 'X', 'x'].includes(record.state)) result.push(record);
    result.push(...(await children(id)));
  }
  return result;
}
async function sample() {
  const status = await readFile(`/proc/${backend.pid}/status`, 'utf8');
  return {
    fd: (await readdir(`/proc/${backend.pid}/fd`)).length,
    children: (await children(backend.pid)).length,
    rssBytes: Number(status.match(/^VmRSS:\s+(\d+) kB$/m)?.[1] ?? 0) * 1024,
  };
}
async function request(route, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${base}/api/${route}`, {
    method,
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  const value = await response.json();
  assert.equal(response.status, 200, `${route}: ${JSON.stringify(value)}`);
  assert.notEqual(value.success, false);
  return value;
}
function terminalSocket(id) {
  const ws = new WebSocket(
    `${base.replace('http:', 'ws:')}/api/terminal/ws?apiKey=${key}&sessionId=${id}`
  );
  sockets.add(ws);
  let tail = '',
    bytes = 0,
    packets = 0,
    maxPacket = 0,
    pongCount = 0;
  const connected = new Promise((resolve, reject) => {
    ws.once('error', reject);
    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'connected') resolve();
        if (['data', 'scrollback'].includes(message.type)) {
          bytes += Buffer.byteLength(message.data);
          packets++;
          maxPacket = Math.max(maxPacket, raw.length);
          tail = (tail + message.data).slice(-131072);
        }
        if (message.type === 'pong') pongCount++;
      } catch (error) {
        reject(error);
      }
    });
  });
  return {
    ws,
    connected,
    get tail() {
      return tail;
    },
    get bytes() {
      return bytes;
    },
    get packets() {
      return packets;
    },
    get maxPacket() {
      return maxPacket;
    },
    get pongCount() {
      return pongCount;
    },
  };
}
async function closeSocket(ws) {
  if (ws.readyState === WebSocket.CLOSED) return;
  const closed = once(ws, 'close');
  ws.close();
  await bounded(closed, 5000, 'viewer close');
  sockets.delete(ws);
}
async function txQueue(remotePort) {
  for (const row of (await readFile('/proc/net/tcp', 'utf8')).trim().split('\n').slice(1)) {
    const columns = row.trim().split(/\s+/);
    if (
      parseInt(columns[1].split(':')[1], 16) === port &&
      parseInt(columns[2].split(':')[1], 16) === remotePort
    )
      return parseInt(columns[4].split(':')[0], 16);
  }
  return 0;
}
const writer = path.join(root, 'writer.mjs');
await writeFile(
  writer,
  `import {writeFileSync} from 'node:fs';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
const [nonce,report,duration]=process.argv.slice(2), start=performance.now();
let bytes=0, chunks=0, drains=0;
while(performance.now()-start<Number(duration)) {
 const output='CHUNK_'+chunks+'_'+nonce+'\\n'+'x'.repeat(65500)+'\\n';
 bytes+=Buffer.byteLength(output);chunks++;
 if(!process.stdout.write(output)){drains++;await once(process.stdout,'drain');}
 if(chunks%10===0)writeFileSync(report,JSON.stringify({pid:process.pid,bytes,chunks,drains,elapsedMs:performance.now()-start}));
 await delay(10);
}
process.stdout.write('\\nTAIL_'+nonce+'\\n');
writeFileSync(report,JSON.stringify({pid:process.pid,bytes,chunks,drains,elapsedMs:performance.now()-start,done:true}));
setInterval(()=>{},1000);
`
);
const slowScript = path.join(root, 'slow.py');
await writeFile(
  slowScript,
  `import socket,sys,json,base64,os,struct
host,port,key,session=sys.argv[1:]
s=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,4096)
s.setsockopt(socket.IPPROTO_TCP,socket.TCP_MAXSEG,1024)
s.connect((host,int(port)))
nonce=base64.b64encode(os.urandom(16)).decode()
s.sendall(('GET /api/terminal/ws?apiKey='+key+'&sessionId='+session+' HTTP/1.1\\r\\nHost: '+host+':'+port+'\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: '+nonce+'\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n').encode())
headers=b''
while not headers.endswith(b'\\r\\n\\r\\n'):headers+=s.recv(1)
assert headers.startswith(b'HTTP/1.1 101 '),headers
print(json.dumps({'event':'paused','port':s.getsockname()[1],'receiveBuffer':s.getsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF),'mss':s.getsockopt(socket.IPPROTO_TCP,socket.TCP_MAXSEG)}),flush=True)
assert sys.stdin.readline().strip()=='drain'
s.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,1048576)
s.settimeout(5)
def read(n):
 data=b''
 while len(data)<n:
  block=s.recv(n-len(data))
  if not block:raise EOFError('Socket ended without close frame')
  data+=block
 return data
count=0
while True:
 a,b=read(2);size=b&127
 if size==126:size=struct.unpack('!H',read(2))[0]
 elif size==127:size=struct.unpack('!Q',read(8))[0]
 assert not b&128
 data=read(size);count+=size
 if a&15==8:
  code=struct.unpack('!H',data[:2])[0] if len(data)>=2 else 1005
  mask=os.urandom(4);payload=data[:125]
  s.sendall(bytes([136,128+len(payload)])+mask+bytes(x^mask[i%4] for i,x in enumerate(payload)))
  print(json.dumps({'event':'closed','code':code,'receivedBytes':count}),flush=True);break
s.close()
`
);
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
async function launchWriter(duration) {
  const session = (
    await request('terminal/sessions', { cwd: project, shell: '/bin/sh', cols: 80, rows: 24 })
  ).data;
  const viewer = terminalSocket(session.id);
  await bounded(viewer.connected, 5000, 'terminal connected');
  const nonce = randomUUID().replaceAll('-', ''),
    report = path.join(root, nonce + '.json');
  const launch = () =>
    viewer.ws.send(
      JSON.stringify({
        type: 'input',
        data: `exec ${quote(process.execPath)} ${quote(writer)} ${quote(nonce)} ${quote(report)} ${duration}\n`,
      })
    );
  return { session, viewer, nonce, report, launch };
}
let summary;
try {
  await until(
    async () => {
      assert.equal(backend.exitCode, null, diagnostics);
      try {
        return (await fetch(`${base}/api/health/ready`, { signal: AbortSignal.timeout(1000) })).ok;
      } catch {
        return false;
      }
    },
    30000,
    'backend startup'
  );
  // Warm PTY/native modules and idle HTTP pools before the descriptor baseline.
  const warm = await launchWriter(0);
  warm.launch();
  await until(() => warm.viewer.tail.includes('TAIL_' + warm.nonce), 5000, 'warm-up marker');
  await children(backend.pid);
  await request(`terminal/sessions/${warm.session.id}`, undefined, 'DELETE');
  await closeSocket(warm.viewer.ws);
  await until(
    async () => (await children(backend.pid)).length === 0,
    5000,
    'warm-up child cleanup'
  );
  const baseline = await sample();
  const f = await launchWriter(20000);
  slow = spawn('/usr/bin/python3', [slowScript, '127.0.0.1', String(port), key, f.session.id], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin', HOME: root },
  });
  slowIdentity = await identity(slow.pid);
  slowExit = once(slow, 'exit');
  slowExit.catch(() => {});
  let slowDiagnostics = '',
    slowLines = '';
  slow.stderr.on('data', (chunk) => {
    slowDiagnostics = (slowDiagnostics + chunk).slice(-4000);
  });
  const slowEvents = [];
  slow.stdout.on('data', (chunk) => {
    slowLines += chunk;
    const lines = slowLines.split('\n');
    slowLines = lines.pop();
    for (const line of lines) if (line) slowEvents.push(JSON.parse(line));
  });
  await until(
    () => {
      assert.equal(slow.exitCode, null, slowDiagnostics);
      return slowEvents.some((event) => event.event === 'paused');
    },
    5000,
    'slow peer handshake'
  );
  const paused = slowEvents.find((event) => event.event === 'paused');
  f.launch();
  const samples = [];
  let maxTxQueue = 0,
    pongs = 0;
  const started = performance.now();
  while (performance.now() - started < 23000) {
    const before = f.viewer.pongCount,
      pingAt = performance.now();
    f.viewer.ws.send(JSON.stringify({ type: 'ping' }));
    await until(() => f.viewer.pongCount > before, 1000, 'healthy terminal pong');
    pongs++;
    const measured = await sample();
    measured.elapsedMs = performance.now() - started;
    measured.slowTcpTxBytes = await txQueue(paused.port);
    measured.pongMs = performance.now() - pingAt;
    maxTxQueue = Math.max(maxTxQueue, measured.slowTcpTxBytes);
    samples.push(measured);
    const report = await readFile(f.report, 'utf8')
      .then(JSON.parse)
      .catch((error) => {
        if (error.code === 'ENOENT') return {};
        throw error;
      });
    if (
      report.done &&
      f.viewer.tail
        .replaceAll('\r', '')
        .split('\n')
        .includes('TAIL_' + f.nonce)
    )
      break;
    await delay(250);
  }
  const produced = JSON.parse(await readFile(f.report, 'utf8'));
  assert.equal(produced.done, true);
  assert.ok(produced.elapsedMs >= 20000);
  assert.ok(produced.bytes >= 32 * 1024 * 1024, `Only ${produced.bytes} PTY bytes produced`);
  assert.ok(f.viewer.bytes >= 512 * 1024, `Only ${f.viewer.bytes} live bytes delivered`);
  assert.ok(
    f.viewer.tail
      .replaceAll('\r', '')
      .split('\n')
      .includes('TAIL_' + f.nonce),
    'Real final tail missing'
  );
  assert.equal(f.viewer.ws.readyState, WebSocket.OPEN, 'Healthy viewer disconnected');
  assert.ok(maxTxQueue > 0, 'No actual kernel TCP queue pressure observed');
  assert.ok(observed.size >= 2, 'Missing warm-up/live descendant identities');
  const producerIdentity = await identity(produced.pid);
  assert.ok(producerIdentity && producerIdentity.group === produced.pid);
  assert.ok(
    [...observed.values()].some(
      (record) => record.pid === produced.pid && record.start === producerIdentity.start
    )
  );
  const replay = terminalSocket(f.session.id);
  await bounded(replay.connected, 5000, 'replay viewer');
  await until(() => replay.tail.includes('TAIL_' + f.nonce), 5000, 'bounded replay tail');
  assert.ok(replay.tail.length <= 50000, `Replay exceeded 50000 chars: ${replay.tail.length}`);
  await closeSocket(replay.ws);
  // Resume the real TCP reader only after measuring the sustained paused interval.
  slow.stdin.end('drain\n');
  await until(
    () => {
      assert.ok(slow.exitCode === null || slow.exitCode === 0, slowDiagnostics);
      return slowEvents.some((event) => event.event === 'closed');
    },
    5000,
    'slow pressure close'
  );
  const slowClosed = slowEvents.find((event) => event.event === 'closed');
  assert.equal(
    slowClosed.code,
    4008,
    `Actual slow peer did not reach transport pressure guard: ${JSON.stringify(slowClosed)}`
  );
  await bounded(slowExit, 5000, 'slow peer exit');
  assert.equal(slow.exitCode, 0);
  await request(`terminal/sessions/${f.session.id}`, undefined, 'DELETE');
  await closeSocket(f.viewer.ws);
  await until(
    async () => (await children(backend.pid)).length === 0,
    5000,
    'settled PTY descendants'
  );
  const settled = await sample();
  assert.ok(
    settled.fd <= baseline.fd + 8,
    `Descriptor growth: ${JSON.stringify({ baseline, settled })}`
  );
  // Shutdown also owns a live PTY and a reader that ignores close frames.
  const active = await launchWriter(0);
  active.launch();
  await until(
    () => active.viewer.tail.includes('TAIL_' + active.nonce),
    5000,
    'active shutdown PTY'
  );
  const stalled = terminalSocket(active.session.id);
  await bounded(stalled.connected, 5000, 'shutdown viewer');
  stalled.ws.pause();
  await children(backend.pid);
  const shutdownAt = performance.now();
  backend.kill('SIGTERM');
  await bounded(backendExit, 5000, 'SIGTERM with active PTY and paused reader');
  const shutdownMs = performance.now() - shutdownAt;
  assert.equal(backend.exitCode, 0, diagnostics);
  for (const record of observed.values())
    assert.equal(
      Boolean(await live(record)),
      false,
      `Surviving owned child ${record.pid}:${record.start}`
    );
  assert.equal(Boolean(await live(slowIdentity)), false, 'Slow peer survived');
  summary = {
    durationMs: performance.now() - started,
    produced,
    delivered: {
      bytes: f.viewer.bytes,
      packets: f.viewer.packets,
      maxEncodedPacketBytes: f.viewer.maxPacket,
      replayChars: replay.tail.length,
      healthyPongs: pongs,
    },
    slow: {
      receiveBufferBytes: paused.receiveBuffer,
      negotiatedMss: paused.mss,
      closeCode: slowClosed.code,
      drainedBytes: slowClosed.receivedBytes,
      maxKernelTxQueueBytes: maxTxQueue,
    },
    resources: {
      baseline,
      settled,
      peakFd: Math.max(...samples.map((s) => s.fd)),
      peakRssBytes: Math.max(...samples.map((s) => s.rssBytes)),
      observedOwnedDescendants: observed.size,
      survivingOwnedDescendants: 0,
    },
    shutdownMs,
    backendExitCode: backend.exitCode,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
} catch (error) {
  throw new Error(`${error.message}\nBackend: ${diagnostics}`, { cause: error });
} finally {
  for (const ws of sockets) {
    ws.resume();
    ws.terminate();
  }
  if (slowIdentity && (await live(slowIdentity))) slow.kill('SIGKILL');
  if (backend.exitCode === null && backend.signalCode === null) {
    backend.kill('SIGTERM');
    await bounded(backendExit, 5000, 'failure shutdown').catch(() => backend.kill('SIGKILL'));
    await backendExit.catch(() => {});
  }
  for (const record of observed.values())
    if (await live(record)) {
      const now = await identity(record.pid);
      if (now.group === record.pid)
        try {
          process.kill(-record.pid, 'SIGKILL');
        } catch {}
    }
  await slowExit?.catch(() => {});
  await rm(root, { recursive: true, force: true });
}
