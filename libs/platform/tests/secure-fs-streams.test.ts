import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSecureFs } from '../src/secure-fs.js';

describe('owned filesystem streams', () => {
  let root: string;
  const owners: ReturnType<typeof createSecureFs>[] = [];
  const releases: Array<() => void> = [];
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-stream-'));
  });
  afterEach(async () => {
    releases.splice(0).forEach((release) => release());
    await Promise.allSettled(owners.splice(0).map((owner) => owner.close()));
    await fs.rm(root, { recursive: true, force: true });
  });
  function owner(directory = root) {
    const filesystem = createSecureFs((candidate) => {
      const absolute = path.resolve(candidate);
      if (absolute !== directory && !absolute.startsWith(directory + path.sep))
        throw new Error('Denied fixture path.');
      return absolute;
    });
    owners.push(filesystem);
    return filesystem;
  }
  function sink() {
    const chunks: Buffer[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        chunks.push(chunk);
        done();
      },
    });
    return { stream, content: () => Buffer.concat(chunks).toString('utf8') };
  }

  it('limits a file stream to the admitted length, including zero-length files', async () => {
    const filesystem = owner(),
      target = path.join(root, 'file');
    await fs.writeFile(target, 'abcdef');
    const first = sink();
    await filesystem.pipeFile(target, first.stream, { maxBytes: 3 });
    expect(first.content()).toBe('abc');
    const empty = sink();
    await filesystem.pipeFile(target, empty.stream, { maxBytes: 0 });
    expect(empty.content()).toBe('');
    expect(filesystem.getActiveOperations()).toBe(0);
  });

  it('owns the descriptor and backpressure until the actual pipeline settles', async () => {
    const filesystem = owner(),
      target = path.join(root, 'file');
    await fs.writeFile(target, 'owned');
    let release!: () => void, enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const destination = new Writable({
      write(_chunk, _encoding, done) {
        release = done;
        releases.push(done);
        enter();
      },
    });
    const transfer = filesystem.pipeFile(target, destination);
    await entered;
    const close = filesystem.close();
    let closed = false;
    void close.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(filesystem.getActiveOperations()).toBe(1);
    release();
    releases.length = 0;
    await transfer;
    await close;
    expect(filesystem.getActiveOperations()).toBe(0);
  });

  it('caps actual bytes written and closes the file on stream failure', async () => {
    const filesystem = owner(),
      target = path.join(root, 'archive');
    await expect(
      filesystem.writeStream(target, Readable.from([Buffer.from('abc'), Buffer.from('def')]), {
        maxBytes: 4,
      })
    ).rejects.toMatchObject({ code: 'STREAM_BYTE_LIMIT' });
    expect((await fs.stat(target)).size).toBeLessThanOrEqual(4);
    expect(filesystem.getActiveOperations()).toBe(0);
    await filesystem.writeStream(path.join(root, 'private'), Readable.from(['safe']), {
      maxBytes: 4,
    });
    if (process.platform !== 'win32')
      expect((await fs.stat(path.join(root, 'private'))).mode & 0o777).toBe(0o600);
  });

  it('keeps policy and shutdown independent across owners', async () => {
    const first = owner(path.join(root, 'first')),
      second = owner(path.join(root, 'second'));
    await fs.mkdir(path.join(root, 'second'));
    const target = path.join(root, 'second', 'file');
    await fs.writeFile(target, 'second');
    await expect(first.pipeFile(target, sink().stream)).rejects.toThrow('Denied fixture path');
    await first.close();
    const output = sink();
    await second.pipeFile(target, output.stream);
    expect(output.content()).toBe('second');
  });

  it('admits a read/write transfer with one queue slot and revokes its stream scope', async () => {
    const filesystem = owner();
    filesystem.configureThrottling({ maxConcurrency: 1 });
    const source = path.join(root, 'source'),
      target = path.join(root, 'copy');
    await fs.writeFile(source, 'owned');
    let escaped: { pipeFile: typeof filesystem.pipeFile } | undefined;
    await filesystem.withFileStreams(async (streams) => {
      escaped = streams;
      expect(filesystem.getActiveOperations()).toBe(1);
      const through = new PassThrough();
      const written = streams.writeStream(target, through, { maxBytes: 5 });
      await streams.pipeFile(source, through);
      await written;
    });
    expect(await fs.readFile(target, 'utf8')).toBe('owned');
    await expect(escaped!.pipeFile(source, sink().stream)).rejects.toThrow('scope is closed');
  });

  it('aborts a stalled pipeline and releases its real file descriptor', async () => {
    const filesystem = owner(),
      target = path.join(root, 'file');
    await fs.writeFile(target, 'owned');
    const controller = new AbortController();
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const destination = new Writable({
      write(_chunk, _encoding, _done) {
        enter();
      },
    });
    const transfer = filesystem.pipeFile(target, destination, { signal: controller.signal });
    await entered;
    controller.abort();
    await expect(transfer).rejects.toMatchObject({ name: 'AbortError' });
    expect(destination.destroyed).toBe(true);
    expect(filesystem.getActiveOperations()).toBe(0);
    await filesystem.close();
  });
});
