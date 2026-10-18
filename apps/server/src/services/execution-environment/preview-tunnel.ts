import { spawn } from 'node:child_process';
import { Duplex } from 'node:stream';
import type { SettingsService } from '../settings-service.js';
import type { ProjectGitTarget } from './project-git.js';
import { DockerExecutionEnvironment } from './docker.js';
import { SSHExecutionEnvironment } from './ssh.js';
import { SSHState } from './ssh-state.js';
import { connectSSH, shellQuote } from './ssh-transport.js';
import { dockerArguments } from './docker-command.js';

/** Fixed TCP destination and verified owning Linux session. No client host/port, URL or shell. */
export const PREVIEW_RELAY = String.raw`
const fs=require('node:fs'),net=require('node:net');
const p=JSON.parse(process.argv[1]);
function owned(){
  const inodes=new Set();
  for(const file of ['/proc/net/tcp','/proc/net/tcp6']){
    try{for(const row of fs.readFileSync(file,'utf8').trim().split('\n').slice(1)){
      const cols=row.trim().split(/\s+/);
      if(cols[3]==='0A'&&parseInt(cols[1].split(':').at(-1),16)===p.port)inodes.add(cols[9]);
    }}catch{}
  }
  for(const pid of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){
    try{
      const raw=fs.readFileSync('/proc/'+pid+'/stat','utf8');
      if(Number(raw.slice(raw.lastIndexOf(')')+2).split(' ')[3])!==p.pid)continue;
      for(const fd of fs.readdirSync('/proc/'+pid+'/fd')){
        try{if(inodes.has(fs.readlinkSync('/proc/'+pid+'/fd/'+fd).replace(/^socket:\[(\d+)\]$/,'$1')))return true;}catch{}
      }
    }catch{}
  }
  return false;
}
if(!Number.isInteger(p.port)||p.port<4100||p.port>4119||!Number.isSafeInteger(p.pid)||p.pid<1||!owned())process.exit(73);
const socket=net.connect({host:'127.0.0.1',port:p.port});
socket.setTimeout(120000,()=>socket.destroy());
const timer=setTimeout(()=>socket.destroy(),5000);
socket.on('connect',()=>{clearTimeout(timer);if(!owned()){socket.destroy();return;}process.stdin.pipe(socket);socket.pipe(process.stdout);});
socket.on('error',()=>{clearTimeout(timer);process.exitCode=74;});
socket.on('close',()=>{clearTimeout(timer);process.stdin.destroy();});
process.stdin.on('end',()=>socket.destroy());
process.stdin.on('error',()=>socket.destroy());
process.stdout.on('error',()=>socket.destroy());
`;

export async function openPreviewTunnel(
  target: ProjectGitTarget,
  settings: SettingsService,
  port: number,
  pid: number
): Promise<Duplex> {
  const args = ['-e', PREVIEW_RELAY, JSON.stringify({ port, pid })];
  if (target.runtime.type === 'ssh') {
    const descriptor = (target.runtime as SSHExecutionEnvironment).binding;
    const client = await connectSSH(
      await new SSHState(settings).configuration(descriptor.profile, descriptor.fingerprint),
      AbortSignal.timeout(10000)
    );
    return new Promise((resolve, reject) => {
      client.on('error', reject);
      client.exec(['node', ...args].map(shellQuote).join(' '), (error, channel) => {
        if (error) {
          client.end();
          reject(error);
          return;
        }
        channel.stderr.resume();
        client.on('error', () => channel.destroy());
        client.on('close', () => channel.destroy());
        channel.on('error', () => {});
        channel.on('close', () => client.end());
        resolve(channel);
      });
    });
  }
  const descriptor =
    target.runtime.type === 'docker'
      ? (target.runtime as DockerExecutionEnvironment).binding
      : undefined;
  const child = descriptor
    ? spawn(
        'docker',
        dockerArguments(descriptor.context, [
          'exec',
          '-i',
          descriptor.containerId,
          'node',
          ...args,
        ]),
        { stdio: ['pipe', 'pipe', 'pipe'], shell: false }
      )
    : spawn(process.execPath, args, {
        cwd: target.runtime.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
  const stream = Duplex.from({ readable: child.stdout, writable: child.stdin });
  child.stderr.resume();
  child.on('error', (error) => stream.destroy(error));
  child.on('close', () => stream.destroy());
  stream.on('close', () => {
    child.stdin.end();
    child.kill('SIGTERM');
  });
  stream.on('error', () => {});
  return stream;
}
