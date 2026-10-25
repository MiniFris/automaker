import { once } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { Zip, ZipPassThrough } from 'fflate';
import type * as Filesystem from '../../lib/secure-fs.js';

export interface ArchiveEntry {
  source: string;
  name: string;
  bytes: number;
  directory: boolean;
  mode: number;
  modified: Date;
}

/** Sequential input and backpressure keep archive memory bounded independently of directory size. */
export async function writeLocalArchive(
  filesystem: typeof Filesystem,
  entries: ArchiveEntry[],
  target: string,
  maxBytes: number,
  signal: AbortSignal
): Promise<void> {
  return filesystem.withFileStreams((streams) =>
    writeArchiveStreams(streams, entries, target, maxBytes, signal)
  );
}

async function writeArchiveStreams(
  filesystem: Pick<typeof Filesystem, 'pipeFile' | 'writeStream'>,
  entries: ArchiveEntry[],
  target: string,
  maxBytes: number,
  signal: AbortSignal
): Promise<void> {
  const output = new PassThrough({ highWaterMark: 64 * 1024 });
  let failure: Error | undefined;
  output.on('error', () => undefined);
  const written = filesystem.writeStream(target, output, { signal, maxBytes, mode: 0o600 });
  void written.catch((error: Error) => {
    failure = error;
    output.destroy(error);
  });
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failure = error;
      output.destroy(error);
      return;
    }
    if (chunk.length) output.write(chunk);
    if (final) output.end();
  });
  const drain = async () => {
    signal.throwIfAborted();
    if (failure) throw failure;
    if (output.writableNeedDrain) await once(output, 'drain', { signal });
    if (failure) throw failure;
  };
  try {
    for (const entry of entries) {
      await drain();
      // fflate retains each input until the central directory is emitted. Stored
      // entries avoid retaining a 96 KiB compressor buffer per empty file/directory.
      const file = new ZipPassThrough(entry.name + (entry.directory ? '/' : ''));
      file.os = 3;
      file.attrs = (entry.mode & 0xffff) << 16;
      file.mtime = new Date(
        Math.max(
          new Date(1980, 0, 1).getTime(),
          Math.min(new Date(2099, 11, 31, 23, 59, 58).getTime(), entry.modified.getTime())
        )
      );
      zip.add(file);
      if (entry.directory) file.push(new Uint8Array(), true);
      else {
        const destination = new Writable({
          write(chunk, _encoding, done) {
            try {
              if (failure) throw failure;
              file.push(chunk);
            } catch (error) {
              done(error as Error);
              return;
            }
            void drain().then(() => done(), done);
          },
          final(done) {
            try {
              if (failure) throw failure;
              file.push(new Uint8Array(), true);
            } catch (error) {
              done(error as Error);
              return;
            }
            void drain().then(() => done(), done);
          },
        });
        await filesystem.pipeFile(entry.source, destination, { signal, maxBytes: entry.bytes });
      }
    }
    zip.end();
    await written;
  } catch (error) {
    zip.terminate();
    output.destroy(error as Error);
    await written.catch(() => undefined);
    throw error;
  }
}
