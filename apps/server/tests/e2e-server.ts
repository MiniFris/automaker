import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

if (process.env.NODE_ENV === 'production')
  throw new Error('The E2E test server must not run in production.');

// Legacy storage readers still capture DATA_DIR during import. Establish the
// owned test directory before importing any application modules.
const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'automaker-nest-e2e-'));
process.env.DATA_DIR = dataDirectory;
try {
  const { createE2eApplication } = await import('./helpers/e2e-application.js');
  const { app, port } = await createE2eApplication(
    { ...process.env, HOST: '127.0.0.1' },
    dataDirectory
  );
  app.enableShutdownHooks([], { useProcessExit: true });
  try {
    await app.listen(port, '127.0.0.1');
  } catch (error) {
    await app.close();
    throw error;
  }
  console.info(
    JSON.stringify({
      event: 'e2e-ready',
      port: (app.getHttpServer().address() as AddressInfo).port,
      dataDirectory,
    })
  );
} catch (error) {
  await rm(dataDirectory, { recursive: true, force: true });
  throw error;
}
