import { Inject, Injectable } from '@nestjs/common';
import { CLAUDE_MODEL_MAP } from '@automaker/model-resolver';
import { RuntimePathsService } from '../../core/config/index.js';
import { UnknownOutcomeDomainError } from '../../core/errors/index.js';
import { getPromptCustomization } from '../../lib/settings-helpers.js';
import { SettingsService } from '../../services/settings-service.js';
import { CONTEXT_QUERY_PORT, type ContextQueryPort } from '../context/context-query.port.js';

@Injectable()
export class FeatureTitleService {
  constructor(
    @Inject(CONTEXT_QUERY_PORT) private readonly queries: ContextQueryPort,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(RuntimePathsService) private readonly paths: RuntimePathsService
  ) {}

  async generate(
    description: string,
    projectPath: string | undefined,
    abortController: AbortController
  ) {
    const prompts = await getPromptCustomization(this.settings, '[GenerateTitle]');
    const credentials = await this.settings.getCredentials();
    const result = await this.queries.execute({
      prompt: `${prompts.titleGeneration.systemPrompt}\n\nGenerate a concise title for this feature:\n\n${description}`,
      model: CLAUDE_MODEL_MAP.haiku,
      cwd: projectPath ?? this.paths.workingDirectory,
      maxTurns: 1,
      allowedTools: [],
      credentials,
      abortController,
    });
    if (!result.text?.trim()) {
      throw new UnknownOutcomeDomainError('Failed to generate title - empty response');
    }
    return { success: true as const, title: result.text.trim() };
  }
}
