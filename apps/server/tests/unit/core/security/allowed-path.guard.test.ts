import { describe, expect, it, vi } from 'vitest';
import { AllowedPathGuard } from '../../../../src/core/security/allowed-path.guard.js';

function context(body: Record<string, unknown>) {
  return {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ body, query: {}, params: {}, method: 'POST', path: '/test' }),
    }),
  };
}

describe('AllowedPathGuard', () => {
  it('supports optional path and path-array descriptors', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(['projectPath?', 'imagePaths[]']),
    };
    const security = { validateLocalPath: vi.fn() };
    const guard = new AllowedPathGuard(reflector as never, security as never);

    expect(
      guard.canActivate(context({ imagePaths: ['/tmp/one.png', '/tmp/two.png'] }) as never)
    ).toBe(true);
    expect(security.validateLocalPath).toHaveBeenCalledTimes(2);
  });

  it('fails closed when an array descriptor receives a non-array value', () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(['imagePaths[]']) };
    const guard = new AllowedPathGuard(reflector as never, {
      validateLocalPath: vi.fn(),
    } as never);

    expect(() => guard.canActivate(context({ imagePaths: '/tmp/one.png' }) as never)).toThrow(
      'imagePaths must be an array of path strings'
    );
  });
});
