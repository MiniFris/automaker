import { describe, expect, it } from 'vitest';

import { ToolPolicyService } from '../../../src/modules/providers/tool-policy.service.js';

const policy = new ToolPolicyService();

describe('ToolPolicyService', () => {
  it('grants only known read effects for an omitted read-only policy', () => {
    expect(policy.resolve({ readOnly: true, providerSupportsTools: true })).toEqual([
      'Read',
      'LS',
      'Glob',
      'Grep',
      'WebSearch',
      'WebFetch',
    ]);
    expect(policy.resolve({ readOnly: false, providerSupportsTools: true })).toBeUndefined();
  });

  it('preserves explicit deny-all and refuses delegation as a read-only capability', () => {
    for (const readOnly of [true, false]) {
      expect(policy.resolve({ requested: [], readOnly, providerSupportsTools: true })).toEqual([]);
    }
    expect(
      policy.resolve({
        requested: ['Task', 'Skill', 'TodoWrite', 'Read'],
        readOnly: true,
        providerSupportsTools: true,
      })
    ).toEqual(['Read']);
    expect(
      policy.resolve({
        requested: ['Task', 'Skill', 'TodoWrite'],
        readOnly: false,
        providerSupportsTools: true,
      })
    ).toEqual(['Task', 'Skill', 'TodoWrite']);
  });

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
