import { describe, expect, it, vi } from 'vitest';
import { IssueValidationService } from '../../../src/modules/github/issue-validation.service.js';
import { IssueValidationRegistry } from '../../../src/modules/github/issue-validation-registry.service.js';

describe('IssueValidationService', () => {
  it('queries native validation state without an Express handler or response object', async () => {
    const registry = new IssueValidationRegistry();
    const service = new IssueValidationService(
      {} as never,
      {} as never,
      {} as never,
      registry,
      {} as never
    );
    expect(service.status({ projectPath: '/project', issueNumber: 42 })).toEqual({
      success: true,
      isRunning: false,
      startedAt: undefined,
    });
    await registry.onModuleDestroy();
  });

  it('uses the injected repository and emits viewed events only for successfully marked records', async () => {
    const events = { emit: vi.fn() };
    const repository = {
      get: vi.fn().mockResolvedValue({ validation: { issueNumber: 42 }, isStale: false }),
      list: vi.fn().mockResolvedValue([{ issueNumber: 42 }]),
      delete: vi.fn().mockResolvedValue(true),
      markViewed: vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false),
    };
    const registry = new IssueValidationRegistry();
    const service = new IssueValidationService(
      events as never,
      {} as never,
      {} as never,
      registry,
      repository as never
    );
    const input = { projectPath: '/project', issueNumber: 42 };
    expect(await service.stored(input)).toEqual({
      success: true,
      validation: { issueNumber: 42 },
      isStale: false,
    });
    expect(await service.stored({ projectPath: '/project' })).toEqual({
      success: true,
      validations: [{ issueNumber: 42 }],
    });
    expect(await service.markViewed(input)).toEqual({ success: true });
    expect(await service.markViewed(input)).toEqual({ success: false });
    expect(events.emit).toHaveBeenCalledExactlyOnceWith('issue-validation:event', {
      type: 'issue_validation_viewed',
      projectPath: '/project',
      issueNumber: 42,
    });
    expect(await service.delete(input)).toEqual({ success: true, deleted: true });
    expect(repository.get).toHaveBeenCalledWith('/project', 42);
    expect(repository.list).toHaveBeenCalledWith('/project');
    expect(repository.delete).toHaveBeenCalledWith('/project', 42);
    await registry.onModuleDestroy();
  });
});
