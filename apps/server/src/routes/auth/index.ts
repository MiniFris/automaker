/**
 * Auth routes - Login, logout, and status endpoints
 *
 * Security model:
 * - Web mode: User enters API key (shown on server console) to get HTTP-only session cookie
 * - Electron mode: Uses X-API-Key header (handled automatically via IPC)
 *
 * The session cookie is:
 * - HTTP-only: JavaScript cannot read it (protects against XSS)
 * - SameSite=Strict: Only sent for same-site requests (protects against CSRF)
 *
 * Mounted at /api/auth in the main server (BEFORE auth middleware).
 */

import { Router } from 'express';
import type { Request } from 'express';
import {
  validateApiKey,
  createSession,
  invalidateSession,
  getSessionCookieOptions,
  getSessionCookieName,
  isRequestAuthenticated,
  createWsConnectionToken,
} from '../../lib/auth.js';
import { LoginAttemptStore } from '../../core/auth/login-attempt.store.js';

// Check if we're in test mode - disable rate limiting for E2E tests
const isTestMode = process.env.AUTOMAKER_MOCK_AGENT === 'true';

/**
 * Get client IP address from request
 * Handles X-Forwarded-For header for reverse proxy setups
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // X-Forwarded-For can be a comma-separated list; take the first (original client)
    const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return forwardedIp.trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Create auth routes
 *
 * @returns Express Router with auth endpoints
 */
export function createAuthRoutes(loginAttempts = new LoginAttemptStore()): Router {
  const router = Router();

  /**
   * GET /api/auth/status
   *
   * Returns whether the current request is authenticated.
   * Used by the UI to determine if login is needed.
   *
   * If AUTOMAKER_AUTO_LOGIN=true is set, automatically creates a session
   * for unauthenticated requests (useful for development).
   */
  router.get('/status', async (req, res) => {
    let authenticated = isRequestAuthenticated(req);

    // Auto-login for development: create session automatically if enabled
    // Only works in non-production environments as a safeguard
    if (
      !authenticated &&
      process.env.AUTOMAKER_AUTO_LOGIN === 'true' &&
      process.env.NODE_ENV !== 'production'
    ) {
      const sessionToken = await createSession();
      const cookieOptions = getSessionCookieOptions();
      const cookieName = getSessionCookieName();
      res.cookie(cookieName, sessionToken, cookieOptions);
      authenticated = true;
    }

    res.json({
      success: true,
      authenticated,
      required: true,
    });
  });

  /**
   * POST /api/auth/login
   *
   * Validates the API key and sets a session cookie.
   * Body: { apiKey: string }
   *
   * Rate limited to 5 attempts per minute per IP to prevent brute force attacks.
   */
  router.post('/login', async (req, res) => {
    const clientIp = getClientIp(req);

    // Skip rate limiting in test mode to allow parallel E2E tests
    if (!isTestMode) {
      // Check rate limit before processing
      const rateLimit = loginAttempts.check(clientIp);
      if (!rateLimit.allowed) {
        res.status(429).json({
          success: false,
          error: 'Too many login attempts. Please try again later.',
          retryAfter: rateLimit.retryAfterSeconds,
        });
        return;
      }
    }

    const { apiKey } = req.body as { apiKey?: string };

    if (!apiKey) {
      res.status(400).json({
        success: false,
        error: 'API key is required.',
      });
      return;
    }

    // Record this attempt (only for actual API key validation attempts, skip in test mode)
    if (!isTestMode) {
      loginAttempts.recordFailure(clientIp);
    }

    if (!validateApiKey(apiKey)) {
      res.status(401).json({
        success: false,
        error: 'Invalid API key.',
      });
      return;
    }

    // Create session and set cookie
    const sessionToken = await createSession();
    const cookieOptions = getSessionCookieOptions();
    const cookieName = getSessionCookieName();

    res.cookie(cookieName, sessionToken, cookieOptions);
    res.json({
      success: true,
      message: 'Logged in successfully.',
      // Return token for explicit header-based auth (works around cross-origin cookie issues)
      token: sessionToken,
    });
  });

  /**
   * GET /api/auth/token
   *
   * Generates a short-lived WebSocket connection token if the user has a valid session.
   * This token is used for initial WebSocket handshake authentication and expires in 5 minutes.
   * The token is NOT the session cookie value - it's a separate, short-lived token.
   */
  router.get('/token', (req, res) => {
    // Validate the session is still valid (via cookie, API key, or session token header)
    if (!isRequestAuthenticated(req)) {
      res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
      return;
    }

    // Generate a new short-lived WebSocket connection token
    const wsToken = createWsConnectionToken();

    res.json({
      success: true,
      token: wsToken,
      expiresIn: 300, // 5 minutes in seconds
    });
  });

  /**
   * POST /api/auth/logout
   *
   * Clears the session cookie and invalidates the session.
   */
  router.post('/logout', async (req, res) => {
    const cookieName = getSessionCookieName();
    const sessionToken = req.cookies?.[cookieName] as string | undefined;

    if (sessionToken) {
      await invalidateSession(sessionToken);
    }

    // Clear the cookie by setting it to empty with immediate expiration
    // Using res.cookie() with maxAge: 0 is more reliable than clearCookie()
    // in cross-origin development environments
    res.cookie(cookieName, '', {
      ...getSessionCookieOptions(),
      maxAge: 0,
      expires: new Date(0),
    });

    res.json({
      success: true,
      message: 'Logged out successfully.',
    });
  });

  return router;
}
