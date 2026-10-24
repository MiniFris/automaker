import { Inject, Injectable } from '@nestjs/common';
import { getAppSpecPath, getFeaturesDir } from '@automaker/platform';
import path from 'node:path';
import {
  CLAUDE_MODEL_MAP,
  type ClaudeCompatibleProvider,
  type Credentials,
} from '@automaker/types';
import { createLogger } from '@automaker/utils';
import { resolveModelString } from '@automaker/model-resolver';
import { RuntimePathsService } from '../../core/config/index.js';
import type * as SecureFilesystem from '../../lib/secure-fs.js';
import { SECURE_FILESYSTEM } from '../../core/security/index.js';
import { mapInfrastructureError, UnavailableDomainError } from '../../core/errors/index.js';
import {
  buildUserPrompt,
  isValidEnhancementMode,
  type EnhancementMode,
} from '../../lib/enhancement-prompts.js';
import { getPromptCustomization, getProviderByModelId } from '../../lib/settings-helpers.js';
import {
  extractTechnologyStack,
  extractXmlElements,
  extractXmlSection,
  unescapeXml,
} from '../../lib/xml-extractor.js';
import { SettingsService } from '../../services/settings-service.js';
import { PROMPT_QUERY, type PromptQuery } from './prompt-query.port.js';
import type { PromptEnhancementRequest } from './prompt-enhancement.schemas.js';

const logger = createLogger('PromptEnhancement');

@Injectable()
export class PromptEnhancementService {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(PROMPT_QUERY) private readonly query: PromptQuery,
    @Inject(RuntimePathsService) private readonly paths: RuntimePathsService,
    @Inject(SECURE_FILESYSTEM) private readonly filesystem: typeof SecureFilesystem
  ) {}

  async enhance(input: PromptEnhancementRequest) {
    const originalText = input.originalText.trim();
    if (!originalText) {
      throw new Error('originalText cannot be empty');
    }

    const normalizedMode = input.enhancementMode.toLowerCase();
    const mode: EnhancementMode = isValidEnhancementMode(normalizedMode)
      ? normalizedMode
      : 'improve';
    const prompts = await getPromptCustomization(this.settings, '[PromptEnhancement]');
    const systemPrompts: Record<EnhancementMode, string> = {
      improve: prompts.enhancement.improveSystemPrompt,
      technical: prompts.enhancement.technicalSystemPrompt,
      simplify: prompts.enhancement.simplifySystemPrompt,
      acceptance: prompts.enhancement.acceptanceSystemPrompt,
      'ux-reviewer': prompts.enhancement.uxReviewerSystemPrompt,
    };
    const projectContext = input.projectPath
      ? await this.buildProjectContext(input.projectPath)
      : null;
    const userPrompt = buildUserPrompt(mode, originalText, true);

    let provider: ClaudeCompatibleProvider | undefined;
    let providerResolvedModel: string | undefined;
    let credentials: Credentials | undefined = await this.settings.getCredentials();
    if (input.model) {
      const providerResult = await getProviderByModelId(
        input.model,
        this.settings,
        '[PromptEnhancement]'
      );
      provider = providerResult.provider;
      providerResolvedModel = providerResult.resolvedModel;
      credentials = providerResult.credentials;
    }

    const model = provider
      ? input.model
      : providerResolvedModel || resolveModelString(input.model, CLAUDE_MODEL_MAP.sonnet);
    const result = await this.query({
      settingsService: this.settings,
      providerId: input.providerId,
      prompt: [systemPrompts[mode], projectContext, userPrompt].filter(Boolean).join('\n\n'),
      model,
      cwd: this.paths.workingDirectory,
      maxTurns: 1,
      allowedTools: [],
      thinkingLevel: input.thinkingLevel,
      readOnly: true,
      credentials,
      claudeCompatibleProvider: provider,
    });
    const enhancedText = result.text.trim();
    if (!enhancedText) {
      throw new Error('Failed to generate enhanced text - empty response');
    }

    return { success: true as const, enhancedText };
  }

  private async buildProjectContext(projectPath: string): Promise<string | null> {
    const contextBlocks: string[] = [];

    try {
      const specContent = (await this.filesystem.readFile(
        getAppSpecPath(projectPath),
        'utf-8'
      )) as string;
      const projectName = extractXmlSection(specContent, 'project_name');
      const overview = extractXmlSection(specContent, 'overview');
      const techStack = extractTechnologyStack(specContent);
      const coreSection = extractXmlSection(specContent, 'core_capabilities');
      const capabilities = coreSection ? extractXmlElements(coreSection, 'capability') : [];
      const summary = [
        projectName ? `Name: ${unescapeXml(projectName.trim())}` : null,
        overview ? `Overview: ${unescapeXml(overview.trim())}` : null,
        techStack.length ? `Tech Stack: ${techStack.join(', ')}` : null,
        capabilities.length ? `Core Capabilities: ${capabilities.slice(0, 10).join(', ')}` : null,
      ].filter(Boolean);
      if (summary.length) {
        contextBlocks.push(`PROJECT CONTEXT:\n${summary.map((line) => `- ${line}`).join('\n')}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw mapInfrastructureError(error);
      logger.debug('No app_spec.txt context available for enhancement', error);
    }

    try {
      const titles = await this.featureTitles(projectPath);
      if (titles.length) {
        const listed = titles.slice(0, 30).map((title) => `- ${title}`);
        contextBlocks.push(
          `EXISTING FEATURES (avoid duplicates):\n${listed.join('\n')}${titles.length > 30 ? '\n- ...' : ''}`
        );
      }
    } catch (error) {
      throw mapInfrastructureError(error);
    }

    return contextBlocks.length ? contextBlocks.join('\n\n') : null;
  }

  private async featureTitles(projectPath: string): Promise<string[]> {
    const directory = getFeaturesDir(projectPath);
    let entries;
    try {
      entries = await this.filesystem.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const titles: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let content: string;
      try {
        content = (await this.filesystem.readFile(
          path.join(directory, entry.name, 'feature.json'),
          'utf-8'
        )) as string;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      let feature: Record<string, unknown>;
      try {
        feature = JSON.parse(content);
        if (!feature || typeof feature !== 'object' || Array.isArray(feature)) throw new Error();
      } catch {
        throw new UnavailableDomainError('Project feature context is unavailable.');
      }
      const title = [feature.title, feature.name, feature.id].find(
        (value) => typeof value === 'string' && value.length
      );
      if (typeof title === 'string') titles.push(title);
      // Only 30 titles enter the prompt; one more is enough to retain its ellipsis.
      if (titles.length > 30) break;
    }
    return titles;
  }
}
