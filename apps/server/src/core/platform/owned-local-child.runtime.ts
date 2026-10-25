import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import {
  linuxProcessSession,
  parseLinuxProcessStat,
  waitForLinuxProcessGroupExit,
} from './linux-process-group.js';

export interface OwnedLocalChildTarget {
  /** Refresh continuity anchors only while the original leader is still verifiable. */
  prepare(signal?: AbortSignal): Promise<void>;
  /** Revalidate synchronously immediately before each signal. */
  signal(signal: 'SIGTERM' | 'SIGKILL'): void;
  waitForQuiescence(signal: AbortSignal): Promise<void>;
}
export interface OwnedLocalChildRuntime {
  /** Called synchronously immediately after spawn, never with a PID from discovery. */
  capture(child: ChildProcess): OwnedLocalChildTarget;
}

interface Generation {
  pid: number;
  parent: number;
  group: number;
  session: number;
  start: string;
  state: string;
}
function generation(pid: number, content: string): Generation {
  const parsed = parseLinuxProcessStat(content);
  const fields = content
    .slice(content.lastIndexOf(')') + 1)
    .trim()
    .split(/\s+/);
  if (
    Number(content.slice(0, content.indexOf(' '))) !== pid ||
    !/^\d+$/.test(fields[1] ?? '') ||
    !/^\d+$/.test(fields[19] ?? '')
  )
    throw new Error('Owned child identity is unavailable.');
  return {
    pid,
    parent: Number(fields[1]),
    group: parsed.group,
    session: linuxProcessSession(content),
    start: fields[19]!,
    state: parsed.state,
  };
}
const absent = (error: unknown) =>
  ['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '');

/** Linux authority originates at spawn; procfs scans can only extend that verified continuity. */
class LinuxOwnedTarget implements OwnedLocalChildTarget {
  private readonly leader: Generation;
  private readonly anchors = new Map<number, Generation>();
  private unsafe = false;
  constructor(child: ChildProcess) {
    const pid = child.pid;
    if (!Number.isSafeInteger(pid) || pid! <= 1 || pid === process.pid)
      throw new Error('Owned child identity is unavailable.');
    this.leader = generation(pid!, readFileSync(`/proc/${pid}/stat`, 'utf8'));
    if (
      this.leader.parent !== process.pid ||
      this.leader.group !== pid ||
      this.leader.session !== pid
    )
      throw new Error('Owned child must be a detached session leader.');
  }
  private current(original: Generation): Generation | undefined {
    try {
      const next = generation(original.pid, readFileSync(`/proc/${original.pid}/stat`, 'utf8'));
      if (
        next.start !== original.start ||
        next.group !== original.group ||
        next.session !== original.session
      ) {
        this.unsafe = true;
        throw new Error('Owned child generation changed.');
      }
      return next;
    } catch (error) {
      if (absent(error)) return undefined;
      throw error;
    }
  }
  async prepare(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.unsafe) throw new Error('Owned child identity is unavailable.');
    if (!this.current(this.leader)) return;
    const pids = (await fs.readdir('/proc')).filter((pid) => /^[1-9]\d*$/.test(pid));
    if (pids.length > 131_072) throw new Error('Owned child observation limit exceeded.');
    const observed: Generation[] = [];
    for (let offset = 0; offset < pids.length; offset += 32) {
      signal?.throwIfAborted();
      const batch = await Promise.all(
        pids.slice(offset, offset + 32).map(async (pid) => {
          try {
            return generation(
              Number(pid),
              await fs.readFile(`/proc/${pid}/stat`, { encoding: 'utf8', signal })
            );
          } catch (error) {
            if (absent(error)) return undefined;
            throw error;
          }
        })
      );
      for (const member of batch) {
        if (
          member &&
          member.pid !== this.leader.pid &&
          member.group === this.leader.group &&
          member.session === this.leader.session
        )
          observed.push(member);
      }
      if (observed.length > 4096) throw new Error('Owned child observation limit exceeded.');
    }
    // A disappearing/reused leader cannot authorize any newly observed member.
    signal?.throwIfAborted();
    if (!this.current(this.leader)) return;
    for (const member of observed) this.anchors.set(member.pid, member);
  }
  signal(signal: 'SIGTERM' | 'SIGKILL'): void {
    if (this.unsafe) throw new Error('Owned child identity is unavailable.');
    let authority = this.current(this.leader);
    if (!authority) {
      for (const member of this.anchors.values()) {
        const next = this.current(member);
        if (next && !['Z', 'X', 'x'].includes(next.state)) {
          authority = next;
          break;
        }
      }
    }
    if (!authority) throw new Error('Owned child continuity is unavailable.');
    // Targets only the group captured from the original spawned ChildProcess.
    try {
      process.kill(-this.leader.group, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  async waitForQuiescence(signal: AbortSignal): Promise<void> {
    if (this.unsafe) throw new Error('Owned child identity is unavailable.');
    await waitForLinuxProcessGroupExit(this.leader.group, signal);
    if (this.unsafe) throw new Error('Owned child identity is unavailable.');
  }
}

/** Other hosts keep original ChildProcess signal authority but cannot certify a process tree. */
class UnverifiedTreeTarget implements OwnedLocalChildTarget {
  constructor(private readonly child: ChildProcess) {}
  async prepare(): Promise<void> {}
  signal(signal: 'SIGTERM' | 'SIGKILL'): void {
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill(signal);
  }
  async waitForQuiescence(): Promise<void> {
    throw new Error('Process-tree quiescence is unsupported on this platform.');
  }
}
export class NodeOwnedLocalChildRuntime implements OwnedLocalChildRuntime {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}
  capture(child: ChildProcess): OwnedLocalChildTarget {
    if (!Number.isSafeInteger(child.pid) || child.pid! <= 1 || child.pid === process.pid)
      throw new Error('Owned child identity is unavailable.');
    return this.platform === 'linux'
      ? new LinuxOwnedTarget(child)
      : new UnverifiedTreeTarget(child);
  }
}
export const nodeOwnedLocalChildRuntime: OwnedLocalChildRuntime = new NodeOwnedLocalChildRuntime();
