import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('packaged backend inputs', () => {
  it('does not distribute the developer dotenv profile inside release resources', () => {
    const manifest = JSON.parse(
      readFileSync(path.resolve(import.meta.dirname, '../../../package.json'), 'utf8')
    );
    const resources = manifest.build.extraResources as Array<{ from: string; to: string }>;
    expect(resources.some(({ from, to }) => from.endsWith('/.env') || to === '.env')).toBe(false);
    expect(resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'server-bundle/dist', to: 'server' }),
        expect.objectContaining({ from: 'server-bundle/node_modules', to: 'server/node_modules' }),
      ])
    );
  });
});
