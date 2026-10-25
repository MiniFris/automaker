import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { MCPApplicationService } from './mcp-application.service.js';
import { MCPServerRequestSchema, type MCPServerRequest } from './mcp.schemas.js';
import {
  MCPConnectionResponseSchema,
  MCPToolsResponseSchema,
} from '@automaker/contracts/domains/integration-responses';

@Controller('mcp')
export class MCPController {
  constructor(@Inject(MCPApplicationService) private readonly mcp: MCPApplicationService) {}

  @Post('test')
  @HttpCode(200)
  async test(@Body(new ZodValidationPipe(MCPServerRequestSchema)) body: MCPServerRequest) {
    return MCPConnectionResponseSchema.parse(await this.mcp.test(body));
  }

  @Post('tools')
  @HttpCode(200)
  async tools(@Body(new ZodValidationPipe(MCPServerRequestSchema)) body: MCPServerRequest) {
    return MCPToolsResponseSchema.parse(await this.mcp.tools(body));
  }
}
