import { describe, expect, it } from 'vitest';
import { TerminalAccessService } from '../../../src/modules/terminal/terminal-access.service.js';

const config = (password?: string) =>
  ({ terminal: { enabled: true, password, maxSessions: 10 } }) as never;

describe('TerminalAccessService', () => {
  it('does not issue a token when terminal password protection is disabled', () => {
    const access = new TerminalAccessService(config());

    expect(access.authenticate(undefined)).toEqual({
      status: 200,
      body: { success: true, data: { authenticated: true, passwordRequired: false } },
    });
    access.onApplicationShutdown();
  });

  it('owns issuance, validation and revocation of terminal tokens', () => {
    const access = new TerminalAccessService(config('secret'));

    expect(access.authenticate('wrong').status).toBe(401);
    const result = access.authenticate('secret');
    const token = (result.body as { data: { token: string } }).data.token;
    expect(access.validate(token)).toBe(true);
    access.logout(token);
    expect(access.validate(token)).toBe(false);
    access.onApplicationShutdown();
  });
});
