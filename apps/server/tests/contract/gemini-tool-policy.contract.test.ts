import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import type { ExecuteOptions } from '@automaker/types';
import { createNestApplication } from '../../src/main.js';
import { GeminiProvider } from '../../src/providers/gemini-provider.js';
import { LocalExecutionEnvironment } from '../../src/services/execution-environment/local.js';
import {
  issueEnvironment,
  type ExecutionEnvironment,
} from '../../src/services/execution-environment/runtime.js';

class OwnedGemini extends GeminiProvider {
  detections = 0;
  constructor(
    private readonly binary: string,
    root: string
  ) {
    super({}, async () => ({ PATH: process.env.PATH, HOME: root, GEMINI_CLI_HOME: root }));
  }
  protected ensureCliDetected(): void {
    this.detections++;
    this.cliPath = this.binary;
  }
}
async function collect(provider: GeminiProvider, options: ExecuteOptions) {
  const messages = [];
  for await (const message of provider.executeQuery(options)) messages.push(message);
  return messages;
}
async function cliFixture(root: string) {
  const binary = path.join(root, 'gemini');
  await writeFile(
    binary,
    `#!${process.execPath}
const fs=require('node:fs'); const args=process.argv.slice(2);
if(args.includes('--version')){console.log('0.65.0');process.exit(0);}
if(args.includes('--help')){console.log('--admin-policy --extensions --approval-mode');process.exit(0);}
(async()=>{let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
const index=args.indexOf('--admin-policy'),policy=index<0?null:fs.readFileSync(args[index+1],'utf8');
fs.writeFileSync('invocation.json',JSON.stringify({args,prompt,policy}));
const send=e=>process.stdout.write(JSON.stringify(e)+'\\n');
send({type:'init',session_id:'owned'});send({type:'message',role:'assistant',content:'Owned CLI answer'});
if(prompt.includes('hold-fixture'))setInterval(()=>{},1000);else send({type:'result',status:'success'});
})().catch(error=>{process.stderr.write(error.message);process.exitCode=1;});`,
    { mode: 0o700 }
  );
  return binary;
}
function ownedSystemBoundary() {
  const original = LocalExecutionEnvironment.prototype.listDirectory;
  vi.spyOn(LocalExecutionEnvironment.prototype, 'listDirectory').mockImplementation(
    function (directory, maximum, signal) {
      if (
        directory === '/etc/gemini-cli/policies' ||
        directory === '/Library/Application Support/GeminiCli/policies'
      )
        return Promise.resolve({ entries: [], truncated: false });
      return original.call(this, directory, maximum, signal);
    }
  );
}

it.each(['local', 'ssh'] as const)(
  'preserves restricted Gemini chat and cleans policy files after %s completion/cancellation',
  async (type) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'automaker-gemini-policy-'));
    const cwd = path.join(root, "project, quoted' dir");
    await mkdir(cwd);
    const binary = await cliFixture(root),
      provider = new OwnedGemini(binary, root);
    ownedSystemBoundary();
    const filesystem = await LocalExecutionEnvironment.create(cwd);
    const runProcess = vi.fn<NonNullable<ExecutionEnvironment['runProcess']>>(
      async (request, signal, output) => {
        expect(request.command).toBe('gemini');
        return new Promise((resolve, reject) => {
          const child = spawn(binary, request.args, {
            cwd,
            signal,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          let failure: Error | undefined;
          child.stdout.on('data', (chunk) => output('stdout', chunk));
          child.stderr.on('data', (chunk) => output('stderr', chunk));
          child.once('error', (error) => {
            failure = error;
          });
          child.once('close', (code) =>
            failure ? reject(failure) : resolve({ exitCode: code ?? 1 })
          );
          child.stdin.end(request.stdin);
        });
      }
    );
    const runtime =
      type === 'ssh'
        ? issueEnvironment({
            type,
            platform: process.platform,
            cwd,
            runProcess,
            listDirectory: filesystem.listDirectory.bind(filesystem),
            mkdir: filesystem.mkdir.bind(filesystem),
            writeFile: filesystem.writeFile.bind(filesystem),
            remove: filesystem.remove.bind(filesystem),
          } as ExecutionEnvironment)
        : undefined;
    const options = {
      prompt: 'Literal query',
      model: '2.5-flash',
      cwd,
      executionEnvironmentRuntime: runtime,
    };
    try {
      await expect(collect(provider, { ...options, readOnly: true })).rejects.toMatchObject({
        code: 'GEMINI_TOOL_POLICY_UNSUPPORTED',
      });
      expect(provider.detections).toBe(0);
      expect(runProcess).not.toHaveBeenCalled();
      expect(await readdir(cwd)).toEqual([]);
      for (const policy of [
        { allowedTools: ['Read', 'Task', 'Skill'] },
        { tools: [] },
        { tools: ['Read'], allowedTools: [] },
      ]) {
        expect(await collect(provider, { ...options, ...policy })).toContainEqual(
          expect.objectContaining({ type: 'result' })
        );
        const invocation = JSON.parse(await readFile(path.join(cwd, 'invocation.json'), 'utf8'));
        expect(invocation.args[invocation.args.indexOf('--approval-mode') + 1]).toBe('default');
        expect(invocation.args).not.toContain('yolo');
        expect(invocation.args).toContain('--admin-policy');
        expect(invocation.args[invocation.args.indexOf('--extensions') + 1]).toBe('none');
        expect(invocation.policy).toContain('decision = "deny"');
        expect(invocation.policy).not.toContain('activate_skill');
        expect(invocation.policy).not.toContain('delegate_to_agent');
        if (policy.allowedTools?.length) expect(invocation.policy).toContain('decision = "allow"');
        else expect(invocation.policy).not.toContain('decision = "allow"');
        const policyFile = invocation.args[invocation.args.indexOf('--admin-policy') + 1];
        expect(policyFile).not.toContain(',');
        await expect(stat(path.dirname(policyFile))).rejects.toMatchObject({ code: 'ENOENT' });
      }
      expect(await readdir(cwd)).not.toContain('.geminiignore');
      const stream = provider.executeQuery({
        ...options,
        allowedTools: ['Read'],
        prompt: 'hold-fixture',
      });
      expect((await stream.next()).value).toMatchObject({ type: 'assistant' });
      await stream.return(undefined);
      const canceled = JSON.parse(await readFile(path.join(cwd, 'invocation.json'), 'utf8'));
      await expect(
        stat(path.dirname(canceled.args[canceled.args.indexOf('--admin-policy') + 1]))
      ).rejects.toMatchObject({ code: 'ENOENT' });
      if (type === 'ssh') expect(provider.detections).toBe(0);
      expect(await collect(provider, options)).toContainEqual(
        expect.objectContaining({ type: 'result' })
      );
      const unrestricted = JSON.parse(await readFile(path.join(cwd, 'invocation.json'), 'utf8'));
      expect(unrestricted.args).toContain('yolo');
      expect(unrestricted.policy).toBeNull();
    } finally {
      await provider.dispose();
      vi.restoreAllMocks();
      await rm(root, { recursive: true, force: true });
    }
  }
);

