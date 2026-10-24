import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { TerminalService } from '../../src/services/terminal-service.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { parseLinuxProcessStat } from '../../src/core/platform/linux-process-group.js';

it.skipIf(process.platform !== 'linux')(
  'does not recreate or replay a terminal when its old identity reconnects after backend restart',
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-terminal-restart-'));
    const owners: Awaited<ReturnType<typeof createNestApplication>>[] = [];
    const start = async () => {
      const owner = await createNestApplication({
        host: '127.0.0.1',
        port: 0,
        workingDirectory: directory,
        dataDir: path.join(directory, 'data'),
        runStartupTasks: false,
        enableShutdownHooks: false,
        providerRegistrations: [],
        environment: {
          NODE_ENV: 'test',
          AUTOMAKER_API_KEY: 'fixture',
          ENABLE_REQUEST_LOGGING: 'false',
        },
      });
      owners.push(owner);
      await owner.start();
      return owner;
    };
    let group: number | undefined;
    let originalStart: string | undefined;
    try {
      const first = await start();
      const settings = first.app.get(SettingsService);
      await settings.updateGlobalSettings({
        terminalConfig: { ...(await settings.getGlobalSettings()).terminalConfig!, enabled: false },
      });
      const terminal = first.app.get(TerminalService);
      const session = await terminal.createSession({
        cwd: directory,
        shell: '/bin/sh',
        env: { HOME: directory, ENV: '', BASH_ENV: '' },
      });
      expect(session).not.toBeNull();
      group = (session!.pty as unknown as { pid: number }).pid;
      const originalStat = await readFile(`/proc/${group}/stat`, 'utf8');
      originalStart = originalStat
        .slice(originalStat.lastIndexOf(')') + 1)
        .trim()
        .split(/\s+/)[19];
      const effect = path.join(directory, 'effect.txt');
      terminal.write(session!.id, `printf 'started\\n' >> '${effect.replaceAll("'", "'\\''")}'\n`);
      await vi.waitFor(async () => expect(await readFile(effect, 'utf8')).toBe('started\n'));
      await first.app.close();
      const restarted = await start();
      const server = restarted.app.getHttpServer();
      const client = new WebSocket(
        `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/terminal/ws?apiKey=fixture&sessionId=${session!.id}`
      );
      const messages: unknown[] = [];
      client.on('message', (data) => messages.push(JSON.parse(data.toString())));
      const code = await new Promise<number>((done, failed) => {
        client.once('close', done);
        client.once('error', failed);
      });
      expect(code).toBe(4004);
      expect(messages).toEqual([]);
      expect(restarted.app.get(TerminalService).getSessionCount()).toBe(0);
      expect(await readFile(effect, 'utf8')).toBe('started\n');
    } finally {
      const cleanup = await Promise.allSettled(owners.map((owner) => owner.app.close()));
      if (group) {
        try {
          const stat = await readFile(`/proc/${group}/stat`, 'utf8');
          const current = parseLinuxProcessStat(stat);
          const fields = stat
            .slice(stat.lastIndexOf(')') + 1)
            .trim()
            .split(/\s+/);
          if (
            current.group === group &&
            Number(fields[1]) === process.pid &&
            fields[19] === originalStart &&
            !['Z', 'X', 'x'].includes(current.state)
          )
            process.kill(-group, 'SIGKILL');
        } catch {
          /* Original owned PTY already exited. */
        }
      }
      await rm(directory, { recursive: true, force: true });
      for (const result of cleanup) if (result.status === 'rejected') throw result.reason;
    }
  }
);
