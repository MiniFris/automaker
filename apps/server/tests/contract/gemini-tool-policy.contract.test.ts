import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import type { ExecuteOptions } from '@automaker/types';
import { createNestApplication } from '../../src/main.js';
import { GeminiProvider } from '../../src/providers/gemini-provider.js';
import {
  issueEnvironment,
  type ExecutionEnvironment,
} from '../../src/services/execution-environment/runtime.js';

class OwnedGemini extends GeminiProvider {
  detections = 0;
  constructor(private readonly binary: string) {
    super();
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

it.each(['local', 'ssh'] as const)(
  'rejects Gemini policy before any %s detection, write or dispatch and preserves unrestricted execution',
  async (type) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-gemini-policy-'));
    const cwd = path.join(directory, 'project');
    await mkdir(cwd);
    const binary = path.join(directory, 'gemini');
    await writeFile(
      binary,
      `#!${process.execPath}
const fs=require('node:fs');
(async()=>{let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
fs.writeFileSync('invocation.json',JSON.stringify({args:process.argv.slice(2),prompt}));
for(const event of [{type:'init',session_id:'owned-session'},{type:'message',role:'assistant',content:'Owned CLI answer'},{type:'result',status:'success'}])process.stdout.write(JSON.stringify(event)+'\\n');
})().catch(error=>{process.stderr.write(error.message);process.exitCode=1;});
`,
      { mode: 0o700 }
    );
    const provider = new OwnedGemini(binary);
    // An offline issued transport executes only the owned fixture, never SSH/vendor services.
    const runProcess = vi.fn<NonNullable<ExecutionEnvironment['runProcess']>>(
      async (request, signal, output) => {
        expect(request.command).toBe('gemini');
        return new Promise((resolve, reject) => {
          const child = spawn(binary, request.args, {
            cwd,
            signal,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          child.stdout.on('data', (chunk) => output('stdout', chunk));
          child.stderr.on('data', (chunk) => output('stderr', chunk));
          child.once('error', reject);
          child.once('close', (exitCode) => resolve({ exitCode: exitCode ?? 1 }));
          child.stdin.end(request.stdin);
        });
      }
    );
    const runtime =
      type === 'ssh'
        ? issueEnvironment({
            type,
            cwd,
            platform: process.platform,
            runProcess,
          } as ExecutionEnvironment)
        : undefined;
    const options = {
      prompt: 'Literal prompt',
      model: '2.5-flash',
      cwd,
      executionEnvironmentRuntime: runtime,
    };
    try {
      for (const policy of [
        { readOnly: true },
        { allowedTools: [] },
        { allowedTools: ['Read'] },
        { tools: [] },
        { tools: ['Read'] },
      ]) {
        await expect(collect(provider, { ...options, ...policy })).rejects.toMatchObject({
          code: 'GEMINI_TOOL_POLICY_UNSUPPORTED',
          status: 400,
        });
        expect(provider.detections).toBe(0);
        expect(runProcess).not.toHaveBeenCalled();
        expect(await readdir(cwd)).toEqual([]);
      }
      const messages = await collect(provider, options);
      expect(messages).toContainEqual(expect.objectContaining({ type: 'assistant' }));
      expect(messages).toContainEqual(expect.objectContaining({ type: 'result' }));
      const invocation = JSON.parse(await readFile(path.join(cwd, 'invocation.json'), 'utf8'));
      expect(invocation.prompt).toBe('Literal prompt');
      expect(invocation.args).toContain('yolo');
      expect(invocation.args).not.toContain('--allowed-tools');
      if (type === 'ssh') {
        expect(provider.detections).toBe(0);
        expect(runProcess).toHaveBeenCalledOnce();
        expect(await readdir(cwd)).toEqual(['invocation.json']);
      } else {
        expect(provider.detections).toBeGreaterThan(0);
        expect(await readdir(cwd)).toEqual(['.geminiignore', 'invocation.json']);
      }
    } finally {
      await provider.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }
);

it('keeps native HTTP chat restrictions from the real query builder instead of dropping them for Gemini', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-gemini-policy-http-'));
  const cwd = path.join(directory, 'project');
  await mkdir(cwd);
  const provider = new OwnedGemini(path.join(directory, 'must-not-run'));
  const runtime = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    dataDir: path.join(directory, 'data'),
    workingDirectory: directory,
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
    expect(
      await post('agent/send', { sessionId, message: 'Do not discard the chat tool policy' })
    ).toMatchObject({ success: true });
    await vi.waitFor(async () => {
      const history = await post('agent/history', { sessionId });
      expect(history.isRunning).toBe(false);
      expect(JSON.stringify(history.messages)).toContain(
        'cannot enforce the requested tool policy'
      );
    });
    expect(provider.detections).toBe(0);
    expect(await readdir(cwd)).not.toContain('.geminiignore');
  } finally {
    await runtime.app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
