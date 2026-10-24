import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

/** Read-only observations of an already-owned, detached Linux process group. */
export interface LinuxProcessGroupProbe {
  exists(group: number): boolean;
  states(group: number, signal: AbortSignal): Promise<readonly string[]>;
}

export function parseLinuxProcessStat(stat: string): { group: number; state: string } {
  // comm may contain whitespace and parentheses; fields after its LAST ')' are fixed.
  const end = stat.lastIndexOf(')');
  const fields = stat
    .slice(end + 1)
    .trim()
    .split(/\s+/);
  const group = Number(fields[2]);
  if (
    !/^[1-9]\d* \(/.test(stat) ||
    end < 0 ||
    fields[0]?.length !== 1 ||
    !/^\d+$/.test(fields[2] ?? '') ||
    !Number.isSafeInteger(group) ||
    group < 0
  )
    throw new Error('Process group observation is unavailable.');
  return { state: fields[0], group };
}

const procfsProbe: LinuxProcessGroupProbe = {
  exists(group) {
    try {
      process.kill(-group, 0); // Probe only. Never send a signal to a newly discovered PID.
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
      throw error;
    }
  },
  async states(group, signal) {
    const pids = (await fs.readdir('/proc')).filter((name) => /^[1-9]\d*$/.test(name));
    if (pids.length > 131_072) throw new Error('Process group observation limit exceeded.');
    const states: string[] = [];
    // Bound simultaneous procfs reads and check the owner's deadline between batches.
    for (let offset = 0; offset < pids.length; offset += 32) {
      signal.throwIfAborted();
      const batch = await Promise.all(
        pids.slice(offset, offset + 32).map(async (pid) => {
          try {
            return {
              pid,
              ...parseLinuxProcessStat(
                await fs.readFile(`/proc/${pid}/stat`, { encoding: 'utf8', signal })
              ),
            };
          } catch (error) {
            if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? ''))
              return undefined;
            throw error;
          }
        })
      );
      for (const member of batch) {
        if (member?.group !== group) continue;
        states.push(member.state);
        if (!['Z', 'X', 'x'].includes(member.state)) continue;
        // A zombie thread-group leader can still have live threads. Inspect its
        // remaining tasks before treating this process as quiescent.
        let tasks: string[];
        try {
          tasks = (await fs.readdir(`/proc/${member.pid}/task`)).filter((name) =>
            /^[1-9]\d*$/.test(name)
          );
        } catch (error) {
          if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) {
            // task/ can be unavailable after a leader calls pthread_exit even
            // while other threads live. Missing tasks are inconclusive, not Z.
            states.push('?');
            continue;
          }
          throw error;
        }
        if (!tasks.length) states.push('?');
        if (tasks.length > 131_072) throw new Error('Process group observation limit exceeded.');
        for (let offset = 0; offset < tasks.length; offset += 32) {
          signal.throwIfAborted();
          const observations = await Promise.all(
            tasks.slice(offset, offset + 32).map(async (task) => {
              try {
                return parseLinuxProcessStat(
                  await fs.readFile(`/proc/${member.pid}/task/${task}/stat`, {
                    encoding: 'utf8',
                    signal,
                  })
                );
              } catch (error) {
                if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? ''))
                  return undefined;
                throw error;
              }
            })
          );
          if (!observations.some(Boolean)) states.push('?');
          for (const task of observations) if (task?.group === group) states.push(task.state);
        }
      }
    }
    signal.throwIfAborted();
    return states;
  },
};

/**
 * The caller MUST own the group and supply its cleanup deadline as a signal.
 * Zombies are terminated but may await an unrelated reaper. Empty observations
 * of an existing group are inconclusive, never successful termination evidence.
 * This is not containment of descendants that deliberately escape the session.
 */
export async function waitForLinuxProcessGroupExit(
  group: number,
  signal: AbortSignal,
  probe: LinuxProcessGroupProbe = procfsProbe
): Promise<void> {
  if (!Number.isSafeInteger(group) || group <= 1) throw new Error('Invalid owned process group.');
  for (;;) {
    signal.throwIfAborted();
    if (!probe.exists(group)) return;
    const states = await probe.states(group, signal);
    signal.throwIfAborted();
    if (states.length && states.every((state) => ['Z', 'X', 'x'].includes(state))) return;
    if (!probe.exists(group)) return;
    await delay(10, undefined, { signal });
  }
}
