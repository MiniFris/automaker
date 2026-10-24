#!/usr/bin/env node

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkServerPerformance, extraResources } from './server-performance-budget.mjs';

let assertBudget = false,
  outputPath;
for (let index = 2; index < process.argv.length; index++) {
  const option = process.argv[index];
  if (option === '--assert-budget') assertBudget = true;
  else if (
    option === '--output' &&
    process.argv[index + 1] &&
    !process.argv[index + 1].startsWith('--')
  )
    outputPath = resolve(process.argv[++index]);
  else
    throw new Error('Usage: measure-server-baseline.mjs [--assert-budget] [--output report.json]');
}

const repositoryRoot = resolve(import.meta.dirname, '..');
const dataDirectory = await mkdtemp(join(tmpdir(), 'automaker-server-baseline-'));
let application,
  confirmedClosed = false;
const quantile = (values, percentile) => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * percentile))];
};

try {
  // Prime the runner's own stdout/stderr before measuring resource deltas. Extra
  // child pipes still count as leaks; don't ignore every PipeWrap by resource type.
  void process.stdin;
  process.stdout.write('');
  process.stderr.write('');
  await new Promise((resolve) => setImmediate(resolve));
  const baselineResources = process.getActiveResourcesInfo();
  // This driver imports the factory as a library, even when invoked from a test
  // shell that exports the explicit main-entry opt-in used by signal fixtures.
  delete process.env.AUTOMAKER_RUN_MAIN;
  const importedAt = performance.now();
  const serverModule = await import(
    pathToFileURL(join(repositoryRoot, 'apps/server/dist/main.js')).href
  );
  const importDurationMs = performance.now() - importedAt;
  const compositionStartedAt = performance.now();
  application = await serverModule.createNestApplication({
    host: '127.0.0.1',
    port: 0,
    dataDir: dataDirectory,
    workingDirectory: dataDirectory,
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      ALLOWED_ROOT_DIRECTORY: dataDirectory,
      AUTOMAKER_API_KEY: 'automaker-baseline-fixture',
      ENABLE_REQUEST_LOGGING: 'false',
      HOME: join(dataDirectory, 'home'),
      USERPROFILE: join(dataDirectory, 'home'),
      XDG_CONFIG_HOME: join(dataDirectory, 'config'),
      PATH: '/usr/bin:/bin',
    },
  });
  const compositionDurationMs = performance.now() - compositionStartedAt;
  const startedAt = performance.now();
  await application.start();
  const startupDurationMs = performance.now() - startedAt;
  const address = application.app.getHttpServer().address();
  if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP port.');
  const durations = [];
  for (let index = 0; index < 100; index++) {
    const requestAt = performance.now();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error(`Health request failed with ${response.status}.`);
    await response.arrayBuffer();
    durations.push(performance.now() - requestAt);
  }
  const memory = process.memoryUsage();
  const shutdownAt = performance.now();
  await application.app.close();
  confirmedClosed = true;
  const shutdownDurationMs = performance.now() - shutdownAt;
  await new Promise((resolve) => setImmediate(resolve));
  const activeResourcesAfterShutdown = process.getActiveResourcesInfo();
  const measurement = {
    mode: 'nestjs',
    measuredAt: new Date().toISOString(),
    node: process.version,
    samples: durations.length,
    importDurationMs,
    compositionDurationMs,
    startupDurationMs,
    healthLatencyMs: { p50: quantile(durations, 0.5), p95: quantile(durations, 0.95) },
    memoryBytes: { rss: memory.rss, heapUsed: memory.heapUsed, external: memory.external },
    shutdownDurationMs,
    activeResourcesAfterShutdown,
    unexpectedResourcesAfterShutdown: extraResources(
      baselineResources,
      activeResourcesAfterShutdown
    ),
  };
  const report = assertBudget
    ? { ...measurement, budget: checkServerPerformance(measurement) }
    : measurement;
  const json = JSON.stringify(report, null, 2) + '\n';
  if (outputPath) await writeFile(outputPath, json, { mode: 0o600 });
  console.log(json.trimEnd());
  if (assertBudget && !report.budget.passed) process.exitCode = 1;
} finally {
  if (application && !confirmedClosed) {
    await application.app.close();
    confirmedClosed = true;
  }
  if (confirmedClosed) await rm(dataDirectory, { recursive: true, force: true });
  else
    console.error(`Benchmark profile retained because cleanup was not confirmed: ${dataDirectory}`);
}

// Exit naturally: the CI job deadline catches handles the application failed to release.
