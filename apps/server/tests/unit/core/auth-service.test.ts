import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockExpressContext } from '../../utils/mocks.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'path';
import { createTestAuth } from '../../helpers/auth-context.js';

let directory: string;
let fixture: Awaited<ReturnType<typeof createTestAuth>> | undefined;
async function loadAuth() {
  fixture = await createTestAuth(directory, process.env);
  const { auth, state, middleware } = fixture;
  return {
    authMiddleware: middleware,
    createSession: auth.createSession.bind(auth),
    validateSession: state.validateSession.bind(state),
    invalidateSession: auth.invalidateSession.bind(auth),
    createWsConnectionToken: auth.issueWebSocketToken.bind(auth),
    validateWsConnectionToken: auth.consumeWebSocketToken.bind(auth),
    validateApiKey: auth.validateApiKey.bind(auth),
    getSessionCookieName: () => auth.sessionCookieName,
    getSessionCookieOptions: () => auth.sessionCookieOptions,
    isRequestAuthenticated: auth.isRequestAuthenticated.bind(auth),
    checkRawAuthentication: (...args: Parameters<typeof auth.checkAuthentication>) =>
      auth.checkAuthentication(...args).authenticated,
  };
}

describe('instance-scoped authentication', () => {
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-service-unit-'));
    fixture = undefined;
    vi.stubEnv('AUTOMAKER_API_KEY', undefined);
    vi.stubEnv('AUTOMAKER_HIDE_API_KEY', undefined);
    vi.stubEnv('NODE_ENV', undefined);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fixture?.close();
    await fs.rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  describe('authMiddleware', () => {
    it('should reject request without any authentication', async () => {
      const { authMiddleware } = await loadAuth();
      const { req, res, next } = createMockExpressContext();

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Authentication required.',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject request with invalid API key', async () => {
      process.env.AUTOMAKER_API_KEY = 'test-secret-key';

      const { authMiddleware } = await loadAuth();
      const { req, res, next } = createMockExpressContext();
      req.headers['x-api-key'] = 'wrong-key';

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid API key.',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next() with valid API key', async () => {
      process.env.AUTOMAKER_API_KEY = 'test-secret-key';

      const { authMiddleware } = await loadAuth();
      const { req, res, next } = createMockExpressContext();
      req.headers['x-api-key'] = 'test-secret-key';

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should authenticate with session token in header', async () => {
      const { authMiddleware, createSession } = await loadAuth();
      const token = await createSession();
      const { req, res, next } = createMockExpressContext();
      req.headers['x-session-token'] = token;

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should reject invalid session token in header', async () => {
      const { authMiddleware } = await loadAuth();
      const { req, res, next } = createMockExpressContext();
      req.headers['x-session-token'] = 'invalid-token';

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid or expired session token.',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should authenticate with API key in query parameter', async () => {
      process.env.AUTOMAKER_API_KEY = 'test-secret-key';

      const { authMiddleware } = await loadAuth();
      const { req, res, next } = createMockExpressContext();
      req.query.apiKey = 'test-secret-key';

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should authenticate with session cookie', async () => {
      const { authMiddleware, createSession, getSessionCookieName } = await loadAuth();
      const token = await createSession();
      const cookieName = getSessionCookieName();
      const { req, res, next } = createMockExpressContext();
      req.cookies = { [cookieName]: token };

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('createSession', () => {
    it('should create a new session and return token', async () => {
      const { createSession } = await loadAuth();
      const token = await createSession();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should create unique tokens for each session', async () => {
      const { createSession } = await loadAuth();
      const token1 = await createSession();
      const token2 = await createSession();

      expect(token1).not.toBe(token2);
    });
  });

  describe('validateSession', () => {
    it('should validate a valid session token', async () => {
      const { createSession, validateSession } = await loadAuth();
      const token = await createSession();

      expect(validateSession(token)).toBe(true);
    });

    it('should reject invalid session token', async () => {
      const { validateSession } = await loadAuth();

      expect(validateSession('invalid-token')).toBe(false);
    });

    it('should reject expired session token', async () => {
      vi.useFakeTimers();
      const { createSession, validateSession } = await loadAuth();
      const token = await createSession();

      // Advance time past session expiration (30 days)
      vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000);

      expect(validateSession(token)).toBe(false);
      vi.useRealTimers();
    });
  });

  describe('invalidateSession', () => {
    it('should invalidate a session token', async () => {
      const { createSession, validateSession, invalidateSession } = await loadAuth();
      const token = await createSession();

      expect(validateSession(token)).toBe(true);
      await invalidateSession(token);
      expect(validateSession(token)).toBe(false);
    });
  });

  describe('createWsConnectionToken', () => {
    it('should create a WebSocket connection token', async () => {
      const { createWsConnectionToken } = await loadAuth();
      const token = createWsConnectionToken();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should create unique tokens', async () => {
      const { createWsConnectionToken } = await loadAuth();
      const token1 = createWsConnectionToken();
      const token2 = createWsConnectionToken();

      expect(token1).not.toBe(token2);
    });
  });

  describe('validateWsConnectionToken', () => {
    it('should validate a valid WebSocket token', async () => {
      const { createWsConnectionToken, validateWsConnectionToken } = await loadAuth();
      const token = createWsConnectionToken();

      expect(validateWsConnectionToken(token)).toBe(true);
    });

    it('should reject invalid WebSocket token', async () => {
      const { validateWsConnectionToken } = await loadAuth();

      expect(validateWsConnectionToken('invalid-token')).toBe(false);
    });

    it('should reject expired WebSocket token', async () => {
      vi.useFakeTimers();
      const { createWsConnectionToken, validateWsConnectionToken } = await loadAuth();
      const token = createWsConnectionToken();

      // Advance time past token expiration (5 minutes)
      vi.advanceTimersByTime(6 * 60 * 1000);

      expect(validateWsConnectionToken(token)).toBe(false);
      vi.useRealTimers();
    });

    it('should invalidate token after first use (single-use)', async () => {
      const { createWsConnectionToken, validateWsConnectionToken } = await loadAuth();
      const token = createWsConnectionToken();

      expect(validateWsConnectionToken(token)).toBe(true);
      // Token should be deleted after first use
      expect(validateWsConnectionToken(token)).toBe(false);
    });
  });

  describe('validateApiKey', () => {
    it('should validate correct API key', async () => {
      process.env.AUTOMAKER_API_KEY = 'test-secret-key';

      const { validateApiKey } = await loadAuth();

      expect(validateApiKey('test-secret-key')).toBe(true);
    });

    it('should reject incorrect API key', async () => {
      process.env.AUTOMAKER_API_KEY = 'test-secret-key';

      const { validateApiKey } = await loadAuth();

      expect(validateApiKey('wrong-key')).toBe(false);
    });

    it('should reject empty string', async () => {
      process.env.AUTOMAKER_API_KEY = 'test-secret-key';

      const { validateApiKey } = await loadAuth();

      expect(validateApiKey('')).toBe(false);
    });

    it('should reject null/undefined', async () => {
      process.env.AUTOMAKER_API_KEY = 'test-secret-key';

      const { validateApiKey } = await loadAuth();

      expect(validateApiKey(null as any)).toBe(false);
      expect(validateApiKey(undefined as any)).toBe(false);
    });

    it('should use timing-safe comparison for different lengths', async () => {
      process.env.AUTOMAKER_API_KEY = 'test-secret-key';

      const { validateApiKey } = await loadAuth();

      // Key with different length should be rejected without timing leak
      expect(validateApiKey('short')).toBe(false);
      expect(validateApiKey('very-long-key-that-does-not-match')).toBe(false);
    });
  });

  describe('getSessionCookieOptions', () => {
    it('should return cookie options with httpOnly true', async () => {
      const { getSessionCookieOptions } = await loadAuth();
      const options = getSessionCookieOptions();

      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe('lax');
      expect(options.path).toBe('/');
      expect(options.maxAge).toBeGreaterThan(0);
    });

    it('should set secure to true in production', async () => {
      process.env.NODE_ENV = 'production';

      const { getSessionCookieOptions } = await loadAuth();
      const options = getSessionCookieOptions();

      expect(options.secure).toBe(true);
    });

    it('should set secure to false in non-production', async () => {
      process.env.NODE_ENV = 'development';

      const { getSessionCookieOptions } = await loadAuth();
      const options = getSessionCookieOptions();

      expect(options.secure).toBe(false);
    });
  });

  describe('getSessionCookieName', () => {
    it('should return the session cookie name', async () => {
      const { getSessionCookieName } = await loadAuth();
      const name = getSessionCookieName();

      expect(name).toBe('automaker_session');
    });
  });

  describe('isRequestAuthenticated', () => {
    it('should return true for authenticated request with API key', async () => {
      process.env.AUTOMAKER_API_KEY = 'test-secret-key';

      const { isRequestAuthenticated } = await loadAuth();
      const { req } = createMockExpressContext();
      req.headers['x-api-key'] = 'test-secret-key';

      expect(isRequestAuthenticated(req)).toBe(true);
    });

    it('should return false for unauthenticated request', async () => {
      const { isRequestAuthenticated } = await loadAuth();
      const { req } = createMockExpressContext();

      expect(isRequestAuthenticated(req)).toBe(false);
    });

    it('should return true for authenticated request with session token', async () => {
      const { isRequestAuthenticated, createSession } = await loadAuth();
      const token = await createSession();
      const { req } = createMockExpressContext();
      req.headers['x-session-token'] = token;

      expect(isRequestAuthenticated(req)).toBe(true);
    });
  });

  describe('checkRawAuthentication', () => {
    it('should return true for valid API key in headers', async () => {
      process.env.AUTOMAKER_API_KEY = 'test-secret-key';

      const { checkRawAuthentication } = await loadAuth();

      expect(checkRawAuthentication({ 'x-api-key': 'test-secret-key' }, {}, {})).toBe(true);
    });

    it('should return true for valid session token in headers', async () => {
      const { checkRawAuthentication, createSession } = await loadAuth();
      const token = await createSession();

      expect(checkRawAuthentication({ 'x-session-token': token }, {}, {})).toBe(true);
    });

    it('should return true for valid API key in query', async () => {
      process.env.AUTOMAKER_API_KEY = 'test-secret-key';

      const { checkRawAuthentication } = await loadAuth();

      expect(checkRawAuthentication({}, { apiKey: 'test-secret-key' }, {})).toBe(true);
    });

    it('should return true for valid session cookie', async () => {
      const { checkRawAuthentication, createSession, getSessionCookieName } = await loadAuth();
      const token = await createSession();
      const cookieName = getSessionCookieName();

      expect(checkRawAuthentication({}, {}, { [cookieName]: token })).toBe(true);
    });

    it('should return false for invalid credentials', async () => {
      const { checkRawAuthentication } = await loadAuth();

      expect(checkRawAuthentication({}, {}, {})).toBe(false);
    });
  });
});
