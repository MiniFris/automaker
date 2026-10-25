import { expect, it } from 'vitest';
import { z } from 'zod';
import * as files from '../src/domains/files-responses.js';
import * as git from '../src/domains/git-responses.js';

const environment = {
  type: 'local',
  projectPath: '/fixture',
  path: '/fixture',
  runtimeCwd: '/fixture',
  root: '/fixture',
  targetId: 'opaque',
  pinned: false,
};

it('normalizes native stat dates to the existing JSON wire value and publishes an ISO output schema', () => {
  const date = new Date('2001-02-03T04:05:06.000Z');
  const response = {
    success: true,
    stats: { isDirectory: false, isFile: true, size: 0, mtime: date },
    future: true,
  };
  expect(files.FilesStatResponseSchema.parse(response)).toEqual({
    ...response,
    stats: { ...response.stats, mtime: date.toJSON() },
  });
  expect(JSON.stringify(files.FilesStatResponseSchema.parse(response))).toBe(
    JSON.stringify(response)
  );
  expect(
    z.toJSONSchema(files.FilesStatResponseSchema, { io: 'output' }).properties?.stats
  ).toMatchObject({ properties: { mtime: { type: 'string', format: 'date-time' } } });
});

it('preserves empty/false/null filesystem replies and checks nested owned envelopes', () => {
  files.FilesReadResponseSchema.parse({ success: true, content: '' });
  files.FilesListResponseSchema.parse({
    success: true,
    entries: [{ name: 'opaque []', isDirectory: false, isFile: false }],
  });
  files.FilesExistsResponseSchema.parse({ success: true, exists: false });
  files.FilesBrowseResponseSchema.parse({
    success: true,
    currentPath: '/',
    parentPath: null,
    directories: [],
    drives: [],
    warning: 'Permission denied - unable to read this directory',
  });
  files.FilesBrowseProjectResponseSchema.parse({
    success: true,
    currentRelativePath: '',
    parentRelativePath: null,
    entries: [],
  });
  for (const [schema, value] of [
    [files.FilesSuccessResponseSchema, { success: false }],
    [files.FilesReadResponseSchema, { success: true, content: null }],
    [files.FilesListResponseSchema, { success: true, entries: [{ name: 'x', isDirectory: true }] }],
    [
      files.FilesStatResponseSchema,
      { success: true, stats: { isDirectory: false, isFile: true, size: 0, mtime: 'invalid' } },
    ],
    [files.FilesExistsResponseSchema, { success: true, exists: 'false' }],
    [files.FilesPathResponseSchema, { success: true }],
    [files.FilesValidatedPathResponseSchema, { success: true, path: '/', isAllowed: false }],
    [
      files.FilesBrowseResponseSchema,
      { success: true, currentPath: '/', parentPath: null, directories: [{}], drives: [] },
    ],
    [
      files.FilesBrowseProjectResponseSchema,
      {
        success: true,
        currentRelativePath: '',
        parentRelativePath: null,
        entries: [{ name: 'x', isFile: true, isDirectory: false }],
      },
    ],
  ] as const)
    expect(schema.safeParse(value).success).toBe(false);
});

it('covers Git environment targets, optional merge state, both details forms and arbitrary Git text', () => {
  for (const type of ['local', 'ssh', 'docker'])
    git.GitEnvironmentResponseSchema.parse({
      success: true,
      executionEnvironment: { ...environment, type },
    });
  git.GitDiffsResponseSchema.parse({
    success: true,
    executionEnvironment: environment,
    files: [],
    hasChanges: false,
    diff: '',
  });
  git.GitDiffsResponseSchema.parse({
    success: true,
    executionEnvironment: environment,
    files: [],
    hasChanges: true,
    diff: '',
    mergeState: {
      isMerging: true,
      mergeOperationType: 'cherry-pick',
      isCleanMerge: false,
      mergeAffectedFiles: ['opaque []'],
      conflictFiles: ['opaque []'],
    },
  });
  git.GitDetailsResponseSchema.parse({
    success: true,
    executionEnvironment: environment,
    details: { branch: 'HEAD' },
  });
  git.GitDetailsResponseSchema.parse({
    success: true,
    executionEnvironment: environment,
    details: {
      branch: 'opaque branch',
      lastCommitHash: '',
      lastCommitMessage: '',
      lastCommitAuthor: '',
      lastCommitTimestamp: '',
      linesAdded: 0,
      linesRemoved: 0,
      isConflicted: false,
      isStaged: false,
      isUnstaged: false,
      statusLabel: '',
    },
  });
  for (const operation of ['stage', 'unstage'])
    git.GitStageFilesResponseSchema.parse({
      success: true,
      executionEnvironment: environment,
      result: { operation, filesCount: 1 },
    });
  for (const [schema, value] of [
    [
      git.GitEnvironmentResponseSchema,
      { success: true, executionEnvironment: { ...environment, pinned: 'false' } },
    ],
    [
      git.GitDiffsResponseSchema,
      { success: true, executionEnvironment: environment, files: [{}], hasChanges: true, diff: '' },
    ],
    [
      git.GitDetailsResponseSchema,
      {
        success: true,
        executionEnvironment: environment,
        details: { branch: 'main', lastCommitHash: 1 },
      },
    ],
    [
      git.GitFileDiffResponseSchema,
      { success: true, executionEnvironment: environment, filePath: 'x', diff: null },
    ],
    [
      git.GitStageFilesResponseSchema,
      {
        success: true,
        executionEnvironment: environment,
        result: { operation: 'stage', filesCount: -1 },
      },
    ],
    [
      git.GitEnhancedStatusResponseSchema,
      { success: true, executionEnvironment: environment, branch: 'HEAD', files: [{}] },
    ],
  ] as const)
    expect(schema.safeParse(value).success).toBe(false);
});
