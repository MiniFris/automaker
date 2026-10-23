import { describe, expect, it } from 'vitest';

import { ToolPolicyService } from '../../../src/modules/providers/tool-policy.service.js';

const policy = new ToolPolicyService();

describe('ToolPolicyService', () => {
  it('normalizes aliases, removes duplicates, and fails closed for unknown tools', () => {
    expect(
      policy.resolve({
        requested: ['read', 'Read', 'shell', 'remove'],
        readOnly: false,
        providerSupportsTools: true,
      })
    ).toEqual(['Read', 'Bash', 'Delete']);
    expect(() =>
      policy.resolve({
        requested: ['provider_magic_tool'],
        readOnly: false,
        providerSupportsTools: true,
      })
    ).toThrow('Unknown tool');
  });

  it('enforces provider, read-only, and execution environment capabilities', () => {
    const requested = ['Read', 'Write', 'Bash', 'Delete'];
    expect(policy.resolve({ requested, readOnly: true, providerSupportsTools: true })).toEqual([
      'Read',
    ]);
    expect(
      policy.resolve({
        requested,
        readOnly: false,
        providerSupportsTools: true,
        environment: { shell: false, remove: false },
      })
    ).toEqual(['Read', 'Write']);
    expect(policy.resolve({ requested, readOnly: false, providerSupportsTools: false })).toEqual(
      []
    );
  });

  it.each([
    'rm -rf ./generated',
    'sudo rm -fr /tmp/project',
    'env FOO=1 sh -c rm -rf /workspace',
    'echo broken > /etc/hosts',
    'git reset --hard HEAD~1',
    'git clean -fdx',
    'Remove-Item -Recurse project',
  ])('detects destructive command wrappers and redirects: %s', (command) => {
    expect(policy.isDestructiveCommand(command)).toBe(true);
  });

  it.each(['rg TODO src', 'git status', 'printf hello > ./output.txt', 'rm ./single-file'])(
    'does not overclassify ordinary commands: %s',
    (command) => expect(policy.isDestructiveCommand(command)).toBe(false)
  );
});
