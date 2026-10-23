import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { WorktreeApplicationService } from './worktree-application.service.js';
import { WorktreeProcessService } from './worktree-process.service.js';
import {
  DevSessionSchema,
  StartDevSchema,
  StartTestsSchema,
  StopTestsSchema,
  TestLogsSchema,
  WorktreeCheckoutBranchSchema,
  WorktreeCherryPickSchema,
  WorktreeDiscardSchema,
  WorktreeMutationSchema,
  WorktreeRemoteAddSchema,
  WorktreeStashApplySchema,
  WorktreeStashDropSchema,
  WorktreeStashPushSchema,
  WorktreeTrackingSchema,
  WorktreeSwitchBranchSchema,
  WorktreeBranchesSchema,
  WorktreeBranchCommitLogSchema,
  WorktreeCommitLogSchema,
  WorktreeCommitSchema,
  WorktreeFeatureSchema,
  WorktreeFileSchema,
  WorktreePathSchema,
  WorktreePullSchema,
  WorktreePushSchema,
  WorktreeRebaseSchema,
  WorktreeProjectSchema,
  WorktreeStageFilesSchema,
  WorktreeSyncSchema,
  type WorktreeBranchesRequest,
  type WorktreeBranchCommitLogRequest,
  type WorktreeCommitLogRequest,
  type WorktreeCommitRequest,
  type WorktreeCheckoutBranchRequest,
  type WorktreeCherryPickRequest,
  type WorktreeDiscardRequest,
  type WorktreeFeatureRequest,
  type WorktreeFileRequest,
  type WorktreePathRequest,
  type WorktreePullRequest,
  type WorktreePushRequest,
  type WorktreeRebaseRequest,
  type WorktreeProjectRequest,
  type WorktreeStageFilesRequest,
  type DevSessionRequest,
  type StartDevRequest,
  type StartTestsRequest,
  type StopTestsRequest,
  type TestLogsRequest,
  type WorktreeMutationRequest,
  type WorktreeRemoteAddRequest,
  type WorktreeStashApplyRequest,
  type WorktreeStashDropRequest,
  type WorktreeStashPushRequest,
  type WorktreeTrackingRequest,
  type WorktreeSwitchBranchRequest,
  type WorktreeSyncRequest,
} from './worktree.schemas.js';

@Controller('worktree')
@UseGuards(AllowedPathGuard)
export class WorktreeController {
  constructor(
    @Inject(WorktreeApplicationService) private readonly worktrees: WorktreeApplicationService,
    @Inject(WorktreeProcessService) private readonly processes: WorktreeProcessService
  ) {}

  @Post('environment')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  environment(@Body(new ZodValidationPipe(WorktreeProjectSchema)) body: WorktreeProjectRequest) {
    return this.worktrees.environment(body);
  }

