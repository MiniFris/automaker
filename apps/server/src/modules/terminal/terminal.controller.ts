import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ExecutionEnvironmentError } from '../../services/execution-environment/runtime.js';
import {
  MAX_MAX_SESSIONS,
  MIN_MAX_SESSIONS,
  TerminalService,
} from '../../services/terminal-service.js';
import { TerminalAccessGuard, TerminalAccessService } from './terminal-access.service.js';

@Controller('terminal')
export class TerminalController {
  constructor(
    @Inject(TerminalService) private readonly terminal: TerminalService,
    @Inject(TerminalAccessService) private readonly access: TerminalAccessService
  ) {}

  @Get('status')
  status() {
    return {
      success: true,
      data: {
        enabled: this.access.enabled,
        passwordRequired: this.access.passwordRequired,
        platform: this.terminal.getPlatformInfo(),
      },
    };
  }

  @Post('auth')
  authenticate(@Body() body: { password?: unknown }, @Res() response: Response) {
    const result = this.access.authenticate(body?.password);
    response.status(result.status).json(result.body);
  }

  @Post('logout')
  logout(@Req() request: Request) {
    const token =
      (typeof request.headers['x-terminal-token'] === 'string'
        ? request.headers['x-terminal-token']
        : undefined) || (typeof request.body?.token === 'string' ? request.body.token : undefined);
    this.access.logout(token);
    return { success: true };
  }

  @Get('sessions')
  @UseGuards(TerminalAccessGuard)
  sessions() {
    return { success: true, data: this.terminal.getAllSessions() };
  }

  @Get('sessions/:id')
  @UseGuards(TerminalAccessGuard)
  session(@Param('id') id: string, @Res() response: Response) {
    const session = this.terminal.getSession(id);
    if (session && this.terminal.isSessionClosing(id)) {
      response.status(503).json({
        success: false,
        errorCode: 'UNAVAILABLE',
        error: 'Terminal cleanup is pending or unconfirmed. No shell was recreated.',
      });
      return;
    }
    if (!session) {
      response.status(404).json({
        success: false,
        error: 'Terminal session ended; create a new terminal explicitly.',
      });
      return;
    }
    response.json({
      success: true,
      data: {
        id: session.id,
        cwd: session.cwd,
        shell: session.shell,
        executionEnvironment: session.executionEnvironment,
      },
    });
  }

  @Post('sessions')
  @UseGuards(TerminalAccessGuard, AllowedPathGuard)
  @AllowedPathFields('cwd?')
  async createSession(@Body() body: Record<string, unknown>, @Res() response: Response) {
    const { cwd, cols, rows, shell, environmentTargetId } = body ?? {};
    if (
      (cwd !== undefined && (typeof cwd !== 'string' || !cwd || cwd.includes('\0'))) ||
      (shell !== undefined && typeof shell !== 'string') ||
      (cols !== undefined &&
        (!Number.isInteger(cols) || (cols as number) < 1 || (cols as number) > 1000)) ||
      (rows !== undefined &&
        (!Number.isInteger(rows) || (rows as number) < 1 || (rows as number) > 500)) ||
      (environmentTargetId !== undefined && typeof environmentTargetId !== 'string')
    ) {
      response.status(400).json({ success: false, error: 'Invalid terminal options' });
      return;
    }
    try {
      const session = await this.terminal.createSession({
        cwd: cwd as string | undefined,
        cols: (cols as number | undefined) || 80,
        rows: (rows as number | undefined) || 24,
        shell: shell as string | undefined,
        environmentTargetId: environmentTargetId as string | undefined,
      });
      if (response.destroyed && session) {
        this.terminal.killSession(session.id);
        return;
      }
      if (!session) {
        response.status(429).json({
          success: false,
          error: 'Maximum terminal sessions reached',
          details: `Server limit is ${this.terminal.getMaxSessions()} concurrent sessions. Please close unused terminals.`,
          currentSessions: this.terminal.getSessionCount(),
          maxSessions: this.terminal.getMaxSessions(),
        });
        return;
      }
      response.json({
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
      response.status(error instanceof ExecutionEnvironmentError ? 400 : 500).json({
        success: false,
        code: error instanceof ExecutionEnvironmentError ? error.code : undefined,
        error:
          error instanceof ExecutionEnvironmentError
            ? error.message
            : 'Failed to create terminal session',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @Delete('sessions/:id')
  @UseGuards(TerminalAccessGuard)
  deleteSession(@Param('id') id: string, @Res() response: Response) {
    if (!this.terminal.killSession(id)) {
      response.status(404).json({ success: false, error: 'Session not found' });
      return;
    }
    response.json({ success: true });
  }

  @Post('sessions/:id/resize')
  @UseGuards(TerminalAccessGuard)
  resize(
    @Param('id') id: string,
    @Body() body: { cols?: unknown; rows?: unknown },
    @Res() response: Response
  ) {
    const { cols, rows } = body;
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      (cols as number) < 1 ||
      (cols as number) > 1000 ||
      (rows as number) < 1 ||
      (rows as number) > 500
    ) {
      response
        .status(400)
        .json({ success: false, error: 'cols (1–1000) and rows (1–500) must be integers' });
      return;
    }
    if (!this.terminal.resize(id, cols as number, rows as number)) {
      response.status(404).json({ success: false, error: 'Session not found' });
      return;
    }
    response.json({ success: true });
  }

  @Get('settings')
  @UseGuards(TerminalAccessGuard)
  settings() {
    return {
      success: true,
      data: {
        maxSessions: this.terminal.getMaxSessions(),
        currentSessions: this.terminal.getSessionCount(),
      },
    };
  }

  @Put('settings')
  @UseGuards(TerminalAccessGuard)
  updateSettings(@Body() body: { maxSessions?: unknown }, @Res() response: Response) {
    const { maxSessions } = body;
    if (
      maxSessions !== undefined &&
      (typeof maxSessions !== 'number' ||
        !Number.isInteger(maxSessions) ||
        maxSessions < MIN_MAX_SESSIONS ||
        maxSessions > MAX_MAX_SESSIONS)
    ) {
      response.status(400).json({
        success: false,
        error: `maxSessions must be an integer between ${MIN_MAX_SESSIONS} and ${MAX_MAX_SESSIONS}`,
      });
      return;
    }
    if (typeof maxSessions === 'number') this.terminal.setMaxSessions(maxSessions);
    response.json({
      success: true,
      data: {
        maxSessions: this.terminal.getMaxSessions(),
        currentSessions: this.terminal.getSessionCount(),
      },
    });
  }
}
