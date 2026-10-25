import type * as SecureFilesystem from '../lib/secure-fs.js';
import type { FeatureRunPort } from './agent-executor-types.js';

/** App-owned local IO, supplied by native composition rather than process globals. */
export type ExecutionFilesystem = Pick<
  typeof SecureFilesystem,
  | 'access'
  | 'readFile'
  | 'readdir'
  | 'mkdir'
  | 'writeFile'
  | 'appendFile'
  | 'unlink'
  | 'lstat'
  | 'rename'
  | 'copyFile'
>;

/** Memory/context utilities can write while loading: retain the captured run owner. */
export function capturedExecutionFilesystem(
  filesystem: ExecutionFilesystem,
  port: FeatureRunPort
): Pick<
  ExecutionFilesystem,
  'access' | 'readFile' | 'readdir' | 'mkdir' | 'writeFile' | 'appendFile'
> {
  const mutate = async <T>(write: () => Promise<T>): Promise<T> => {
    let result!: T;
    await port.mutate(async () => {
      result = await write();
    });
    return result;
  };
  return {
    access: (...args) => filesystem.access(...args),
    readFile: (...args) => filesystem.readFile(...args),
    get readdir() {
      return filesystem.readdir.bind(filesystem);
    },
    mkdir: (...args) => mutate(() => filesystem.mkdir(...args)),
    writeFile: (...args) => mutate(() => filesystem.writeFile(...args)),
    appendFile: (...args) => mutate(() => filesystem.appendFile(...args)),
  };
}
