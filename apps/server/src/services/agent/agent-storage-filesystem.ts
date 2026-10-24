import type { AtomicWriteFilesystem } from '@automaker/utils';
import type * as secureFs from '../../lib/secure-fs.js';

/** Explicit application-owned storage boundary; formats and recovery policy belong to each store. */
export type AgentStorageFilesystem = AtomicWriteFilesystem & Pick<typeof secureFs, 'readdir'>;
