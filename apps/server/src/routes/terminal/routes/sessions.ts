/**
 * GET /sessions endpoint - List all active terminal sessions
 * POST /sessions endpoint - Create a new terminal session
 */

import type { Request, Response } from 'express';
import { getTerminalService } from '../../../services/terminal-service.js';
import { getErrorMessage, logError } from '../common.js';
import { createLogger } from '@automaker/utils';
import { ExecutionEnvironmentError } from '../../../services/execution-environment/runtime.js';

const logger = createLogger('Terminal');

export function createSessionsListHandler() {
  return (_req: Request, res: Response): void => {
    const terminalService = getTerminalService();
    const sessions = terminalService.getAllSessions();
    res.json({
      success: true,
      data: sessions,
    });
  };
}

export function createSessionsCreateHandler() {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const terminalService = getTerminalService();
      const { cwd, cols, rows, shell, environmentTargetId } = req.body ?? {};
      if (
        (cwd !== undefined && (typeof cwd !== 'string' || !cwd || cwd.includes('\0'))) ||
        (shell !== undefined && typeof shell !== 'string') ||
        (cols !== undefined && (!Number.isInteger(cols) || cols < 1 || cols > 1000)) ||
        (rows !== undefined && (!Number.isInteger(rows) || rows < 1 || rows > 500)) ||
        (environmentTargetId !== undefined && typeof environmentTargetId !== 'string')
      ) {
        res.status(400).json({ success: false, error: 'Invalid terminal options' });
        return;
      }

      const session = await terminalService.createSession({
        cwd,
        cols: cols || 80,
        rows: rows || 24,
        shell,
        environmentTargetId,
      });
      if (res.destroyed && session) {
        terminalService.killSession(session.id);
        return;
      }

      // Check if session creation was refused due to limit
      if (!session) {
        const maxSessions = terminalService.getMaxSessions();
        const currentSessions = terminalService.getSessionCount();
        logger.warn(`Session limit reached: ${currentSessions}/${maxSessions}`);
        res.status(429).json({
          success: false,
          error: 'Maximum terminal sessions reached',
          details: `Server limit is ${maxSessions} concurrent sessions. Please close unused terminals.`,
          currentSessions,
          maxSessions,
        });
        return;
      }

      res.json({
        success: true,
        data: {
          id: session.id,
          cwd: session.cwd,
          shell: session.shell,
          createdAt: session.createdAt,
          executionEnvironment: session.executionEnvironment,
        },
      });
    } catch (error) {
      logError(error, 'Create terminal session failed');
      res.status(error instanceof ExecutionEnvironmentError ? 400 : 500).json({
        success: false,
        code: error instanceof ExecutionEnvironmentError ? error.code : undefined,
        error:
          error instanceof ExecutionEnvironmentError
            ? error.message
            : 'Failed to create terminal session',
        details: getErrorMessage(error),
      });
    }
  };
}
