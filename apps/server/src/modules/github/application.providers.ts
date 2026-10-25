import type { FactoryProvider } from '@nestjs/common';
import { GithubReviewService } from './github-review.service.js';
import { GithubDiscoveryService } from './github-discovery.service.js';
import { GithubReadPort } from './github-read.port.js';
import { GithubCommentsReadPort, GithubReviewMutationPort } from './github-review.port.js';

export const githubReviewServiceProvider: FactoryProvider<GithubReviewService> = {
  provide: GithubReviewService,
  inject: [GithubReadPort, GithubCommentsReadPort, GithubReviewMutationPort],
  useFactory: (
    reads: ConstructorParameters<typeof GithubReviewService>[0],
    comments: ConstructorParameters<typeof GithubReviewService>[1],
    writes: ConstructorParameters<typeof GithubReviewService>[2]
  ) => new GithubReviewService(reads, comments, writes),
};

export const githubDiscoveryServiceProvider: FactoryProvider<GithubDiscoveryService> = {
  provide: GithubDiscoveryService,
  inject: [GithubReadPort],
  useFactory: (reads: ConstructorParameters<typeof GithubDiscoveryService>[0]) =>
    new GithubDiscoveryService(reads),
};
