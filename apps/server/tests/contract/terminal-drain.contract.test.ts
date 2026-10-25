import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { TerminalService } from '../../src/services/terminal-service.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { parseLinuxProcessStat } from '../../src/core/platform/linux-process-group.js';

it.skipIf(process.platform !== 'linux')(
  'Nest shutdown drains an actual TERM-resistant PTY and its original process group before resolving',
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-real-terminal-drain-'));
    const runtime = await createNestApplication({
      workingDirectory: directory,
      dataDir: path.join(directory, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      providerRegistrations: [],
    });
    let group: number | undefined;
    try {
      const settings = runtime.app.get(SettingsService);
      await settings.updateGlobalSettings({
        terminalConfig: { ...(await settings.getGlobalSettings()).terminalConfig!, enabled: false },
      });
      const terminals = runtime.app.get(TerminalService);
      const session = await terminals.createSession({
        cwd: directory,
        shell: '/bin/sh',
        env: { HOME: directory, ENV: '', BASH_ENV: '' },
      });
      expect(session).not.toBeNull();
      const ownedPid = (session!.pty as unknown as { pid: number }).pid;
      expect(parseLinuxProcessStat(await readFile(`/proc/${ownedPid}/stat`, 'utf8')).group).toBe(
        ownedPid
      );
      group = ownedPid;
      const file = path.join(directory, 'pids.json');
      const fixture = path.resolve(import.meta.dirname, '../fixtures/terminal-drain.mjs');
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
      terminals.write(
        session!.id,
        `exec ${quote(process.execPath)} ${quote(fixture)} ${quote(file)}\n`
      );
      await vi.waitFor(async () =>
        expect(JSON.parse(await readFile(file, 'utf8')).root).toBe(group)
      );
      const pids = JSON.parse(await readFile(file, 'utf8')) as { root: number; child: number };
      const closing = runtime.app.close();
      expect(terminals.getSession(session!.id) === session).toBe(true);
      expect(await terminals.createSession({ cwd: directory })).toBeNull();
      try {
        await closing;
      } catch {
        const owner = (
          terminals as unknown as { lifecycles: Map<string, { failureKind?: string }> }
        ).lifecycles.get(session!.id);
        throw new Error(`Native terminal drain failed: ${owner?.failureKind ?? 'unknown'}`);
      }
      expect(terminals.getSession(session!.id) === undefined).toBe(true);
      for (const pid of [pids.root, pids.child]) {
        try {
          const state = parseLinuxProcessStat(await readFile(`/proc/${pid}/stat`, 'utf8')).state;
          expect(['Z', 'X', 'x']).toContain(state);
        } catch (error) {
          expect(error).toMatchObject({ code: 'ENOENT' });
        }
      }
    } finally {
      // Only the fixture's verified original process group, never a discovered PID.
      if (group && group > 1) {
        try {
          process.kill(-group, 'SIGKILL');
        } catch {}
      }
      try {
        await runtime.app.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
);
