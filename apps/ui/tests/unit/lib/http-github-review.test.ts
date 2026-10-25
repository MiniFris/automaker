import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HttpApiClient } from '@/lib/http-api-client';
const request = vi.fn();
const reply = (body: unknown, status = 200) => ({
  ok: status === 200,
  status,
  json: async () => body,
});
beforeEach(() => vi.stubGlobal('fetch', request));
afterEach(() => vi.unstubAllGlobals());
it('does not destroy the application session for a typed domain FORBIDDEN mutation response', async () => {
  request.mockResolvedValue(
    reply({ success: false, errorCode: 'FORBIDDEN', error: 'Thread is not in project' }, 403)
  );
  await expect(
    new HttpApiClient().github.resolveReviewThread('/project', 'PRRT_owned', true)
  ).rejects.toThrow('Thread is not in project');
  expect(request).toHaveBeenCalledOnce();
});
it.each([401, 403])(
  'preserves authentication rejection for legacy/unauthorized responses (%s)',
  async (status) => {
    request.mockResolvedValue(reply({ success: false, error: 'Not authenticated' }, status));
    await expect(
      new HttpApiClient().github.resolveReviewThread('/project', 'PRRT_owned', true)
    ).rejects.toThrow('Unauthorized');
    expect(request.mock.calls.some(([url]) => String(url).endsWith('/api/auth/logout'))).toBe(true);
  }
);
it('does not replay an UNKNOWN_OUTCOME response', async () => {
  request.mockResolvedValue(
    reply({ success: false, errorCode: 'UNKNOWN_OUTCOME', error: 'Outcome unconfirmed' }, 502)
  );
  await expect(
    new HttpApiClient().github.resolveReviewThread('/project', 'PRRT_owned', true)
  ).rejects.toThrow('Outcome unconfirmed');
  expect(request).toHaveBeenCalledOnce();
});
it.each([{}, { isResolved: false }])(
  'does not invent requested state from an unconfirmed successful response (%#)',
  async (extra) => {
    request.mockResolvedValue(reply({ success: true, ...extra }));
    await expect(
      new HttpApiClient().github.resolveReviewThread('/project', 'PRRT_owned', true)
    ).rejects.toThrow('not confirmed');
    expect(request).toHaveBeenCalledOnce();
  }
);
it.each([true, false])('accepts only the confirmed requested state (%s)', async (resolve) => {
  request.mockResolvedValue(reply({ success: true, isResolved: resolve }));
  await expect(
    new HttpApiClient().github.resolveReviewThread('/project', 'PRRT_owned', resolve)
  ).resolves.toEqual({ success: true, isResolved: resolve });
  expect(request).toHaveBeenCalledOnce();
});
