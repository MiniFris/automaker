import { findCodexCliPath, getCodexAuthPath, systemPathReadFile } from '@automaker/platform';
import type { CodexUsageRuntime } from '../core/platform/codex-usage.runtime.js';

/** Stateless compatibility default for manual constructors only, not native Nest factories. */
export const legacyCodexUsageRuntime: CodexUsageRuntime = {
  async snapshot() {
    return {
      environment: { ...process.env },
      workingDirectory: process.cwd(),
      cliPath: await findCodexCliPath(),
      authFilePath: getCodexAuthPath(),
    };
  },
  readAuth: systemPathReadFile,
};
