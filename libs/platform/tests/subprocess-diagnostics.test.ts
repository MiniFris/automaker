import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnJSONLProcess } from '../src/subprocess.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it.each([true, false])(
  'actual child diagnostics policy enabled=%s preserves protocol content and contains raw parse/stderr diagnostics',
  async (controlled) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-diagnostics-'));
    roots.push(root);
    const file = path.join(root, 'fixture.cjs');
    const secret = 'private-diagnostic-value';
    await fs.writeFile(
      file,
      `process.stderr.write('${secret}');process.stdout.write(JSON.stringify({type:'assistant',text:'normal-answer'})+'\\n'+'invalid-${secret}\\n'+'final-${secret}');process.exitCode=7;`
    );
    const logs = ['log', 'warn', 'error'].map((name) =>
      vi.spyOn(console, name as 'log').mockImplementation(() => {})
    );
    const classify = vi.fn(() => 'Controlled provider failure');
    const events = [];
    for await (const event of spawnJSONLProcess({
      command: process.execPath,
      args: [file],
      cwd: root,
      inheritEnv: false,
      env: {},
      ...(controlled ? { processFailureMessage: classify } : {}),
    }))
      events.push(event);
    expect(events[0]).toEqual({ type: 'assistant', text: 'normal-answer' });
    expect(events).toHaveLength(4);
    const diagnostics = JSON.stringify({ events, logs: logs.flatMap((log) => log.mock.calls) });
    if (controlled) {
      expect(classify).toHaveBeenCalledWith(secret, 7);
      expect(diagnostics).not.toContain(secret);
      expect(events.slice(1, 3)).toEqual(
        Array(2).fill({
          type: 'error',
          error: 'Failed to parse CLI output. Check the provider configuration and retry.',
        })
      );
      expect(events[3]).toEqual({ type: 'error', error: 'Controlled provider failure' });
    } else {
      expect(classify).not.toHaveBeenCalled();
      expect(diagnostics).toContain(secret);
      expect(events[3]).toEqual({ type: 'error', error: secret });
    }
  }
);
