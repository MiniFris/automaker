import {
  WorktreeEnvironmentResponseSchema,
  WorktreeListResponseSchema,
  WorktreeInfoResponseSchema,
  WorktreeStatusResponseSchema,
  WorktreeDiffsResponseSchema,
  WorktreeFileDiffResponseSchema,
  WorktreeCheckChangesResponseSchema,
  WorktreeListBranchesResponseSchema,
  WorktreeListRemotesResponseSchema,
  WorktreeStageFilesResponseSchema,
  WorktreeCommitResponseSchema,
  WorktreeAbortOperationResponseSchema,
  WorktreeContinueOperationResponseSchema,
  WorktreeAddRemoteResponseSchema,
  WorktreeSetTrackingResponseSchema,
  WorktreeStashListResponseSchema,
  WorktreeStashPushResponseSchema,
  WorktreeStashApplyResponseSchema,
  WorktreeStashDropResponseSchema,
  WorktreeCheckoutBranchResponseSchema,
  WorktreeSwitchBranchResponseSchema,
  WorktreeDiscardChangesResponseSchema,
  WorktreePullResponseSchema,
  WorktreePushResponseSchema,
  WorktreeSyncResponseSchema,
  WorktreeRebaseResponseSchema,
  WorktreeCherryPickResponseSchema,
  WorktreeMergeResponseSchema,
  WorktreeCreateResponseSchema,
  WorktreeDeleteResponseSchema,
  WorktreeInitGitResponseSchema,
  WorktreeGetInitScriptResponseSchema,
  WorktreePutInitScriptResponseSchema,
  WorktreeDeleteInitScriptResponseSchema,
  WorktreeRunInitScriptResponseSchema,
  WorktreeMigrateResponseSchema,
  WorktreeAvailableEditorsResponseSchema,
  WorktreeDefaultEditorResponseSchema,
  WorktreeRefreshEditorsResponseSchema,
  WorktreeOpenEditorResponseSchema,
  WorktreeAvailableTerminalsResponseSchema,
  WorktreeDefaultTerminalResponseSchema,
  WorktreeRefreshTerminalsResponseSchema,
  WorktreeOpenTerminalResponseSchema,
  WorktreeOpenExternalTerminalResponseSchema,
  WorktreeGenerateCommitMessageResponseSchema,
  WorktreeGeneratePrDescriptionResponseSchema,
  WorktreePrInfoResponseSchema,
  WorktreeUpdatePrNumberResponseSchema,
  WorktreeCreatePrResponseSchema,
  WorktreeCommitLogResponseSchema,
  WorktreeBranchCommitLogResponseSchema,
  WorktreeStartDevResponseSchema,
  WorktreeStopDevResponseSchema,
  WorktreeListDevResponseSchema,
  WorktreeDevLogsResponseSchema,
  WorktreeStartTestsResponseSchema,
  WorktreeStopTestsResponseSchema,
  WorktreeTestLogsResponseSchema,
} from '@automaker/contracts/domains/worktree-responses';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AllowedPathFields, AllowedPathGuard } from '../../core/security/index.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import { WorktreeApplicationService } from './worktree-application.service.js';
import { WorktreeProcessService } from './worktree-process.service.js';
import { WorktreeHostService } from './worktree-host.service.js';
import { WorktreeTextService } from './worktree-text.service.js';
import {
  DevSessionSchema,
  StartDevSchema,
  StartTestsSchema,
  StopTestsSchema,
  TestLogsSchema,
  WorktreeCheckoutBranchSchema,
  WorktreeCherryPickSchema,
  WorktreeMergeSchema,
  WorktreeCreateSchema,
  WorktreeDeleteSchema,
  WorktreeInitGitSchema,
  WorktreeInitScriptDeleteSchema,
  WorktreeInitScriptQuerySchema,
  WorktreeInitScriptWriteSchema,
  WorktreeRunInitScriptSchema,
  WorktreeOpenEditorSchema,
  WorktreeOpenTerminalSchema,
  WorktreeGenerateCommitMessageSchema,
  WorktreeGeneratePrDescriptionSchema,
  WorktreePrInfoSchema,
  WorktreeUpdatePrNumberSchema,
  WorktreeCreatePrSchema,
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
  type WorktreeMergeRequest,
  type WorktreeCreateRequest,
  type WorktreeDeleteRequest,
  type WorktreeInitGitRequest,
  type WorktreeInitScriptDeleteRequest,
  type WorktreeInitScriptQuery,
  type WorktreeInitScriptWriteRequest,
  type WorktreeRunInitScriptRequest,
  type WorktreeOpenEditorRequest,
  type WorktreeOpenTerminalRequest,
  type WorktreeGenerateCommitMessageRequest,
  type WorktreeGeneratePrDescriptionRequest,
  type WorktreePrInfoRequest,
  type WorktreeUpdatePrNumberRequest,
  type WorktreeCreatePrRequest,
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
    @Inject(WorktreeProcessService) private readonly processes: WorktreeProcessService,
    @Inject(WorktreeHostService) private readonly host: WorktreeHostService,
    @Inject(WorktreeTextService) private readonly text: WorktreeTextService
  ) {}

  @Post('environment')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async environment(
    @Body(new ZodValidationPipe(WorktreeProjectSchema)) body: WorktreeProjectRequest
  ) {
    return WorktreeEnvironmentResponseSchema.parse(await this.worktrees.environment(body));
  }

  @Post('list')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async list(
    @Body(new ZodValidationPipe(WorktreeProjectSchema)) body: WorktreeProjectRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeListResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.list(body, signal))
    );
  }

  @Post('info')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async info(
    @Body(new ZodValidationPipe(WorktreeFeatureSchema)) body: WorktreeFeatureRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeInfoResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.info(body, signal))
    );
  }

  @Post('status')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async status(
    @Body(new ZodValidationPipe(WorktreeFeatureSchema)) body: WorktreeFeatureRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeStatusResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.status(body, signal))
    );
  }

  @Post('diffs')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async diffs(
    @Body(new ZodValidationPipe(WorktreeFeatureSchema)) body: WorktreeFeatureRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeDiffsResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.diffs(body, signal))
    );
  }

  @Post('file-diff')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async fileDiff(
    @Body(new ZodValidationPipe(WorktreeFileSchema)) body: WorktreeFileRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeFileDiffResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.fileDiff(body, signal))
    );
  }

  @Post('check-changes')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async checkChanges(
    @Body(new ZodValidationPipe(WorktreePathSchema)) body: WorktreePathRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeCheckChangesResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.checkChanges(body, signal))
    );
  }

  @Post('list-branches')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async listBranches(
    @Body(new ZodValidationPipe(WorktreeBranchesSchema)) body: WorktreeBranchesRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeListBranchesResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.listBranches(body, signal))
    );
  }

  @Post('list-remotes')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async listRemotes(
    @Body(new ZodValidationPipe(WorktreePathSchema)) body: WorktreePathRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeListRemotesResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.listRemotes(body, signal))
    );
  }

  @Post('stage-files')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async stageFiles(
    @Body(new ZodValidationPipe(WorktreeStageFilesSchema)) body: WorktreeStageFilesRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeStageFilesResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.stageFiles(body, signal))
    );
  }

  @Post('commit')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async commit(
    @Body(new ZodValidationPipe(WorktreeCommitSchema)) body: WorktreeCommitRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeCommitResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.commit(body, signal))
    );
  }

  @Post('abort-operation')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async abortOperation(
    @Body(new ZodValidationPipe(WorktreeMutationSchema)) body: WorktreeMutationRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeAbortOperationResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.abortOperation(body, signal))
    );
  }

  @Post('continue-operation')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async continueOperation(
    @Body(new ZodValidationPipe(WorktreeMutationSchema)) body: WorktreeMutationRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeContinueOperationResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.continueOperation(body, signal))
    );
  }

  @Post('add-remote')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async addRemote(
    @Body(new ZodValidationPipe(WorktreeRemoteAddSchema)) body: WorktreeRemoteAddRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeAddRemoteResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.addRemote(body, signal))
    );
  }

  @Post('set-tracking')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async setTracking(
    @Body(new ZodValidationPipe(WorktreeTrackingSchema)) body: WorktreeTrackingRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeSetTrackingResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.setTracking(body, signal))
    );
  }

  @Post('stash-list')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async stashList(
    @Body(new ZodValidationPipe(WorktreePathSchema)) body: WorktreePathRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeStashListResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.stashList(body, signal))
    );
  }

  @Post('stash-push')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async stashPush(
    @Body(new ZodValidationPipe(WorktreeStashPushSchema)) body: WorktreeStashPushRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeStashPushResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.stashPush(body, signal))
    );
  }

  @Post('stash-apply')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async stashApply(
    @Body(new ZodValidationPipe(WorktreeStashApplySchema)) body: WorktreeStashApplyRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeStashApplyResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.stashApply(body, signal))
    );
  }

  @Post('stash-drop')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async stashDrop(
    @Body(new ZodValidationPipe(WorktreeStashDropSchema)) body: WorktreeStashDropRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeStashDropResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.stashDrop(body, signal))
    );
  }

  @Post('checkout-branch')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async checkoutBranch(
    @Body(new ZodValidationPipe(WorktreeCheckoutBranchSchema))
    body: WorktreeCheckoutBranchRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeCheckoutBranchResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.checkoutBranch(body, signal))
    );
  }

  @Post('switch-branch')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async switchBranch(
    @Body(new ZodValidationPipe(WorktreeSwitchBranchSchema)) body: WorktreeSwitchBranchRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeSwitchBranchResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.switchBranch(body, signal))
    );
  }

  @Post('discard-changes')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async discardChanges(
    @Body(new ZodValidationPipe(WorktreeDiscardSchema)) body: WorktreeDiscardRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeDiscardChangesResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.discardChanges(body, signal))
    );
  }

  @Post('pull')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async pull(
    @Body(new ZodValidationPipe(WorktreePullSchema)) body: WorktreePullRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreePullResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.pull(body, signal))
    );
  }

  @Post('push')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async push(
    @Body(new ZodValidationPipe(WorktreePushSchema)) body: WorktreePushRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreePushResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.push(body, signal))
    );
  }

  @Post('sync')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async sync(
    @Body(new ZodValidationPipe(WorktreeSyncSchema)) body: WorktreeSyncRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeSyncResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.sync(body, signal))
    );
  }

  @Post('rebase')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async rebase(
    @Body(new ZodValidationPipe(WorktreeRebaseSchema)) body: WorktreeRebaseRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeRebaseResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.rebase(body, signal))
    );
  }

  @Post('cherry-pick')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async cherryPick(
    @Body(new ZodValidationPipe(WorktreeCherryPickSchema)) body: WorktreeCherryPickRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeCherryPickResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.cherryPick(body, signal))
    );
  }

  @Post('merge')
  @HttpCode(200)
  @AllowedPathFields('projectPath', 'worktreePath')
  async merge(
    @Body(new ZodValidationPipe(WorktreeMergeSchema)) body: WorktreeMergeRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeMergeResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.merge(body, signal))
    );
  }

  @Post('create')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async create(
    @Body(new ZodValidationPipe(WorktreeCreateSchema)) body: WorktreeCreateRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeCreateResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.create(body, signal))
    );
  }

  @Post('delete')
  @HttpCode(200)
  @AllowedPathFields('projectPath', 'worktreePath')
  async delete(
    @Body(new ZodValidationPipe(WorktreeDeleteSchema)) body: WorktreeDeleteRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeDeleteResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.delete(body, signal))
    );
  }

  @Post('init-git')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async initGit(
    @Body(new ZodValidationPipe(WorktreeInitGitSchema)) body: WorktreeInitGitRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeInitGitResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.initGit(body, signal))
    );
  }

  @Get('init-script')
  @AllowedPathFields('projectPath')
  async getInitScript(
    @Query(new ZodValidationPipe(WorktreeInitScriptQuerySchema)) query: WorktreeInitScriptQuery,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeGetInitScriptResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.getInitScript(query, signal))
    );
  }

  @Put('init-script')
  @AllowedPathFields('projectPath')
  async putInitScript(
    @Body(new ZodValidationPipe(WorktreeInitScriptWriteSchema))
    body: WorktreeInitScriptWriteRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreePutInitScriptResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.putInitScript(body, signal))
    );
  }

  @Delete('init-script')
  @AllowedPathFields('projectPath')
  async deleteInitScript(
    @Body(new ZodValidationPipe(WorktreeInitScriptDeleteSchema))
    body: WorktreeInitScriptDeleteRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeDeleteInitScriptResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.deleteInitScript(body, signal))
    );
  }

  @Post('run-init-script')
  @HttpCode(200)
  @AllowedPathFields('projectPath', 'worktreePath')
  async runInitScript(
    @Body(new ZodValidationPipe(WorktreeRunInitScriptSchema)) body: WorktreeRunInitScriptRequest
  ) {
    return WorktreeRunInitScriptResponseSchema.parse(await this.worktrees.runInitScript(body));
  }

  @Post('migrate')
  @HttpCode(200)
  @AllowedPathFields('projectPath')
  async migrate(@Body(new ZodValidationPipe(WorktreeInitGitSchema)) body: WorktreeInitGitRequest) {
    return WorktreeMigrateResponseSchema.parse(await this.worktrees.migrate(body));
  }

  @Get('available-editors')
  async availableEditors() {
    return WorktreeAvailableEditorsResponseSchema.parse(await this.host.availableEditors());
  }

  @Get('default-editor')
  async defaultEditor() {
    return WorktreeDefaultEditorResponseSchema.parse(await this.host.defaultEditor());
  }

  @Post('refresh-editors')
  @HttpCode(200)
  async refreshEditors() {
    return WorktreeRefreshEditorsResponseSchema.parse(await this.host.refreshEditors());
  }

  @Post('open-in-editor')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async openInEditor(
    @Body(new ZodValidationPipe(WorktreeOpenEditorSchema)) body: WorktreeOpenEditorRequest
  ) {
    return WorktreeOpenEditorResponseSchema.parse(await this.host.openEditor(body));
  }

  @Get('available-terminals')
  async availableTerminals() {
    return WorktreeAvailableTerminalsResponseSchema.parse(await this.host.availableTerminals());
  }

  @Get('default-terminal')
  async defaultTerminal() {
    return WorktreeDefaultTerminalResponseSchema.parse(await this.host.defaultTerminal());
  }

  @Post('refresh-terminals')
  @HttpCode(200)
  async refreshTerminals() {
    return WorktreeRefreshTerminalsResponseSchema.parse(await this.host.refreshTerminals());
  }

  @Post('open-in-terminal')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async openInTerminal(
    @Body(new ZodValidationPipe(WorktreeOpenTerminalSchema)) body: WorktreeOpenTerminalRequest
  ) {
    return WorktreeOpenTerminalResponseSchema.parse(await this.host.openTerminal(body, false));
  }

  @Post('open-in-external-terminal')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async openInExternalTerminal(
    @Body(new ZodValidationPipe(WorktreeOpenTerminalSchema)) body: WorktreeOpenTerminalRequest
  ) {
    return WorktreeOpenExternalTerminalResponseSchema.parse(
      await this.host.openTerminal(body, true)
    );
  }

  @Post('generate-commit-message')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async generateCommitMessage(
    @Body(new ZodValidationPipe(WorktreeGenerateCommitMessageSchema))
    body: WorktreeGenerateCommitMessageRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeGenerateCommitMessageResponseSchema.parse(
      await this.cancelController(response, (controller) =>
        this.text.generateCommitMessage(body, controller)
      )
    );
  }

  @Post('generate-pr-description')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async generatePrDescription(
    @Body(new ZodValidationPipe(WorktreeGeneratePrDescriptionSchema))
    body: WorktreeGeneratePrDescriptionRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeGeneratePrDescriptionResponseSchema.parse(
      await this.cancelController(response, (controller) =>
        this.text.generatePrDescription(body, controller)
      )
    );
  }

  @Post('pr-info')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async prInfo(
    @Body(new ZodValidationPipe(WorktreePrInfoSchema)) body: WorktreePrInfoRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreePrInfoResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.prInfo(body, signal))
    );
  }

  @Post('update-pr-number')
  @HttpCode(200)
  @AllowedPathFields('worktreePath', 'projectPath?')
  async updatePrNumber(
    @Body(new ZodValidationPipe(WorktreeUpdatePrNumberSchema)) body: WorktreeUpdatePrNumberRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeUpdatePrNumberResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.updatePrNumber(body, signal))
    );
  }

  @Post('create-pr')
  @HttpCode(200)
  @AllowedPathFields('worktreePath', 'projectPath?')
  async createPr(
    @Body(new ZodValidationPipe(WorktreeCreatePrSchema)) body: WorktreeCreatePrRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeCreatePrResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.createPr(body, signal))
    );
  }

  @Post('commit-log')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async commitLog(
    @Body(new ZodValidationPipe(WorktreeCommitLogSchema)) body: WorktreeCommitLogRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeCommitLogResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.commitLog(body, signal))
    );
  }

  @Post('branch-commit-log')
  @HttpCode(200)
  @AllowedPathFields('worktreePath')
  async branchCommitLog(
    @Body(new ZodValidationPipe(WorktreeBranchCommitLogSchema))
    body: WorktreeBranchCommitLogRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return WorktreeBranchCommitLogResponseSchema.parse(
      await this.cancel(response, (signal) => this.worktrees.branchCommitLog(body, signal))
    );
  }

  @Post('start-dev')
  @HttpCode(200)
  @AllowedPathFields('projectPath', 'worktreePath')
  async startDev(@Body(new ZodValidationPipe(StartDevSchema)) body: StartDevRequest) {
    return WorktreeStartDevResponseSchema.parse(await this.processes.startDev(body));
  }

  @Post('stop-dev')
  @HttpCode(200)
  @AllowedPathFields('worktreePath?')
  async stopDev(@Body(new ZodValidationPipe(DevSessionSchema)) body: DevSessionRequest) {
    return WorktreeStopDevResponseSchema.parse(await this.processes.stopDev(body));
  }

  @Post('list-dev-servers')
  @HttpCode(200)
  async listDevServers() {
    return WorktreeListDevResponseSchema.parse(await this.processes.listDev());
  }

  @Get('dev-server-logs')
  @AllowedPathFields('worktreePath?')
  async devServerLogs(@Query(new ZodValidationPipe(DevSessionSchema)) query: DevSessionRequest) {
    return WorktreeDevLogsResponseSchema.parse(await this.processes.devLogs(query));
  }

  @Post('start-tests')
  @HttpCode(200)
  @AllowedPathFields('worktreePath', 'projectPath?')
  async startTests(@Body(new ZodValidationPipe(StartTestsSchema)) body: StartTestsRequest) {
    return WorktreeStartTestsResponseSchema.parse(await this.processes.startTests(body));
  }

  @Post('stop-tests')
  @HttpCode(200)
  async stopTests(@Body(new ZodValidationPipe(StopTestsSchema)) body: StopTestsRequest) {
    return WorktreeStopTestsResponseSchema.parse(await this.processes.stopTests(body));
  }

  @Get('test-logs')
  @AllowedPathFields('worktreePath?')
  async testLogs(@Query(new ZodValidationPipe(TestLogsSchema)) query: TestLogsRequest) {
    return WorktreeTestLogsResponseSchema.parse(await this.processes.testLogs(query));
  }

  private async cancel<T>(response: Response, operation: (signal: AbortSignal) => Promise<T>) {
    return this.cancelController(response, (controller) => operation(controller.signal));
  }

  private async cancelController<T>(
    response: Response,
    operation: (controller: AbortController) => Promise<T>
  ) {
    const controller = new AbortController();
    const close = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.on('close', close);
    try {
      return await operation(controller);
    } finally {
      response.off('close', close);
    }
  }
}
