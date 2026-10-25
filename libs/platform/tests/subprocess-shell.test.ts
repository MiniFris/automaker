import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { spawn } from 'child_process';
import { spawnJSONLProcess, spawnProcess } from '../src/subprocess.js';
vi.mock('child_process', () => ({ spawn: vi.fn() }));
const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
afterEach(() => {
  Object.defineProperty(process, 'platform', descriptor);
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function child() {
  const value = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    kill: vi.fn(),
    exitCode: null as number | null,
  });
  queueMicrotask(() => {
    value.exitCode = 0;
    value.stdout.end();
    value.stderr.end();
    value.emit('exit', 0);
  });
  return value as unknown as ReturnType<typeof spawn>;
}
it.each(['jsonl', 'collected'] as const)(
  'preserves %s Windows argv handling while selecting only the explicit captured shell',
  async (mode) => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.stubEnv('ComSpec', 'C:\\ambient\\cmd.exe');
    vi.mocked(spawn).mockImplementation(() => child());
    const options = {
      command: 'fixture.cmd',
      args: ['--version', 'literal argument'],
      cwd: '/fixture',
      env: { ComSpec: 'C:\\captured\\cmd.exe' },
      inheritEnv: false,
      shell: 'C:\\captured\\cmd.exe',
    };
    if (mode === 'jsonl')
      for await (const _message of spawnJSONLProcess(options)) {
        /* drain */
      }
    else await spawnProcess(options);
    expect(spawn).toHaveBeenCalledWith(
      'fixture.cmd',
      ['--version', 'literal argument'],
      expect.objectContaining({
        shell: 'C:\\captured\\cmd.exe',
        env: { ComSpec: 'C:\\captured\\cmd.exe' },
      })
    );
  }
);
it('retains the previous shell default for standalone Windows callers', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  vi.mocked(spawn).mockImplementation(() => child());
  await spawnProcess({ command: 'fixture.cmd', args: [], cwd: '/fixture' });
  expect(vi.mocked(spawn).mock.calls[0][2]?.shell).toBe(true);
});
