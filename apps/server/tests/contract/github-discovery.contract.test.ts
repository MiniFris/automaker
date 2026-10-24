import { mkdir, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { ModulesContainer } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { githubReadFixture } from '../helpers/github-read-fixture.js';
import { createNestApplication } from '../../src/main.js';
import { GithubReadPort } from '../../src/modules/github/github-read.port.js';
import { GithubCliReadAdapter } from '../../src/modules/github/github-cli-read.adapter.js';
import { GithubDiscoveryService } from '../../src/modules/github/github-discovery.service.js';
import {
  GithubCommandRuntime,
  NodeGithubCommandRuntime,
} from '../../src/modules/github/github-command.runtime.js';
import { parseLinuxProcessStat } from '../../src/core/platform/linux-process-group.js';

const execute = promisify(execFile);
async function start() {
  const fixture = await githubReadFixture();
  const project = path.join(fixture.root, 'project; literal path');
  await mkdir(project);
  await execute('git', ['-c', 'init.templateDir=', 'init', '--quiet', project]);
  await execute('git', [
    '-C',
    project,
    'remote',
    'add',
    'origin',
    'https://private-user:private-password@github.com/owned/repo.v2.git',
  ]);
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: fixture.root,
    dataDir: path.join(fixture.root, 'data'),
    providerRegistrations: [],
    runStartupTasks: false,
    enableShutdownHooks: false,
    environment: {
      ...fixture.environment,
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  await runtime.start();
  const port = (runtime.app.getHttpServer().address() as { port: number }).port;
  return {
    ...runtime,
    fixture,
    project,
    post: async (route: string) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/github/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'fixture' },
        body: JSON.stringify({ projectPath: project }),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}
async function stopped(pid: number) {
  try {
    expect(['Z', 'X', 'x']).toContain(
      parseLinuxProcessStat(await readFile(`/proc/${pid}/stat`, 'utf8')).state
    );
  } catch (error) {
    expect(error).toMatchObject({ code: 'ENOENT' });
  }
}
async function ownedFallbackKill(fixture: Awaited<ReturnType<typeof githubReadFixture>>) {
  try {
    const pids = await fixture.pids();
    for (const pid of [pids.root, pids.child]) {
      try {
        if (
          pids.root > 1 &&
          parseLinuxProcessStat(await readFile(`/proc/${pid}/stat`, 'utf8')).group === pids.root
        ) {
          process.kill(-pids.root, 'SIGKILL');
          break;
        }
      } catch {
        /* already exited */
      }
    }
  } catch {
    /* fixture did not create a child */
  }
}

describe.skipIf(process.platform !== 'linux')(
  'native GitHub discovery through owned offline CLI fixtures',
  () => {
    it('owns native ports once, returns original fields/status and uses argv/stdin with isolated host snapshots', async () => {
      const first = await start(),
        second = await start();
      try {
        expect(first.app.get(GithubReadPort)).toBe(first.app.get(GithubCliReadAdapter));
        expect(first.app.get(GithubCommandRuntime)).toBe(first.app.get(NodeGithubCommandRuntime));
        expect(first.app.get(GithubCommandRuntime)).not.toBe(second.app.get(GithubCommandRuntime));
        expect(
          [...first.app.get(ModulesContainer).values()]
            .flatMap((module) => [...module.providers.values()])
            .filter((entry) => entry.token === NodeGithubCommandRuntime)
        ).toHaveLength(1);
        await expect(first.fixture.calls()).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await first.post('check-remote')).toMatchObject({
          status: 200,
          body: {
            success: true,
            owner: 'owned',
            repo: 'repo.v2',
            remoteUrl: 'https://github.com/owned/repo.v2.git',
          },
        });
        expect(await first.post('issues')).toMatchObject({
          status: 200,
          body: {
            success: true,
            closedIssues: [],
            openIssues: [{ number: 12, linkedPRs: [{ number: 24, state: 'open' }] }],
          },
        });
        expect(await first.post('prs')).toMatchObject({
          status: 200,
          body: { success: true, mergedPRs: [], openPRs: [{ number: 24 }] },
        });
        const calls = await first.fixture.calls();
        expect(
          calls.every(
            (call) => call.overrideAbsent && call.profileToken && call.cwd === first.project
          )
        ).toBe(true);
        expect(
          calls
            .filter((call) => call.args[0] === 'api')
            .every((call) => JSON.parse(call.input).query.startsWith('query IssueLinks('))
        ).toBe(true);
        expect(JSON.stringify(calls)).not.toContain('private-password');
        await first.app.close();
        expect(await second.post('prs')).toMatchObject({ status: 200, body: { success: true } });
      } finally {
        try {
          await Promise.all([first.app.close(), second.app.close()]);
        } finally {
          await Promise.all([first.fixture.cleanup(), second.fixture.cleanup()]);
        }
      }
    });

    it('does not interpolate hostile CLI metadata and maps failures/rate limits without publishing diagnostics', async () => {
      const runtime = await start();
      try {
        await runtime.fixture.scenario('normal', { repo: 'repo; touch ESCAPED' });
        expect(await runtime.post('prs')).toMatchObject({ status: 200, body: { success: true } });
        expect(
          (await runtime.fixture.calls())
            .filter((call) => call.args.includes('-R'))
            .every((call) => call.args.includes('github.com/owned/repo.v2'))
        ).toBe(true);
        await expect(readFile(path.join(runtime.project, 'ESCAPED'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
        await runtime.fixture.scenario('rate');
        const rate = await runtime.post('issues');
        expect(rate.status).toBe(429);
        expect(rate.body.success).toBe(false);
        expect(JSON.stringify(rate.body)).not.toContain('private-provider-credential');
        await runtime.fixture.scenario('malformed');
        expect(await runtime.post('prs')).toMatchObject({
          status: 503,
          body: { success: false, errorCode: 'UNAVAILABLE' },
        });
        await runtime.fixture.scenario('links-failed');
        const partial = await runtime.post('issues');
        expect(partial).toMatchObject({ status: 200, body: { success: true } });
        expect(partial.body.openIssues[0]).not.toHaveProperty('linkedPRs');
      } finally {
        try {
          await runtime.app.close();
        } finally {
          await runtime.fixture.cleanup();
        }
      }
    });

    it('drains a real hanging CLI process and its owned child on native shutdown before reporting close success', async () => {
      const runtime = await start();
      await runtime.fixture.scenario('hold');
      const pending = runtime.post('check-remote');
      const outcome = pending.catch(() => ({ status: 0, body: { success: false } }));
      try {
        await vi.waitFor(async () =>
          expect((await runtime.fixture.pids()).child).toBeGreaterThan(1)
        );
        const pids = await runtime.fixture.pids();
        expect(parseLinuxProcessStat(await readFile(`/proc/${pids.root}/stat`, 'utf8')).group).toBe(
          pids.root
        );
        await runtime.app.close();
        expect((await outcome).body.success).toBe(false);
        await stopped(pids.root);
        await stopped(pids.child);
        expect(() => runtime.app.get(GithubDiscoveryService).remote(runtime.project)).toThrow(
          'shutting down'
        );
      } finally {
        await ownedFallbackKill(runtime.fixture);
        try {
          await runtime.app.close();
          await outcome;
        } finally {
          await runtime.fixture.cleanup();
        }
      }
    });

    it('does not report parent exit as successful cleanup while a background CLI descendant survives', async () => {
      const runtime = await start();
      await runtime.fixture.scenario('orphan');
      try {
        expect(await runtime.post('check-remote')).toMatchObject({
          status: 200,
          body: { success: true },
        });
        const pids = await runtime.fixture.pids();
        await stopped(pids.root);
        await stopped(pids.child);
      } finally {
        await ownedFallbackKill(runtime.fixture);
        try {
          await runtime.app.close();
        } finally {
          await runtime.fixture.cleanup();
        }
      }
    });
  }
);
