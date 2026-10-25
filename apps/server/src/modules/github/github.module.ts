import {
  githubReviewServiceProvider,
  githubDiscoveryServiceProvider,
} from './application.providers.js';
import { Module } from '@nestjs/common';
import { GithubController } from './github.controller.js';
import { IssueValidationRegistry } from './issue-validation-registry.service.js';
import { IssueValidationService } from './issue-validation.service.js';
import { IssueValidationRepository } from './issue-validation.repository.js';
import { GithubCommandRuntime, NodeGithubCommandRuntime } from './github-command.runtime.js';
import { GithubReadPort } from './github-read.port.js';
import { GithubCliReadAdapter } from './github-cli-read.adapter.js';

import { GithubCommentsReadPort, GithubReviewMutationPort } from './github-review.port.js';
import { GithubCliCommentsAdapter } from './github-cli-comments.adapter.js';
import { GithubCliReviewMutationAdapter } from './github-cli-review-mutation.adapter.js';

import { GithubRepositoryBoundary } from './github-repository-boundary.js';
import { SECURE_FILESYSTEM, SecurityModule } from '../../core/security/security.module.js';
import { SecurityService } from '../../core/security/security.service.js';
import type { ValidationFilesystem } from '../../lib/validation-storage.js';

@Module({
  imports: [SecurityModule],
  controllers: [GithubController],
  providers: [
    GithubRepositoryBoundary,
    NodeGithubCommandRuntime,
    { provide: GithubCommandRuntime, useExisting: NodeGithubCommandRuntime },
    GithubCliReadAdapter,
    { provide: GithubReadPort, useExisting: GithubCliReadAdapter },
    githubDiscoveryServiceProvider,
    GithubCliCommentsAdapter,
    { provide: GithubCommentsReadPort, useExisting: GithubCliCommentsAdapter },
    GithubCliReviewMutationAdapter,
    { provide: GithubReviewMutationPort, useExisting: GithubCliReviewMutationAdapter },
    githubReviewServiceProvider,
    IssueValidationRegistry,
    {
      provide: IssueValidationRepository,
      inject: [SECURE_FILESYSTEM, SecurityService],
      useFactory: (filesystem: ValidationFilesystem, security: SecurityService) =>
        new IssueValidationRepository(filesystem, (project) =>
          security.validateLocalPath(project, 'issue validation storage')
        ),
    },
    IssueValidationService,
  ],
})
export class GithubModule {}
