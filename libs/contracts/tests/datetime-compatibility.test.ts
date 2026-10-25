import { describe, expect, it } from 'vitest';
import { EventListRequestSchema } from '../src/domains/event-history.js';
import { FilesStatResponseSchema } from '../src/domains/files-responses.js';
import { HealthResponseSchema } from '../src/health.js';

function results(timestamp: string) {
  return [
    EventListRequestSchema.safeParse({
      projectPath: '/projects/example',
      filter: { since: timestamp, until: timestamp },
    }),
    HealthResponseSchema.safeParse({ status: 'ok', version: '1.0.0', timestamp }),
    FilesStatResponseSchema.safeParse({
      success: true,
      stats: { isDirectory: false, isFile: true, size: 0, mtime: timestamp },
    }),
  ];
}

describe('UTC timestamp wire compatibility after Zod updates', () => {
  it.each([
    '2026-10-25T18:30Z',
    '2026-10-25T18:30:00Z',
    '2026-10-25T18:30:00.123456Z',
    '2024-02-29T00:00Z',
  ])('preserves the existing accepted timestamp %s', (timestamp) => {
    expect(results(timestamp).map((result) => result.success)).toEqual([true, true, true]);
  });

  it.each([
    '2026-02-29T00:00Z',
    '2026-10-25T24:00Z',
    '2026-10-25T18:30',
    '2026-10-25T18:30:00+03:00',
    'invalid',
  ])('continues rejecting invalid or non-UTC timestamp %s', (timestamp) => {
    expect(results(timestamp).map((result) => result.success)).toEqual([false, false, false]);
  });
});
