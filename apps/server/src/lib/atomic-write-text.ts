import crypto from 'node:crypto';
import path from 'node:path';
import { mkdirSafe } from '@automaker/utils';
import * as secureFs from './secure-fs.js';

export async function atomicWriteText(filePath: string, content: string): Promise<void> {
  const target = path.resolve(filePath);
  const temporary = `${target}.tmp.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
  await mkdirSafe(path.dirname(target));
  try {
    await secureFs.writeFile(temporary, content, 'utf-8');
    await secureFs.rename(temporary, target);
  } catch (error) {
    await secureFs.rm(temporary).catch(() => {});
    throw error;
  }
}
