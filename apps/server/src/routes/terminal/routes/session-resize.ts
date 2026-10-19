/**
 * POST /sessions/:id/resize endpoint - Resize a terminal session
 */

import type { Request, Response } from 'express';
import { getTerminalService } from '../../../services/terminal-service.js';

export function createSessionResizeHandler() {
  return (req: Request, res: Response): void => {
    const terminalService = getTerminalService();
    const { id } = req.params;
    const { cols, rows } = req.body;

    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 1 ||
      cols > 1000 ||
      rows < 1 ||
      rows > 500
    ) {
      res.status(400).json({
        success: false,
        error: 'cols (1–1000) and rows (1–500) must be integers',
      });
      return;
    }

    const resized = terminalService.resize(id, cols, rows);

    if (!resized) {
      res.status(404).json({
        success: false,
        error: 'Session not found',
      });
      return;
    }

    res.json({
      success: true,
    });
  };
}
