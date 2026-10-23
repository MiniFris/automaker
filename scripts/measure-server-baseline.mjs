#!/usr/bin/env node

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repositoryRoot = resolve(import.meta.dirname, '..');
const dataDirectory = await mkdtemp(join(tmpdir(), 'automaker-server-baseline-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = dataDirectory;
process.env.AUTOMAKER_API_KEY = 'automaker-baseline-api-key';
process.env.ENABLE_REQUEST_LOGGING = 'false';

const quantile = (values, percentile) => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * percentile))];
};

const importedAt = performance.now();
const { createLegacyApplication } = await import(
  pathToFileURL(join(repositoryRoot, 'apps/server/dist/legacy-application.js')).href
);
const importDurationMs = performance.now() - importedAt;
const application = createLegacyApplication({
  host: '127.0.0.1',
  port: 0,
  runStartupTasks: false,
});

try {
  const startedAt = performance.now();
  await application.start();
  const startupDurationMs = performance.now() - startedAt;
  const address = application.server.address();
  if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP port.');

  const durations = [];
  for (let index = 0; index < 100; index += 1) {
    const requestAt = performance.now();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    if (!response.ok) throw new Error(`Health request failed with ${response.status}.`);
    await response.arrayBuffer();
    durations.push(performance.now() - requestAt);
  }

  const memory = process.memoryUsage();
  const shutdownAt = performance.now();
  await application.shutdown('baseline measurement');
  const shutdownDurationMs = performance.now() - shutdownAt;
  await new Promise((resolve) => setImmediate(resolve));
  const activeResourcesAfterShutdown = process.getActiveResourcesInfo();

  console.log(
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        node: process.version,
        samples: durations.length,
        importDurationMs,
        startupDurationMs,
        healthLatencyMs: {
          p50: quantile(durations, 0.5),
          p95: quantile(durations, 0.95),
        },
        memoryBytes: {
          rss: memory.rss,
          heapUsed: memory.heapUsed,
          external: memory.external,
        },
        shutdownDurationMs,
        activeResourcesAfterShutdown,
      },
      null,
      2
    )
  );
} finally {
  if (application.server.listening) await application.shutdown('baseline cleanup');
  await rm(dataDirectory, { recursive: true, force: true });
}

// Legacy singleton services install process-level handles outside the application
// lifecycle. Reporting them is the purpose of this baseline; do not let them hang CI.
process.exit(0);
