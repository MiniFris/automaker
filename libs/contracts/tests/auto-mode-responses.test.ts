import { expect, it } from 'vitest';
import * as schemas from '../src/domains/auto-mode-responses.js';

it('preserves false outcomes, nullable identifiers, extensions and historical numeric concurrency', () => {
  const samples = [
    [schemas.AutoModeAcceptedResponseSchema, { success: true, future: true }],
    [
      schemas.AutoModeStartResponseSchema,
      { success: true, message: '', branchName: '', alreadyRunning: true },
    ],
    [
      schemas.AutoModeStopResponseSchema,
      { success: true, message: '', branchName: null, wasRunning: false },
    ],
    [
      schemas.AutoModeStopResponseSchema,
      { success: true, message: '', branchName: 'main', runningFeaturesCount: 0 },
    ],
    [schemas.AutoModeStopFeatureResponseSchema, { success: true, stopped: false }],
    [schemas.AutoModeVerificationResponseSchema, { success: true, passes: false }],
    [schemas.AutoModeContextResponseSchema, { success: true, exists: false }],
    [schemas.AutoModeCommitResponseSchema, { success: true, commitHash: null }],
    [schemas.AutoModeApprovalResponseSchema, { success: true, approved: false, message: '' }],
    [schemas.AutoModeReconcileResponseSchema, { success: true, reconciledCount: 0, message: '' }],
    [schemas.PendingPlanApprovalResponseSchema, { success: true, approval: null }],
  ] as const;
  for (const [schema, value] of samples) expect(schema.parse(value)).toEqual(value);
  for (const maxConcurrency of [-1, 0, 1.5]) {
    const value = {
      success: true,
      isRunning: false,
      isAutoLoopRunning: true,
      runningFeatures: [],
      runningCount: 0,
      maxConcurrency,
      projectPath: 'opaque',
      branchName: null,
      future: [],
    };
    expect(schemas.AutoModeStatusResponseSchema.parse(value)).toEqual(value);
  }
  const global = {
    success: true,
    isRunning: true,
    runningFeatures: ['same', 'same'],
    runningCount: 2,
    activeAutoLoopProjects: ['opaque'],
    activeAutoLoopWorktrees: [{ projectPath: 'opaque', branchName: '' }],
  };
  expect(schemas.AutoModeStatusResponseSchema.parse(global)).toEqual(global);
});

it('rejects malformed owned envelopes and uses the existing approval ticket contract', () => {
  for (const [schema, value] of [
    [schemas.AutoModeAcceptedResponseSchema, { success: false }],
    [schemas.AutoModeMessageResponseSchema, { success: true }],
    [schemas.AutoModeStartResponseSchema, { success: true, message: '', branchName: 1 }],
    [schemas.AutoModeStopResponseSchema, { success: true, message: '', branchName: null }],
    [schemas.AutoModeStopFeatureResponseSchema, { success: true, stopped: 'false' }],
    [schemas.AutoModeVerificationResponseSchema, { success: true, passes: 0 }],
    [schemas.AutoModeContextResponseSchema, { success: true, exists: null }],
    [schemas.AutoModeCommitResponseSchema, { success: true, commitHash: 1 }],
    [schemas.AutoModeApprovalResponseSchema, { success: true, approved: false }],
    [schemas.AutoModeReconcileResponseSchema, { success: true, reconciledCount: -1, message: '' }],
    [
      schemas.AutoModeStatusResponseSchema,
      { success: true, isRunning: false, runningFeatures: [], runningCount: 0 },
    ],
    [schemas.PendingPlanApprovalResponseSchema, { success: true, approval: {} }],
  ] as const)
    expect(schema.safeParse(value).success).toBe(false);
  const ticket = { approvalToken: 'token', approvalRunId: 'run', planVersion: 1, planContent: '' };
  expect(
    schemas.PendingPlanApprovalResponseSchema.parse({ success: true, approval: ticket }).approval
  ).toEqual(ticket);
});
