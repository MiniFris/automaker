import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { RETIRED_CREDENTIAL_WRITE } from '@automaker/contracts';
import { nativeSettings } from '../../helpers/native-settings.js';
it('keeps the native credentials endpoint a tombstone without inspecting or reflecting the body', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'retired-credentials-'));
  const fixture = await nativeSettings(directory);
  try {
    for (const body of [{ secret: 'DO_NOT_REFLECT' }, ['legacy', 'DO_NOT_REFLECT']]) {
      const response = await fetch(fixture.origin + '/api/settings/credentials', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(410);
      expect(await response.json()).toEqual(RETIRED_CREDENTIAL_WRITE);
    }
  } finally {
    await fixture.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
