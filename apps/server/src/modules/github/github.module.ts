import { Module } from '@nestjs/common';
import { GithubController } from './github.controller.js';
import { IssueValidationRegistry } from './issue-validation-registry.service.js';
import { IssueValidationService } from './issue-validation.service.js';
import { IssueValidationRepository } from './issue-validation.repository.js';
import { GithubCommandRuntime, NodeGithubCommandRuntime } from './github-command.runtime.js';
import { GithubReadPort } from './github-read.port.js';
import { GithubCliReadAdapter } from './github-cli-read.adapter.js';
import { GithubDiscoveryService } from './github-discovery.service.js';
import { GithubCommentsReadPort, GithubReviewMutationPort } from './github-review.port.js';
import { GithubCliCommentsAdapter } from './github-cli-comments.adapter.js';
import { GithubCliReviewMutationAdapter } from './github-cli-review-mutation.adapter.js';
import { GithubReviewService } from './github-review.service.js';

@Module({
  controllers: [GithubController],
  providers: [
    NodeGithubCommandRuntime,
    { provide: GithubCommandRuntime, useExisting: NodeGithubCommandRuntime },
    GithubCliReadAdapter,
    { provide: GithubReadPort, useExisting: GithubCliReadAdapter },
    GithubDiscoveryService,
    GithubCliCommentsAdapter,
    { provide: GithubCommentsReadPort, useExisting: GithubCliCommentsAdapter },
    GithubCliReviewMutationAdapter,
    { provide: GithubReviewMutationPort, useExisting: GithubCliReviewMutationAdapter },
    GithubReviewService,
    IssueValidationRegistry,
    IssueValidationRepository,
    IssueValidationService,
  ],
})
export class GithubModule {}
