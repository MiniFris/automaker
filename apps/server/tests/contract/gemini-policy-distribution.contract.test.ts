import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { geminiPolicyDocument } from '../../src/providers/gemini-tool-policy.js';

const packageRoot = process.env.AUTOMAKER_GEMINI_POLICY_PACKAGE;
it.skipIf(!packageRoot)(
  'enforces production TOML using the actual owned Gemini 0.65.0 distribution without auth/model calls',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'automaker-gemini-distribution-'));
    try {
      await fs.writeFile(path.join(root, 'tools.toml'), geminiPolicyDocument(['read_file']));
      await fs.writeFile(path.join(root, 'empty.toml'), geminiPolicyDocument([]));
      // A permissive user policy must never broaden the application-owned policy.
      await fs.writeFile(
        path.join(root, 'user.toml'),
        '[[rule]]\ntoolName="*"\ndecision="allow"\npriority=999\n'
      );
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          path.resolve(
            import.meta.dirname,
            '../fixtures/gemini-policy-distribution-acceptance.mjs'
          ),
          packageRoot!,
          root,
        ],
        { cwd: root, timeout: 15_000, maxBuffer: 65_536 }
      );
      expect(stdout).toContain('"checks":11');
      expect(stdout).toContain('"modelCalls":0');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  20_000
);
