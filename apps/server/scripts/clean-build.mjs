import { rm } from 'node:fs/promises';

// TypeScript does not remove outputs for deleted sources. Always rebuild the
// generated server artifact so retired entrypoints/adapters cannot be packaged.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
