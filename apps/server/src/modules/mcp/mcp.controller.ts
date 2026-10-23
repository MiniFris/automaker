import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { MCPApplicationService } from './mcp-application.service.js';
import {
  MCPServerRequestSchema,
  type MCPServerRequest,
} from './mcp.schemas.js';

@Controller('mcp')
export class MCPController {
  constructor(@Inject(MCPApplicationService) private readonly mcp: MCPApplicationService) {}

  @Post('test')
  @HttpCode(200)
  test(@Body(new ZodValidationPipe(MCPServerRequestSchema)) body: MCPServerRequest) {
    return this.mcp.test(body);
  }

  @Post('tools')
  @HttpCode(200)
  tools(@Body(new ZodValidationPipe(MCPServerRequestSchema)) body: MCPServerRequest) {
    return this.mcp.tools(body);
  }
}
