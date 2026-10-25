import { expect, it, vi } from 'vitest';
import { inspectLegacyCredentials } from '@/lib/legacy-credential-import';
it('supports old flat and Zustand records without changing their source', () => {
  for (const raw of [
    JSON.stringify({
      apiKeys: {
        anthropic: 'fixture-anthropic',
        google: 'fixture-google',
        openai: '',
        unknown: 'not-supported',
      },
    }),
    JSON.stringify({
      state: { apiKeys: { anthropic: 'fixture-anthropic', google: 'fixture-google' } },
    }),
  ])
    expect(inspectLegacyCredentials(raw)).toEqual({
      anthropic: 'fixture-anthropic',
      google: 'fixture-google',
    });
});
it.each([
  'invalid-private-token',
  '[]',
  '{"state":[]}',
  '{"apiKeys":[]}',
  'x'.repeat(1024 * 1024 + 1),
])('rejects malformed/oversized data without reflecting private input (%#)', (raw) => {
  let message = '';
  try {
    inspectLegacyCredentials(raw);
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).not.toBe('');
  expect(message).not.toContain('private-token');
});
it('does not treat prototype names as supported providers', () => {
  expect(
    inspectLegacyCredentials('{"apiKeys":{"__proto__":"private","constructor":"private"}}')
  ).toEqual({});
  expect(inspectLegacyCredentials(null)).toEqual({});
});
it('ignores inherited state fields and inherited provider values', () => {
  const parse = vi.spyOn(JSON, 'parse');
  try {
    parse.mockReturnValueOnce(Object.create({ apiKeys: { google: 'private-inherited' } }));
    expect(inspectLegacyCredentials('{}')).toEqual({});
    parse.mockReturnValueOnce({ apiKeys: Object.create({ google: 'private-inherited' }) });
    expect(inspectLegacyCredentials('{}')).toEqual({});
  } finally {
    parse.mockRestore();
  }
});