  @Post('list')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  list(
    @Body(new ZodValidationPipe(WorktreeProjectSchema)) body: WorktreeProjectRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.list(body, signal));
  }

  @Post('info')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  info(
    @Body(new ZodValidationPipe(WorktreeFeatureSchema)) body: WorktreeFeatureRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.info(body, signal));
  }

  @Post('status')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  status(
    @Body(new ZodValidationPipe(WorktreeFeatureSchema)) body: WorktreeFeatureRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.status(body, signal));
  }

  @Post('diffs')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  diffs(
    @Body(new ZodValidationPipe(WorktreeFeatureSchema)) body: WorktreeFeatureRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.diffs(body, signal));
  }

  @Post('file-diff')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  fileDiff(
    @Body(new ZodValidationPipe(WorktreeFileSchema)) body: WorktreeFileRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.fileDiff(body, signal));
  }

  @Post('check-changes')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  checkChanges(
    @Body(new ZodValidationPipe(WorktreePathSchema)) body: WorktreePathRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.checkChanges(body, signal));
  }

  @Post('list-branches')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  listBranches(
    @Body(new ZodValidationPipe(WorktreeBranchesSchema)) body: WorktreeBranchesRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.listBranches(body, signal));
  }

  @Post('list-remotes')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  listRemotes(
    @Body(new ZodValidationPipe(WorktreePathSchema)) body: WorktreePathRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.listRemotes(body, signal));
  }

  @Post('stage-files')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  stageFiles(
    @Body(new ZodValidationPipe(WorktreeStageFilesSchema)) body: WorktreeStageFilesRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.stageFiles(body, signal));
  }

  @Post('commit')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  commit(
    @Body(new ZodValidationPipe(WorktreeCommitSchema)) body: WorktreeCommitRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.commit(body, signal));
  }

  @Post('abort-operation')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  abortOperation(
    @Body(new ZodValidationPipe(WorktreeMutationSchema)) body: WorktreeMutationRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.abortOperation(body, signal));
  }

  @Post('continue-operation')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  continueOperation(
    @Body(new ZodValidationPipe(WorktreeMutationSchema)) body: WorktreeMutationRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.continueOperation(body, signal));
  }

  @Post('add-remote')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  addRemote(
    @Body(new ZodValidationPipe(WorktreeRemoteAddSchema)) body: WorktreeRemoteAddRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.addRemote(body, signal));
  }

  @Post('set-tracking')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  setTracking(
    @Body(new ZodValidationPipe(WorktreeTrackingSchema)) body: WorktreeTrackingRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.setTracking(body, signal));
  }

  @Post('stash-list')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  stashList(
    @Body(new ZodValidationPipe(WorktreePathSchema)) body: WorktreePathRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.stashList(body, signal));
  }

  @Post('stash-push')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  stashPush(
    @Body(new ZodValidationPipe(WorktreeStashPushSchema)) body: WorktreeStashPushRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.stashPush(body, signal));
  }

  @Post('stash-apply')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  stashApply(
    @Body(new ZodValidationPipe(WorktreeStashApplySchema)) body: WorktreeStashApplyRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.stashApply(body, signal));
  }

  @Post('stash-drop')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  stashDrop(
    @Body(new ZodValidationPipe(WorktreeStashDropSchema)) body: WorktreeStashDropRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.stashDrop(body, signal));
  }

  @Post('checkout-branch')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  checkoutBranch(
    @Body(new ZodValidationPipe(WorktreeCheckoutBranchSchema))
    body: WorktreeCheckoutBranchRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.checkoutBranch(body, signal));
  }

  @Post('switch-branch')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  switchBranch(
    @Body(new ZodValidationPipe(WorktreeSwitchBranchSchema)) body: WorktreeSwitchBranchRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.switchBranch(body, signal));
  }

  @Post('discard-changes')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  discardChanges(
    @Body(new ZodValidationPipe(WorktreeDiscardSchema)) body: WorktreeDiscardRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.discardChanges(body, signal));
  }

  @Post('pull')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  pull(
    @Body(new ZodValidationPipe(WorktreePullSchema)) body: WorktreePullRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.pull(body, signal));
  }

  @Post('push')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  push(
    @Body(new ZodValidationPipe(WorktreePushSchema)) body: WorktreePushRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.push(body, signal));
  }

  @Post('sync')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  sync(
    @Body(new ZodValidationPipe(WorktreeSyncSchema)) body: WorktreeSyncRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.sync(body, signal));
  }

  @Post('rebase')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  rebase(
    @Body(new ZodValidationPipe(WorktreeRebaseSchema)) body: WorktreeRebaseRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.rebase(body, signal));
  }

  @Post('cherry-pick')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  cherryPick(
    @Body(new ZodValidationPipe(WorktreeCherryPickSchema)) body: WorktreeCherryPickRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.cherryPick(body, signal));
  }

  @Post('commit-log')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  commitLog(
    @Body(new ZodValidationPipe(WorktreeCommitLogSchema)) body: WorktreeCommitLogRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.commitLog(body, signal));
  }

  @Post('branch-commit-log')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  branchCommitLog(
    @Body(new ZodValidationPipe(WorktreeBranchCommitLogSchema))
    body: WorktreeBranchCommitLogRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.cancel(response, (signal) => this.worktrees.branchCommitLog(body, signal));
  }

  @Post('start-dev')
  @HttpCode(200)
  @AllowedPathFields('projectPath', 'worktreePath')
  startDev(@Body(new ZodValidationPipe(StartDevSchema)) body: StartDevRequest) {
    return this.processes.startDev(body);
  }

  @Post('stop-dev')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  stopDev(@Body(new ZodValidationPipe(DevSessionSchema)) body: DevSessionRequest) {
    return this.processes.stopDev(body);
  }

  @Post('list-dev-servers')
  @HttpCode(200)
  listDevServers() {
    return this.processes.listDev();
  }

  @Get('dev-server-logs')
  @AllowedPathFields('worktreePath')
  devServerLogs(@Query(new ZodValidationPipe(DevSessionSchema)) query: DevSessionRequest) {
    return this.processes.devLogs(query);
  }

  @Post('start-tests')
  @HttpCode(200)
  @AllowedPathFields('worktreePath', 'projectPath')
  startTests(@Body(new ZodValidationPipe(StartTestsSchema)) body: StartTestsRequest) {
    return this.processes.startTests(body);
  }

  @Post('stop-tests')
  @HttpCode(200)
  stopTests(@Body(new ZodValidationPipe(StopTestsSchema)) body: StopTestsRequest) {
    return this.processes.stopTests(body);
  }

  @Get('test-logs')
  @AllowedPathFields('worktreePath')
  testLogs(@Query(new ZodValidationPipe(TestLogsSchema)) query: TestLogsRequest) {
    return this.processes.testLogs(query);
  }

  private async cancel<T>(response: Response, operation: (signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController();
    const close = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.on('close', close);
    try {
      return await operation(controller.signal);
    } finally {
      response.off('close', close);
    }
  }
}
