import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { secureFs } from '@automaker/platform';
import { unzipSync } from 'fflate';
import {
  writeLocalArchive,
  type ArchiveEntry,
} from '../../../src/modules/files/local-zip-archive.js';

let root: string;
let filesystem: ReturnType<typeof secureFs.createSecureFs>;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-metadata-'));
  filesystem = secureFs.createSecureFs((candidate) => {
    const absolute = path.resolve(candidate);
    if (!absolute.startsWith(root + path.sep)) throw new Error('Denied fixture path.');
    return absolute;
  });
});
afterEach(async () => {
  await filesystem.close();
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

it('keeps a many-empty-entry ZIP workload within a bounded array-buffer footprint', async () => {
  const entries: ArchiveEntry[] = Array.from({ length: 2000 }, (_, index) => ({
    name: `empty/${index}`,
    source: path.join(root, String(index)),
    bytes: 0,
    directory: true,
    mode: 0o40700,
    modified: new Date(2020, 0, 1),
  }));
  const baseline = process.memoryUsage().arrayBuffers;
  let peak = baseline;
  const scope = filesystem.withFileStreams.bind(filesystem);
  vi.spyOn(filesystem, 'withFileStreams').mockImplementation((operation) =>
    scope((streams) =>
      operation({
        ...streams,
        writeStream(file, source, options) {
          source.on('data', () => {
            peak = Math.max(peak, process.memoryUsage().arrayBuffers);
          });
          return streams.writeStream(file, source, options);
        },
      })
    )
  );
  filesystem.configureThrottling({ maxConcurrency: 1 });
  const target = path.join(root, 'archive.zip');
  await writeLocalArchive(filesystem, entries, target, 1024 * 1024, new AbortController().signal);
  expect(Object.keys(unzipSync(await fs.readFile(target)))).toHaveLength(2000);
  // A retained 96 KiB compressor per empty entry would exceed 187 MiB here.
  expect(peak - baseline).toBeLessThan(32 * 1024 * 1024);
});
