import crypto from 'node:crypto';
import path from 'node:path';
import { mkdirSafe } from '@automaker/utils';
import * as secureFs from './secure-fs.js';

export async function atomicWriteText(
  filePath: string,
  content: string,
  filesystem: Pick<typeof secureFs, 'lstat' | 'mkdir' | 'writeFile' | 'rename' | 'rm'> = secureFs
): Promise<void> {
  const target = path.resolve(filePath);
  const temporary = `${target}.tmp.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
  await mkdirSafe(path.dirname(target), filesystem);
  try {
    await filesystem.writeFile(temporary, content, 'utf-8');
    await filesystem.rename(temporary, target);
  } catch (error) {
    await filesystem.rm(temporary).catch(() => {});
    throw error;
  }
}
