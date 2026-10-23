import { Module } from '@nestjs/common';
import { SpawnTemplateCommandRunner, TEMPLATE_COMMAND_RUNNER } from './template-command.runner.js';
import { TemplatesController } from './templates.controller.js';
import { TemplatesService } from './templates.service.js';

@Module({
  controllers: [TemplatesController],
  providers: [
    TemplatesService,
    { provide: TEMPLATE_COMMAND_RUNNER, useClass: SpawnTemplateCommandRunner },
  ],
})
export class TemplatesModule {}
