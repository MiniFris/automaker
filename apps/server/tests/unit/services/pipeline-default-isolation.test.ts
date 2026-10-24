import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { PipelineService } from '../../../src/services/pipeline-service.js';

it.each(['missing', 'malformed', 'partial'])(
  'never shares pipeline steps from %s config across projects or returned configs',
  async (kind) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'automaker-pipeline-default-'));
    try {
      const one = path.join(directory, 'one'),
        two = path.join(directory, 'two'),
        three = path.join(directory, 'three');
      if (kind !== 'missing') {
        const file = path.join(one, '.automaker', 'pipeline.json');
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, kind === 'partial' ? '{"version":1}' : '{');
      }
      const first = new PipelineService(),
        second = new PipelineService();
      const step = await first.addStep(one, {
        name: 'Owned fixture',
        order: 0,
        instructions: 'Do not execute',
        colorClass: 'blue',
      });
      const empty = await second.getPipelineConfig(two);
      expect(empty.steps).toEqual([]);
      empty.steps.push(step);
      expect((await first.getPipelineConfig(three)).steps).toEqual([]);
      expect((await second.getPipelineConfig(two)).steps).toEqual([]);
      expect((await first.getPipelineConfig(one)).steps.map(({ id }) => id)).toEqual([step.id]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
