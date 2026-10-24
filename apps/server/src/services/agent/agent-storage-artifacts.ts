import path from 'node:path';
import * as secureFs from '../../lib/secure-fs.js';
import { AgentSessionStorageError } from './agent-session-storage.error.js';

/** Only files produced by our atomic writer; never broad prefix/glob or recursive removal. */
export async function agentStorageArtifacts(
  directory: string,
  basename: string,
  includeMain = true
): Promise<string[]> {
  const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Scrubbing a backup or a previous temp is itself atomic; a crash can leave
  // a backup's temp, or a nested temp. Recognize those exact writer suffixes too.
  const owned = new RegExp(`^${escaped}(?:\\.bak[1-9][0-9]*)?(?:\\.tmp\\.[0-9]+\\.[a-f0-9]{8})*$`);
  let names: string[];
  try {
    names = await secureFs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new AgentSessionStorageError('read');
  }
  return names
    .filter((name) => (name === basename ? includeMain : owned.test(name)))
    .sort()
    .map((name) => path.join(directory, name));
}

export async function removeAgentStorageArtifacts(
  directory: string,
  basename: string
): Promise<void> {
  for (const file of await agentStorageArtifacts(directory, basename)) {
    try {
      await secureFs.unlink(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new AgentSessionStorageError('write');
    }
  }
}
