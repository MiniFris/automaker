import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FeatureLoader } from '../../src/services/feature-loader.js';

const fixtureRoot = path.resolve(import.meta.dirname, '../fixtures/storage');
let temporaryRoot: string;
let projectPath: string;

beforeAll(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'automaker-storage-contract-'));
  projectPath = path.join(temporaryRoot, 'project');
  await cp(path.join(fixtureRoot, 'project'), projectPath, { recursive: true });
});

afterAll(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe('legacy storage compatibility fixtures', () => {
  it('loads current global and legacy Electron settings without machine-specific paths', async () => {
    const current = JSON.parse(
      await readFile(path.join(fixtureRoot, 'global-settings-current.json'), 'utf8')
    );
    const legacy = JSON.parse(
      await readFile(path.join(fixtureRoot, 'legacy-electron-settings.json'), 'utf8')
    );

    expect(current.projects[0].path).toBe('/workspace/fixture-project');
    expect(legacy.projects[0].path).toBe('C:\\workspace\\legacy-project');
  });

  it('loads an interrupted project feature and recovers a partially written main file', async () => {
    const loader = new FeatureLoader();
    const [feature] = await loader.getAll(projectPath);
    expect(feature).toMatchObject({ id: 'interrupted-feature', status: 'interrupted' });

    const featurePath = loader.getFeatureJsonPath(projectPath, 'interrupted-feature');
    const valid = await readFile(featurePath, 'utf8');
    await writeFile(`${featurePath}.bak1`, valid);
    await writeFile(featurePath, '{"id":"interrupted-feature"');

    const [recovered] = await loader.getAll(projectPath);
    expect(recovered).toMatchObject({ id: 'interrupted-feature', status: 'interrupted' });
    expect(JSON.parse(await readFile(featurePath, 'utf8')).status).toBe('interrupted');
  });
});
