import { afterEach, expect, it, vi } from 'vitest';
import { FeatureLoader, type FeatureFilesystem } from '../../../src/services/feature-loader.js';

afterEach(() => vi.useRealTimers());
it('bounds native admission and retains a failed close after an unconfirmed write deadline', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const filesystem = {
    mkdir: vi.fn().mockResolvedValue(undefined),
    lstat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    writeFile: vi.fn(() => held),
    rename: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn(),
  } as unknown as FeatureFilesystem;
  const loader = new FeatureLoader({ filesystem, canonicalProject: (project) => project });
  const accepted = Array.from({ length: 256 }, (_, index) =>
    loader.saveAgentOutput('/project', 'feature-' + index, 'owned')
  );
  await expect(loader.saveAgentOutput('/project', 'over-capacity', 'late')).rejects.toThrow('busy');
  const closing = loader.beforeApplicationShutdown();
  const refused = expect(closing).rejects.toMatchObject({ code: 'FEATURE_STORAGE_CLEANUP_FAILED' });
  await vi.advanceTimersByTimeAsync(5000);
  await refused;
  await expect(loader.saveAgentOutput('/project', 'after-close', 'late')).rejects.toThrow(
    'shutting down'
  );
  release();
  await Promise.all(accepted);
  expect(loader.beforeApplicationShutdown()).toBe(closing);
  await expect(loader.beforeApplicationShutdown()).rejects.toMatchObject({
    code: 'FEATURE_STORAGE_CLEANUP_FAILED',
  });
});
