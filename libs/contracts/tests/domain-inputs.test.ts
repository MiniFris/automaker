import { describe, expect, it } from 'vitest';
import { WorktreeStageFilesSchema, DevSessionSchema } from '../src/domains/worktree.js';
import { AgentSendSchema } from '../src/domains/agent.js';
import { IdeaCreateSchema } from '../src/domains/ideation.js';
import { LoginRequestSchema } from '../src/domains/auth.js';

describe('shared domain inputs', () => {
  it('rejects malformed mutations before execution', () => {
    expect(
      WorktreeStageFilesSchema.safeParse({
        worktreePath: '/project',
        files: [],
        operation: 'stage',
      }).success
    ).toBe(false);
    expect(AgentSendSchema.safeParse({ sessionId: '../escape', message: 'hello' }).success).toBe(
      false
    );
    expect(IdeaCreateSchema.safeParse({ projectPath: '/project', idea: {} }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ apiKey: '', surprise: true }).success).toBe(false);
  });

  it('preserves refinements not expressible in JSON Schema', () => {
    expect(DevSessionSchema.safeParse({}).success).toBe(false);
    expect(DevSessionSchema.safeParse({ worktreePath: '/project' }).success).toBe(true);
    expect(DevSessionSchema.safeParse({ sessionId: 'session-1' }).success).toBe(true);
  });
});
