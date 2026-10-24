import { access, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Compiler exclusions do not block transitive imports. Validate the emitted artifact too. */
export async function assertProductionServerArtifact(outputRoot) {
  await access(path.join(outputRoot, 'main.js'));
  for (const reserved of ['routes', 'legacy']) {
    let entry;
    try {
      entry = await lstat(path.join(outputRoot, reserved));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (entry) throw new Error(`Production server artifact must not contain ${reserved}/.`);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await assertProductionServerArtifact(fileURLToPath(new URL('../dist/', import.meta.url)));
}