it('executes the real native HTTP chat preset through the version-bound Gemini policy instead of discarding it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automaker-gemini-chat-'));
  const cwd = path.join(root, 'project');
  await mkdir(cwd);
  const provider = new OwnedGemini(await cliFixture(root), root);
  ownedSystemBoundary();
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    dataDir: path.join(root, 'data'),
    workingDirectory: root,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [{ name: 'gemini', create: () => provider }],
  });
  try {
    await runtime.start();
    const { port } = runtime.app.getHttpServer().address() as AddressInfo;
    const post = async (route: string, body: object) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'automaker-test-api-key' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      expect(response.status, JSON.stringify(result)).toBe(200);
      return result;
    };
    const created = await post('sessions', {
      name: 'Policy',
      projectPath: cwd,
      workingDirectory: cwd,
      model: 'gemini-2.5-flash',
    });
    const sessionId = created.session.id;
    await post('agent/start', { sessionId });
    await post('agent/send', { sessionId, message: 'Use the native chat policy' });
    await vi.waitFor(async () => {
      const history = await post('agent/history', { sessionId });
      expect(history.isRunning).toBe(false);
      expect(JSON.stringify(history.messages)).toContain('Owned CLI answer');
    });
    const invocation = JSON.parse(await readFile(path.join(cwd, 'invocation.json'), 'utf8'));
    expect(invocation.policy).toContain('run_shell_command');
    expect(invocation.policy).toContain('mcpName = "*"');
    expect(invocation.policy).not.toContain('activate_skill');
    expect(invocation.args).not.toContain('yolo');
    await expect(
      stat(path.dirname(invocation.args[invocation.args.indexOf('--admin-policy') + 1]))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await runtime.app.close();
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});

it('keeps the Gemini execution owner blocked when policy cleanup cannot be confirmed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automaker-gemini-cleanup-'));
  const cwd = path.join(root, 'project');
  await mkdir(cwd);
  const provider = new OwnedGemini(await cliFixture(root), root);
  ownedSystemBoundary();
  const remove = vi
    .spyOn(LocalExecutionEnvironment.prototype, 'remove')
    .mockRejectedValue(new Error('Fixture cleanup outcome unknown'));
  try {
    const options = { prompt: 'Chat', model: '2.5-flash', cwd, allowedTools: ['Read'] };
    await expect(collect(provider, options)).rejects.toThrow('cleanup is unconfirmed');
    await expect(collect(provider, options)).rejects.toThrow('not accepting');
    await expect(provider.dispose()).rejects.toThrow('cleanup is unconfirmed');
    expect(remove).toHaveBeenCalledOnce();
  } finally {
    await provider.dispose().catch(() => {});
    const ownedDirectory = remove.mock.calls[0]?.[0];
    if (ownedDirectory) {
      expect(String(ownedDirectory)).toMatch(/^\/tmp\/automaker-gemini-policy-[a-f0-9-]+$/);
      await rm(ownedDirectory, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});
