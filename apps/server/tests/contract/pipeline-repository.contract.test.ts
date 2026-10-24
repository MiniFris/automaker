import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { PipelineService } from '../../src/services/pipeline-service.js';
import { AutoModeServiceCompat } from '../../src/services/auto-mode/index.js';

it('uses one native scoped pipeline repository for HTTP and every AutoMode consumer', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-pipeline-native-'));
  const project = path.join(directory, 'project');
  await mkdir(project);
  const owner = await createNestApplication({
    host: '127.0.0.1',
    port: 0,
    workingDirectory: directory,
    dataDir: path.join(directory, 'data'),
    runStartupTasks: false,
    enableShutdownHooks: false,
    providerRegistrations: [],
    environment: {
      NODE_ENV: 'test',
      AUTOMAKER_API_KEY: 'fixture',
      ALLOWED_ROOT_DIRECTORY: directory,
      ENABLE_REQUEST_LOGGING: 'false',
    },
  });
  try {
    await owner.start();
    const pipeline = owner.app.get(PipelineService);
    const facade = owner.app.get(AutoModeServiceCompat).createFacade(project) as unknown as {
      featureStateManager: { pipeline: PipelineService };
      executionService: { pipeline: PipelineService };
      pipelineOrchestrator: { pipeline: PipelineService };
    };
    expect(facade.featureStateManager.pipeline).toBe(pipeline);
    expect(facade.executionService.pipeline).toBe(pipeline);
    expect(facade.pipelineOrchestrator.pipeline).toBe(pipeline);
    const global = owner.app.get(AutoModeServiceCompat).getGlobalService() as unknown as {
      featureStateManager: { pipeline: PipelineService };
    };
    expect(global.featureStateManager.pipeline).toBe(pipeline);
    await expect(pipeline.getPipelineConfig(path.dirname(directory))).rejects.toMatchObject({
      errorCode: 'FORBIDDEN',
    });
    const port = (owner.app.getHttpServer().address() as { port: number }).port;
    const requests = Array.from({ length: 12 }, (_, index) =>
      fetch(`http://127.0.0.1:${port}/api/pipeline/steps/add`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'fixture' },
        body: JSON.stringify({
          projectPath: project,
          step: {
            name: `Step ${index}`,
            order: index,
            instructions: 'Do not execute',
            colorClass: 'blue',
          },
        }),
      })
    );
    const responses = await Promise.all(requests);
    expect(responses.map(({ status }) => status)).toEqual(Array(12).fill(200));
    for (const response of responses)
      expect(await response.json()).toMatchObject({ success: true });
    expect((await pipeline.getPipelineConfig(project)).steps).toHaveLength(12);
  } finally {
    await owner.app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
