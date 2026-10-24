import { Module } from '@nestjs/common';
import { GithubController } from './github.controller.js';
import { GithubHandlersService } from './github-handlers.service.js';
import { IssueValidationRegistry } from './issue-validation-registry.service.js';
import { IssueValidationService } from './issue-validation.service.js';
import { IssueValidationRepository } from './issue-validation.repository.js';
import { GithubCommandRuntime, NodeGithubCommandRuntime } from './github-command.runtime.js';
import { GithubReadPort } from './github-read.port.js';
import { GithubCliReadAdapter } from './github-cli-read.adapter.js';
import { GithubDiscoveryService } from './github-discovery.service.js';

@Module({
  controllers: [GithubController],
  providers: [
    NodeGithubCommandRuntime,
    { provide: GithubCommandRuntime, useExisting: NodeGithubCommandRuntime },
    GithubCliReadAdapter,
    { provide: GithubReadPort, useExisting: GithubCliReadAdapter },
    GithubDiscoveryService,
    GithubHandlersService,
    IssueValidationRegistry,
    IssueValidationRepository,
    IssueValidationService,
  ],
})
export class GithubModule {}
