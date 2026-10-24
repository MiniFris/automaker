import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  NodeLegacyElectronProfileSource,
  resolveLegacyProfileDirectory,
} from '../../../src/core/platform/legacy-electron-profile.source.js';

it.each([
  ['linux', '/owned/home', {}, '/owned/home/.config/Automaker'],
  ['linux', undefined, { XDG_CONFIG_HOME: '/owned/config' }, '/owned/config/Automaker'],
  [
    'darwin',
    '/owned/home',
    { XDG_CONFIG_HOME: '/ignored' },
    '/owned/home/Library/Application Support/Automaker',
  ],
  ['win32', 'C:\\Users\\fixture', {}, 'C:\\Users\\fixture\\AppData\\Roaming\\Automaker'],
  ['win32', undefined, { APPDATA: 'C:\\Config' }, 'C:\\Config\\Automaker'],
] as const)(
  'uses only supplied host config (%s, %s)',
  (platform, homeDirectory, environment, expected) => {
    expect(resolveLegacyProfileDirectory({ platform, homeDirectory }, environment)).toBe(expected);
  }
);
it('does not fall back to the operator home or accept relative profile configuration', () => {
  expect(resolveLegacyProfileDirectory({ platform: 'linux' }, {})).toBeUndefined();
  expect(() =>
    resolveLegacyProfileDirectory({ platform: 'linux' }, { XDG_CONFIG_HOME: 'relative' })
  ).toThrow('absolute');
});

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
it('pins the profile identity, refuses traversal and closes a read handle on source replacement', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-source-'));
  roots.push(root);
  const profile = path.join(root, 'Automaker');
  await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, 'settings.json'), '{}');
  const source = new NodeLegacyElectronProfileSource(
    { platform: 'linux' },
    { XDG_CONFIG_HOME: root }
  );
  await source.inventory();
  await expect(source.read('../outside')).rejects.toThrow('Unsupported');
  await expect(source.read('unselected.json')).rejects.toThrow('Unsupported');
  await fs.rename(profile, path.join(root, 'previous'));
  await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, 'settings.json'), '{"changed":true}');
  await expect(source.read('settings.json')).rejects.toThrow('identity changed');
});
