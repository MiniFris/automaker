import { Module } from '@nestjs/common';
import { GithubController } from './github.controller.js';
import { GithubHandlersService } from './github-handlers.service.js';

@Module({
  controllers: [GithubController],
  providers: [GithubHandlersService],
})
export class GithubModule {}
