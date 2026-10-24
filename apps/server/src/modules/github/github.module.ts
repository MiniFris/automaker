import { Module } from '@nestjs/common';
import { GithubController } from './github.controller.js';
import { GithubHandlersService } from './github-handlers.service.js';
import { IssueValidationRegistry } from './issue-validation-registry.service.js';
import { IssueValidationService } from './issue-validation.service.js';
import { IssueValidationRepository } from './issue-validation.repository.js';

@Module({
  controllers: [GithubController],
  providers: [
    GithubHandlersService,
    IssueValidationRegistry,
    IssueValidationRepository,
    IssueValidationService,
  ],
})
export class GithubModule {}
