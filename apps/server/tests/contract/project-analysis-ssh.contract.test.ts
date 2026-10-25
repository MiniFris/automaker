import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { ManagedSSH } from '../../src/services/execution-environment/ssh.js';
import { OpenAICompatibleProvider } from '../../src/providers/openai-compatible-provider.js';
import { APPLICATION_EVENTS } from '../../src/core/eventing/application-events.js';
import type { EventEmitter } from '../../src/lib/events.js';
import { sshPeer, testSSHKey } from '../helpers/ssh-peer.js';

const exec = promisify(execFile);
it.skipIf(process.platform !== 'linux')(
  'native analysis uses actual Direct Read tools on an existing SSH target and never reads the poisoned controller or prepares a workspace',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'analysis-ssh-'));
    const project = path.join(root, 'controller'),
      checkout = path.join(root, 'remote-checkout');
    await mkdir(project);
    await mkdir(checkout);
    await writeFile(path.join(project, 'source.txt'), 'POISONED_CONTROLLER');
    await writeFile(path.join(checkout, 'source.txt'), 'AUTHORITATIVE_SSH_SOURCE');
    await writeFile(path.join(checkout, '.gitignore'), '.automaker/\n.worktrees/\n');
    await exec('git', ['-C', checkout, 'init', '-qb', 'main']);
    await exec('git', ['-C', checkout, 'add', '.']);
    await exec('git', [
      '-C',
      checkout,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'base',
    ]);
    const requests: Array<{
      messages: Array<{ role: string; content: string }>;
      tools?: Array<{ function: { name: string } }>;
    }> = [];
    const upstream = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString());
        requests.push(body);
        const tool = body.messages.find((message: { role: string }) => message.role === 'tool');
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            choices: [
              {
                index: 0,
                message: tool
                  ? { role: 'assistant', content: `# SSH analysis\n${tool.content}` }
                  : {
                      role: 'assistant',
                      content: null,
                      tool_calls: [
                        {
                          id: 'read-source',
                          type: 'function',
                          function: { name: 'Read', arguments: '{"path":"source.txt"}' },
                        },
                      ],
                    },
                finish_reason: tool ? 'stop' : 'tool_calls',
              },
            ],
          })
        );
      })().catch(() => {
        response.statusCode = 500;
        response.end();
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const key = testSSHKey(),
      peer = await sshPeer(path.join(root, 'peer'), key);
    let owner: Awaited<ReturnType<typeof createNestApplication>> | undefined;
    try {
      owner = await createNestApplication({
        host: '127.0.0.1',
        port: 0,
        workingDirectory: project,
        dataDir: path.join(root, 'data'),
        runStartupTasks: false,
        enableShutdownHooks: false,
        providerRegistrations: [
          { name: 'openai-compatible', create: () => new OpenAICompatibleProvider() },
        ],
        environment: {
          NODE_ENV: 'test',
          HOME: root,
          USERPROFILE: root,
          AUTOMAKER_API_KEY: 'fixture',
          ALLOWED_ROOT_DIRECTORY: root,
          LOG_LEVEL: 'error',
          ENABLE_REQUEST_LOGGING: 'false',
        },
      });
      const settings = owner.app.get(SettingsService),
        profile = {
          id: 'ssh',
          name: 'SSH',
          type: 'ssh' as const,
          host: '127.0.0.1',
          port: peer.port,
          username: 'developer',
          basePath: path.join(root, 'peer/base'),
          credentialId: 'key',
        };
      await settings.updateGlobalSettings({
        executionEnvironment: {
          default: { mode: 'profile', profileId: 'ssh' },
          profiles: [profile],
        },
        phaseModels: {
          projectAnalysisModel: { model: 'direct-Analysis', providerId: 'offline' },
        } as never,
        openaiCompatibleEndpoints: [
          {
            id: 'offline',
            name: 'Offline',
            enabled: true,
            baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`,
            protocol: 'chat-completions',
            auth: { type: 'none' },
            models: [
              {
                id: 'Analysis',
                displayName: 'Analysis',
                capabilities: { tools: true, streaming: false },
              },
            ],
          },
        ],
      });
      const manager = new ManagedSSH(settings),
        fingerprint = await manager.state.scan(profile);
      await manager.state.confirm(profile, fingerprint.fingerprint, false);
      await manager.state.saveKey('key', key);
      await manager.prepareProject(
        profile,
        project,
        { method: 'existing', remotePath: checkout },
        new AbortController().signal
      );
      const prepare = vi.spyOn(ManagedSSH.prototype, 'prepareProject'),
        install = vi.spyOn(ManagedSSH.prototype, 'prepareWorker');
      const events: Record<string, unknown>[] = [];
      owner.app.get<EventEmitter>(APPLICATION_EVENTS).subscribe((type, payload) => {
        if (type === 'auto-mode:event') events.push(payload as Record<string, unknown>);
      });
      await owner.start();
      const response = await fetch(
        `http://127.0.0.1:${owner.app.getHttpServer().address().port}/api/auto-mode/analyze-project`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': 'fixture' },
          body: JSON.stringify({ projectPath: project }),
        }
      );
      expect(response.status).toBe(200);
      await response.arrayBuffer();
      await vi.waitFor(
        () =>
          expect(
            events.find((event) =>
              ['auto_mode_feature_complete', 'auto_mode_error'].includes(String(event.type))
            )
          ).toBeDefined(),
        { timeout: 7000 }
      );
      expect(events.filter((event) => event.type === 'auto_mode_error')).toEqual([]);
      const report = await readFile(path.join(project, '.automaker/project-analysis.md'), 'utf8');
      expect(report).toContain('AUTHORITATIVE_SSH_SOURCE');
      expect(report).not.toContain('POISONED_CONTROLLER');
      expect(requests).toHaveLength(2);
      expect(requests[0].tools?.map((tool) => tool.function.name).sort()).toEqual([
        'Glob',
        'Grep',
        'Read',
      ]);
      expect(JSON.stringify(requests[1].messages)).toContain('AUTHORITATIVE_SSH_SOURCE');
      expect(JSON.stringify(requests)).not.toContain('POISONED_CONTROLLER');
      expect(prepare).not.toHaveBeenCalled();
      expect(install).not.toHaveBeenCalled();
      await expect(access(path.join(checkout, '.worktrees'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await readFile(path.join(checkout, 'source.txt'), 'utf8')).toBe(
        'AUTHORITATIVE_SSH_SOURCE'
      );
      expect(peer.commands.length).toBeGreaterThan(0);
    } finally {
      await owner?.app.close();
      vi.restoreAllMocks();
      await peer.close();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
  20000
);
