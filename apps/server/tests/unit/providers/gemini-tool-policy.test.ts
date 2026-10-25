import { expect, it, vi } from 'vitest';
import {
  geminiPolicyTools,
  geminiPolicyDocument,
  prepareGeminiPolicy,
} from '../../../src/providers/gemini-tool-policy.js';
import type { ExecuteOptions } from '@automaker/types';
import type { ExecutionEnvironment } from '../../../src/services/execution-environment/runtime.js';

const options: ExecuteOptions = { prompt: 'Chat', model: '2.5-flash', cwd: '/owned/project' };
const fixture = () => {
  const filesystem = {
    type: 'ssh',
    platform: 'linux',
    cwd: options.cwd,
    listDirectory: vi.fn().mockResolvedValue({ entries: [], truncated: false }),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    remove: vi.fn(),
  };
  const probe = vi.fn(async (args: string[]) =>
    args[0] === '--version' ? '0.65.0\n' : '--admin-policy --approval-mode --extensions'
  );
  return { filesystem, probe };
};
it('preserves undefined/[] and intersects explicit availability and approval grants', () => {
  expect(geminiPolicyTools(options)).toBeUndefined();
  expect(geminiPolicyTools({ ...options, allowedTools: [] })).toEqual([]);
  expect(geminiPolicyTools({ ...options, tools: [], allowedTools: ['Bash'] })).toEqual([]);
  expect(
    geminiPolicyTools({ ...options, tools: ['Read', 'Write'], allowedTools: ['Read', 'Bash'] })
  ).toEqual(['read_file', 'read_many_files']);
  expect(geminiPolicyTools({ ...options, allowedTools: ['Task', 'Skill', 'Read'] })).toEqual([
    'read_file',
    'read_many_files',
  ]);
  expect(() => geminiPolicyTools({ ...options, readOnly: true })).toThrow('cannot enforce');
  expect(() => geminiPolicyTools({ ...options, tools: ['Unknown'] })).toThrow('cannot enforce');
  expect(geminiPolicyDocument([])).not.toContain('decision = "allow"');
  expect(geminiPolicyDocument(['read_file'])).toContain('mcpName = "*"');
});
it.each(['central', 'truncated', 'unreadable', 'version', 'capabilities', 'platform'] as const)(
  'refuses the %s boundary before policy writes or model dispatch',
  async (boundary) => {
    const { filesystem, probe } = fixture();
    if (boundary === 'central')
      filesystem.listDirectory.mockResolvedValue({
        entries: [{ name: 'central.toml', type: 'file' }],
        truncated: false,
      });
    if (boundary === 'truncated')
      filesystem.listDirectory.mockResolvedValue({ entries: [], truncated: true });
    if (boundary === 'unreadable') filesystem.listDirectory.mockRejectedValue({ code: 'EACCES' });
    if (boundary === 'version') probe.mockResolvedValue('0.64.0');
    if (boundary === 'capabilities')
      probe.mockImplementation(async (args) => (args[0] === '--version' ? '0.65.0' : '--help'));
    if (boundary === 'platform') filesystem.platform = 'win32';
    await expect(
      prepareGeminiPolicy(
        { ...options, tools: ['Read'] },
        filesystem as unknown as ExecutionEnvironment,
        probe
      )
    ).rejects.toMatchObject({ code: 'GEMINI_TOOL_POLICY_UNSUPPORTED' });
    expect(filesystem.mkdir).not.toHaveBeenCalled();
    expect(filesystem.writeFile).not.toHaveBeenCalled();
  }
);
it('owns distinct policy files, create-only writes and cancellation-independent cleanup', async () => {
  const { filesystem, probe } = fixture();
  const controller = new AbortController();
  const first = (await prepareGeminiPolicy(
    { ...options, tools: [], abortController: controller },
    filesystem as unknown as ExecutionEnvironment,
    probe
  ))!;
  const second = (await prepareGeminiPolicy(
    { ...options, tools: ['Read'] },
    filesystem as unknown as ExecutionEnvironment,
    probe
  ))!;
  expect(first.file).not.toBe(second.file);
  expect(filesystem.writeFile.mock.calls[0][3]).toBeNull();
  controller.abort();
  await first.close();
  await first.close();
  await second.close();
  expect(filesystem.remove).toHaveBeenCalledTimes(2);
  expect(filesystem.remove.mock.calls[0][2].aborted).toBe(false);
});
it('cleans up partial creation and reports an unconfirmed cleanup instead of releasing its owner', async () => {
  const { filesystem, probe } = fixture();
  filesystem.writeFile.mockRejectedValue(new Error('Write interrupted'));
  await expect(
    prepareGeminiPolicy(
      { ...options, tools: [] },
      filesystem as unknown as ExecutionEnvironment,
      probe
    )
  ).rejects.toThrow('Write interrupted');
  expect(filesystem.remove).toHaveBeenCalledOnce();
  filesystem.writeFile.mockReset();
  const lease = (await prepareGeminiPolicy(
    { ...options, tools: [] },
    filesystem as unknown as ExecutionEnvironment,
    probe
  ))!;
  filesystem.remove.mockRejectedValue(new Error('Unknown outcome'));
  await expect(lease.close()).rejects.toThrow('cleanup is unconfirmed');
});
