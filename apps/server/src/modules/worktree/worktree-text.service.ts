import { Inject, Injectable } from '@nestjs/common';
import { resolvePhaseModel } from '@automaker/model-resolver';
import { mergeCommitMessagePrompts } from '@automaker/prompts';
import { UnknownOutcomeDomainError, ValidationDomainError } from '../../core/errors/index.js';
import { DomainError, UnavailableDomainError } from '../../core/errors/domain-errors.js';
import { getModelProvider, modelTimeout, providerModelTimeouts } from '@automaker/types';
import { ProviderCleanupError } from '../../providers/provider-execution-scope.js';
import type {
  SimpleQueryOptions,
  SimpleQueryResult,
} from '../../providers/simple-query-service.js';
import { getPhaseModelWithOverrides } from '../../lib/settings-helpers.js';
import { ProjectGitService } from '../../services/execution-environment/project-git.js';
import { ExecutionEnvironmentError } from '../../services/execution-environment/runtime.js';
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

interface TextQueryEntry {
  controller: AbortController;
  task: Promise<SimpleQueryResult>;
  unknown: boolean;
}

@Injectable()
export class WorktreeTextService {
  private readonly active = new Set<TextQueryEntry>();
  private stopping = false;
  private shutdown?: Promise<void>;
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
    const result = await this.queryWithDeadline('commitMessageTimeoutMs', {
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
    const result = await this.queryWithDeadline('prDescriptionTimeoutMs', {
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
    if (target.runtime.type !== 'local')
      throw new ExecutionEnvironmentError(
        'GIT_OPERATION_UNSUPPORTED',
        'Text generation is unavailable for this managed target. No controller provider or Git command was started.'
      );
    return this.git.run(target, action, body, signal);
  }

  private async queryWithDeadline(
    purpose: 'commitMessageTimeoutMs' | 'prDescriptionTimeoutMs',
    options: SimpleQueryOptions
  ) {
    if (this.stopping || this.active.size >= 16 || [...this.active].some((item) => item.unknown))
      throw new UnavailableDomainError(
        'Text generation is closing or its previous outcome is unconfirmed.'
      );
    const settings = await this.settings.getGlobalSettings();
    if (this.stopping || this.active.size >= 16 || [...this.active].some((item) => item.unknown))
      throw new UnavailableDomainError('Text generation is unavailable.');
    const timeoutMs = modelTimeout(
      providerModelTimeouts(settings, getModelProvider(options.model ?? 'claude')),
      purpose
    );
    const controller = options.abortController ?? new AbortController();
    controller.signal.throwIfAborted();
    const entry: TextQueryEntry = {
      controller,
      task: Promise.resolve({ text: '' }),
      unknown: false,
    };
    entry.task = Promise.resolve()
      .then(() => {
        if (this.stopping) throw new UnavailableDomainError('Text generation is closing.');
        return this.queries.execute({ ...options, abortController: controller });
      })
      .finally(() => {
        if (!entry.unknown) this.active.delete(entry);
      });
    this.active.add(entry);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    try {
      const result = await Promise.race([
        entry.task,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(new Error(`AI provider timed out after ${timeoutMs}ms`));
            controller.abort();
          }, timeoutMs);
        }),
      ]);
      controller.signal.throwIfAborted();
      if (this.stopping) throw new UnavailableDomainError('Text generation is closing.');
      return result;
    } catch (error) {
      if (expired) {
        await this.confirmSettled(entry);
        throw new DomainError(`AI provider timed out after ${timeoutMs}ms`, 'TIMEOUT', 500);
      }
      if (error instanceof ProviderCleanupError) {
        entry.unknown = true;
        this.active.add(entry);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async confirmSettled(entry: TextQueryEntry) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        entry.task.catch((error) => {
          if (error instanceof ProviderCleanupError) throw error;
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new ProviderCleanupError()), 5000);
        }),
      ]);
    } catch (error) {
      entry.unknown = true;
      this.active.add(entry);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  onModuleDestroy(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopping = true;
    const entries = [...this.active];
    for (const entry of entries) entry.controller.abort();
    return (this.shutdown = (async () => {
      const settled = await Promise.allSettled(entries.map((entry) => this.confirmSettled(entry)));
      if (
        settled.some((item) => item.status === 'rejected') ||
        entries.some((entry) => entry.unknown)
      )
        throw new ProviderCleanupError();
    })());
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
