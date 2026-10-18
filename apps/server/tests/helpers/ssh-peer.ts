import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { Server, utils, type ServerConnection, type ParsedKey } from 'ssh2';

export function testSSHKey() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
}
/** Real SSH authentication, channels, host keys and SFTP; all processes/files belong to the fixture. */
export async function sshPeer(
  root: string,
  privateKey: string,
  hostKey = testSSHKey(),
  port = 0,
  environment: Record<string, string> = {}
) {
  const publicKey = utils.parseKey(privateKey) as ParsedKey;
  const clients = new Set<ServerConnection>(),
    children = new Set<ChildProcessWithoutNullStreams>();
  const commands: string[] = [];
  let authentications = 0;
  await fs.mkdir(root, { recursive: true });
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    client.on('authentication', (context) => {
      authentications++;
      if (
        context.username === 'developer' &&
        context.method === 'publickey' &&
        context.key.data.equals(publicKey.getPublicSSH()) &&
        (!context.signature || publicKey.verify(context.blob!, context.signature, context.hashAlgo))
      )
        context.accept();
      else context.reject();
    });
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept();
        session.on('exec', (accept, _reject, info) => {
          commands.push(info.command);
          const channel = accept();
          const child = spawn('/bin/sh', ['-c', info.command], {
            cwd: root,
            env: { PATH: process.env.PATH, HOME: root, LANG: 'C.UTF-8', ...environment },
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          children.add(child);
          child.on('error', () => {});
          child.stdin.on('error', () => {});
          channel.on('error', () => {});
          channel.stderr.on('error', () => {});
          channel.pipe(child.stdin);
          child.stdout.pipe(channel, { end: false });
          child.stderr.pipe(channel.stderr, { end: false });
          channel.on('close', () => {
            child.stdout.unpipe(channel);
            child.stderr.unpipe(channel.stderr);
            child.stdout.resume();
            child.stderr.resume();
            child.stdin.end();
          });
          child.once('close', (code) => {
            children.delete(child);
            if (!channel.destroyed) {
              channel.exit(code ?? 1);
              channel.end();
            }
          });
        });
        session.on('sftp', (accept) => {
          const sftp = accept();
          const handles = new Map<number, fs.FileHandle>();
          let sequence = 1;
          const answer = (id: number, operation: Promise<unknown>) =>
            void operation.then(
              () => sftp.status(id, utils.sftp.STATUS_CODE.OK),
              (error) =>
                sftp.status(
                  id,
                  (error as NodeJS.ErrnoException).code === 'ENOENT'
                    ? utils.sftp.STATUS_CODE.NO_SUCH_FILE
                    : utils.sftp.STATUS_CODE.FAILURE
                )
            );
          const safe = (file: string) => {
            if (!path.resolve(file).startsWith(root + path.sep)) throw new Error('outside fixture');
            return file;
          };
          sftp.on('OPEN', (id: number, file: string, flags: number, attrs: { mode?: number }) => {
            void fs
              .open(safe(file), utils.sftp.flagsToString(flags) as string, attrs.mode ?? 0o600)
              .then(
                (handle) => {
                  const idBuffer = Buffer.alloc(4);
                  idBuffer.writeUInt32BE(sequence);
                  handles.set(sequence++, handle);
                  sftp.handle(id, idBuffer);
                },
                () => sftp.status(id, utils.sftp.STATUS_CODE.FAILURE)
              );
          });
          sftp.on('WRITE', (id: number, handle: Buffer, offset: number, data: Buffer) =>
            answer(id, handles.get(handle.readUInt32BE())!.write(data, 0, data.length, offset))
          );
          sftp.on('CLOSE', (id: number, handle: Buffer) => {
            const descriptor = handles.get(handle.readUInt32BE());
            handles.delete(handle.readUInt32BE());
            answer(id, descriptor?.close() ?? Promise.reject());
          });
          sftp.on('MKDIR', (id: number, directory: string, attrs: { mode?: number }) =>
            answer(id, fs.mkdir(safe(directory), { mode: attrs.mode }))
          );
          sftp.on('REMOVE', (id: number, file: string) => answer(id, fs.unlink(safe(file))));
          sftp.on('SETSTAT', (id: number, file: string, attrs: { mode?: number }) =>
            answer(
              id,
              attrs.mode === undefined ? Promise.resolve() : fs.chmod(safe(file), attrs.mode)
            )
          );
          sftp.on('SYMLINK', (id: number, target: string, file: string) =>
            answer(id, fs.symlink(target, safe(file)))
          );
          sftp.on('end', () => {
            for (const handle of handles.values()) void handle.close();
            handles.clear();
          });
          sftp.on('error', () => {});
        });
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    port: (server.address() as { port: number }).port,
    commands,
    get authentications() {
      return authentications;
    },
    disconnect: () => {
      for (const client of clients) client.end();
    },
    async close() {
      for (const client of clients) client.end();
      for (const child of children) child.kill('SIGTERM');
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
