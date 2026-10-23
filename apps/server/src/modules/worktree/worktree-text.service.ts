import { Inject, Injectable } from '@nestjs/common';
import { resolvePhaseModel } from '@automaker/model-resolver';
import { mergeCommitMessagePrompts } from '@automaker/prompts';
import { UnknownOutcomeDomainError, ValidationDomainError } from '../../core/errors/index.js';
import { getPhaseModelWithOverrides } from '../../lib/settings-helpers.js';
import { ProjectGitService } from '../../services/execution-environment/project-git.js';
import { SettingsService } from '../../services/settings-service.js';
import { CONTEXT_QUERY_PORT, type ContextQueryPort } from '../context/context-query.port.js';
import type {
  WorktreeGenerateCommitMessageRequest,
  WorktreeGeneratePrDescriptionRequest,
} from './worktree.schemas.js';

const PR_SYSTEM_PROMPT = `You generate pull request descriptions. Output only this exact structure:
---TITLE---
<a concise imperative title>
---BODY---
## Summary
<1-3 bullets>

## Changes
<the meaningful changes and why>`;

@Injectable()
export class WorktreeTextService {
  constructor(
    @Inject(ProjectGitService) private readonly git: ProjectGitService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(CONTEXT_QUERY_PORT) private readonly queries: ContextQueryPort
  ) {}

  async generateCommitMessage(
    input: WorktreeGenerateCommitMessageRequest,
    abortController: AbortController
  ) {
    const context = await this.context(
      'commit-message-context',
      input.worktreePath,
      input,
      abortController.signal
    );
    const diff = String(context.diff ?? '');
    if (!diff.trim()) throw new ValidationDomainError('No changes to commit');
    const model = await this.model(input.worktreePath, '[GenerateCommitMessage]');
    const prompts = mergeCommitMessagePrompts(
      (await this.settings.getGlobalSettings()).promptCustomization?.commitMessage
    );
    const result = await this.queries.execute({
      ...model,
      settingsService: this.settings,
      cwd: input.worktreePath,
      prompt: `Generate a commit message for these changes:\n\n\`\`\`diff\n${diff}\n\`\`\``,
      systemPrompt: prompts.systemPrompt,
      maxTurns: 1,
      allowedTools: [],
      readOnly: true,
      abortController,
    });
    const message = result.text.trim();
    if (!message) throw new UnknownOutcomeDomainError('Commit message provider returned no text');
    return { success: true as const, message };
  }

  async generatePrDescription(
    input: WorktreeGeneratePrDescriptionRequest,
    abortController: AbortController
  ) {
    const context = await this.context(
      'pr-description-context',
      input.worktreePath,
      input,
      abortController.signal
    );
    const diff = String(context.diff ?? '');
    const commitLog = String(context.commitLog ?? '');
    if (!diff.trim() && !commitLog.trim())
      throw new ValidationDomainError('No branch changes found for a PR description');
    const model = await this.model(input.worktreePath, '[GeneratePRDescription]');
    const result = await this.queries.execute({
      ...model,
      settingsService: this.settings,
      cwd: input.worktreePath,
      prompt: `Branch: ${String(context.branch)}\nBase: ${input.baseBranch ?? 'main'}\n\nCommits:\n${commitLog}\n\nDiff:\n\`\`\`diff\n${diff}\n\`\`\``,
      systemPrompt: PR_SYSTEM_PROMPT,
      maxTurns: 1,
      allowedTools: [],
      readOnly: true,
      abortController,
    });
    const text = result.text.trim();
    const match = /^---TITLE---\s*\n([\s\S]*?)\n---BODY---\s*\n([\s\S]+)$/m.exec(text);
    if (!match?.[1]?.trim() || !match[2]?.trim())
      throw new UnknownOutcomeDomainError('PR description provider returned an invalid format');
    return { success: true as const, title: match[1].trim(), body: match[2].trim() };
  }

  private async context(
    action: string,
    worktreePath: string,
    body: Record<string, unknown>,
    signal: AbortSignal
  ) {
    const target = await this.git.resolveOrLocal(worktreePath);
    return this.git.run(target, action, body, signal);
  }

  private async model(cwd: string, prefix: string) {
    const { phaseModel, provider, credentials } = await getPhaseModelWithOverrides(
      'commitMessageModel',
      this.settings,
      cwd,
      prefix
    );
    const resolved = resolvePhaseModel(phaseModel);
    return {
      providerId: phaseModel.providerId,
      model: resolved.model,
      thinkingLevel: resolved.thinkingLevel,
      claudeCompatibleProvider: provider,
      credentials,
    };
  }
}
