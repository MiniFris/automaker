import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { DevServerService, type DevServerRuntime } from '../../src/services/dev-server-service.js';
import { TestRunnerService } from '../../src/services/test-runner-service.js';

it.skipIf(process.platform !== 'linux')(
  'isolates real dev/test children across native apps after environment mutation and removes backend transport variables',
  async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'native-process-env-'));
    const applications: Awaited<ReturnType<typeof createNestApplication>>[] = [];
    const probes: Array<{
      app: (typeof applications)[number];
      root: string;
      project: string;
      environment: NodeJS.ProcessEnv;
      owner: string;
    }> = [];
    try {
      for (const owner of ['one', 'two']) {
        const root = path.join(temporary, owner),
          project = path.join(root, 'project'),
          bin = path.join(root, 'bin');
        await mkdir(project, { recursive: true });
        await mkdir(bin);
        await writeFile(
          path.join(bin, 'owner-probe'),
          `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(process.argv[3], JSON.stringify({ owner:process.env.PROCESS_OWNER, home:process.env.HOME, path:process.env.PATH, port:process.env.PORT??null, data:process.env.DATA_DIR??null, key:process.env.AUTOMAKER_API_KEY??null, nodePath:process.env.NODE_PATH??null, ci:process.env.CI??null }));
if(process.argv[2]==='dev') require('node:net').createServer(socket=>socket.end('owned')).listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('Local: http://localhost:'+process.env.PORT));
else console.log('OWNER_'+process.env.PROCESS_OWNER);
`,
          { mode: 0o700 }
        );
        const environment: NodeJS.ProcessEnv = {
          NODE_ENV: 'test',
          HOME: path.join(root, 'home'),
          PATH: bin + ':/usr/bin:/bin',
          PROCESS_OWNER: owner,
          AUTOMAKER_API_KEY: 'private-' + owner,
          NODE_PATH: path.join(root, 'private-node-path'),
          ALLOWED_ROOT_DIRECTORY: root,
          ENABLE_REQUEST_LOGGING: 'false',
        };
        const app = await createNestApplication({
          workingDirectory: root,
          dataDir: path.join(root, 'data'),
          host: '127.0.0.1',
          port: 0,
          environment,
          runStartupTasks: false,
          enableShutdownHooks: false,
          providerRegistrations: [],
        });
        applications.push(app);
        await app.start();
        probes.push({ app, root, project, environment, owner });
      }
      for (const probe of probes) {
        probe.environment.PATH = '/mutated-input-path';
        probe.environment.PROCESS_OWNER = 'mutated-input';
      }
      for (const name of [
        'HOME',
        'PATH',
        'PORT',
        'DATA_DIR',
        'AUTOMAKER_API_KEY',
        'NODE_PATH',
        'PROCESS_OWNER',
      ])
        vi.stubEnv(name, 'poisoned-ambient-' + name);
      async function report(project: string, filename: string) {
        let value: Record<string, unknown> | undefined;
        await vi.waitFor(async () => {
          value = JSON.parse(await readFile(path.join(project, filename), 'utf8'));
          expect(value).toBeDefined();
        });
        return value!;
      }
      async function runTests(probe: (typeof probes)[number], filename: string) {
        const tests = probe.app.app.get(TestRunnerService);
        const started = await tests.startTests(probe.project, {
          command: 'owner-probe test ' + filename,
        });
        expect(started.success).toBe(true);
        const id = started.result!.sessionId;
        await vi.waitFor(() => expect(tests.getSessionOutput(id).result?.status).toBe('passed'));
        const value = await report(probe.project, filename);
        expect(value).toMatchObject({
          owner: probe.owner,
          home: path.join(probe.root, 'home'),
          path: path.join(probe.root, 'bin') + ':/usr/bin:/bin',
          port: null,
          data: null,
          key: null,
          nodePath: null,
          ci: 'true',
        });
        expect(tests.getSessionOutput(id).result?.output).toContain('OWNER_' + probe.owner);
      }
      for (const probe of probes) {
        await runTests(probe, 'test.json');
        const reservation = createServer();
        await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
        const port = (reservation.address() as { port: number }).port;
        await new Promise<void>((resolve, reject) =>
          reservation.close((error) => (error ? reject(error) : resolve()))
        );
        const dev = probe.app.app.get(DevServerService);
        (dev as unknown as { runtime: DevServerRuntime }).runtime.ports = {
          first: port,
          last: port,
        };
        const started = await dev.startDevServer(
          probe.project,
          probe.project,
          'owner-probe dev dev.json'
        );
        expect(started.success).toBe(true);
        expect(await report(probe.project, 'dev.json')).toMatchObject({
          owner: probe.owner,
          home: path.join(probe.root, 'home'),
          port: String(port),
          data: null,
          key: null,
          nodePath: null,
        });
        expect((await dev.stopDevServer(probe.project)).success).toBe(true);
        expect(dev.isRunning(probe.project)).toBe(false);
      }
      await probes[0].app.app.close();
      await runTests(probes[1], 'after-other-close.json');
    } finally {
      vi.unstubAllEnvs();
      await Promise.all(applications.map((app) => app.app.close()));
      await rm(temporary, { recursive: true, force: true });
    }
  }
);
