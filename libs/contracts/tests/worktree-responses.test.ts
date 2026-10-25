import { expect, it } from 'vitest';
import type { z } from 'zod';
import * as responses from '../src/domains/worktree-responses.js';
import {
  worktreeResponseFixtures,
  worktreeResponseSchemaName,
  worktreeEnvironment,
} from './worktree-response-fixtures.js';
import { worktreeRoutes } from './worktree-route-fixtures.js';

import { malformedWorktreeResponse } from './worktree-malformed-fixture.js';
const schemas = responses as unknown as Record<string, z.ZodType>;
it('has a real fixture and response schema for each of the 59 native JSON handlers', () => {
  expect(worktreeRoutes).toHaveLength(59);
  expect(Object.keys(worktreeResponseFixtures)).toHaveLength(59);
  expect(new Set(worktreeRoutes.map((route) => route.method)).size).toBe(59);
});
it.each(worktreeRoutes)('preserves actual wire fixture for $method', ({ method }) => {
  const value = worktreeResponseFixtures[method];
  expect(value).toBeDefined();
  expect(schemas[worktreeResponseSchemaName(method)]!.parse(value)).toEqual(value);
});
it.each(worktreeRoutes)('rejects malformed owned nested field for $method', ({ method }) => {
  expect(
    schemas[worktreeResponseSchemaName(method)]!.safeParse(
      malformedWorktreeResponse(worktreeResponseFixtures[method])
    ).success
  ).toBe(false);
});
it('preserves opaque historical pinned metadata and unvalidated gh payload fields', () => {
  const value = {
    success: true,
    executionEnvironment: worktreeEnvironment,
    worktrees: [
      {
        path: '/owned',
        runtimePath: '/owned',
        branch: { historic: true },
        isMain: false,
        isCurrent: false,
        hasWorktree: true,
        metadataOnly: true,
        executionEnvironment: { ...worktreeEnvironment, type: 17, pinned: true },
        pr: { old: [1] },
      },
    ],
  };
  expect(responses.WorktreeListResponseSchema.parse(value)).toEqual(value);
  const pr = {
    success: true,
    executionEnvironment: worktreeEnvironment,
    result: {
      hasPR: true,
      ghCliAvailable: true,
      prInfo: { title: 7, number: 'legacy', extra: { raw: true } },
    },
  };
  expect(responses.WorktreePrInfoResponseSchema.parse(pr)).toEqual(pr);
});
it('preserves managed process descriptors, nullable terminal and local no-op/conflict branches', () => {
  const result = {
    sessionId: 'managed-dev-fixture',
    worktreePath: '/owned',
    port: 45000,
    url: 'https://preview.invalid',
    urlDetected: false,
    startedAt: 'now',
    logs: '',
    command: 'offline',
    isRunning: false,
    error: 'Unknown cleanup',
    exitCode: null,
    preserveUrlHost: true,
    executionEnvironment: { ...worktreeEnvironment, type: 'ssh' },
  };
  expect(responses.WorktreeDevLogsResponseSchema.parse({ success: true, result })).toEqual({
    success: true,
    result,
  });
  expect(
    responses.WorktreeListDevResponseSchema.parse({ success: true, result: { servers: [result] } })
  ).toEqual({ success: true, result: { servers: [result] } });
  expect(
    responses.WorktreeDefaultTerminalResponseSchema.parse({ success: true, result: null })
  ).toEqual({ success: true, result: null });
});
