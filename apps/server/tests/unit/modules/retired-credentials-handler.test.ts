import { expect, it, vi } from 'vitest';
import { createUpdateCredentialsHandler } from '@/routes/settings/routes/update-credentials.js';
import { RETIRED_CREDENTIAL_WRITE } from '@automaker/contracts';
it('keeps the compatibility handler as a tombstone without inspecting or reflecting the body', async () => {
  const request = Object.defineProperty({}, 'body', {
    get: () => {
      throw new Error('Body must not be read');
    },
  });
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await createUpdateCredentialsHandler()(request as never, response as never);
  expect(response.status).toHaveBeenCalledWith(410);
  expect(response.json).toHaveBeenCalledWith(RETIRED_CREDENTIAL_WRITE);
});
