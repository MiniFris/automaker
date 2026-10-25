import { Inject, Injectable } from '@nestjs/common';
import path from 'node:path';
import { getMimeTypeForImage } from '@automaker/utils';
import { isCursorModel } from '@automaker/types';
import { resolvePhaseModel } from '@automaker/model-resolver';
import {
  DomainError,
  NotFoundDomainError,
  UnavailableDomainError,
  UnknownOutcomeDomainError,
  ValidationDomainError,
  mapInfrastructureError,
} from '../../core/errors/index.js';
import {
  getAutoLoadClaudeMdSetting,
  getPhaseModelWithOverrides,
  getPromptCustomization,
} from '../../lib/settings-helpers.js';
import { SettingsService } from '../../services/settings-service.js';
import { PROJECT_FILE_PORT, type ProjectFilePort } from '../files/project-file.port.js';
import { CONTEXT_QUERY_PORT, type ContextQueryPort } from './context-query.port.js';

const MAX_TEXT_CHARACTERS = 50_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp']);

export class ContextPayloadTooLargeError extends DomainError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 413);
  }
}

@Injectable()
export class ContextDescriptionService {
  constructor(
    @Inject(PROJECT_FILE_PORT) private readonly files: ProjectFilePort,
    @Inject(CONTEXT_QUERY_PORT) private readonly queries: ContextQueryPort,
    @Inject(SettingsService) private readonly settings: SettingsService
  ) {}

  async describeFile(filePath: string, abortController: AbortController) {
    let content: string;
    try {
      content = await this.files.read(filePath);
    } catch (error) {
      throw this.mapFileError(error, `File not found: ${filePath}`);
    }

    const truncated = content.length > MAX_TEXT_CHARACTERS;
    const contentToAnalyze = truncated ? content.slice(0, MAX_TEXT_CHARACTERS) : content;
    const cwd = path.dirname(path.resolve(filePath));
    const prompts = await getPromptCustomization(this.settings, '[DescribeFile]');
    const prompt = `${prompts.contextDescription.describeFilePrompt}\n\nFile: ${path.basename(filePath)}${truncated ? ' (truncated)' : ''}\n\n--- FILE CONTENT ---\n${contentToAnalyze}`;
    const modelContext = await this.resolveModel('fileDescriptionModel', cwd, '[DescribeFile]');
    const result = await this.queries.execute({
      settingsService: this.settings,
      providerId: modelContext.phaseModelEntry.providerId,
      prompt,
      model: modelContext.model,
      cwd,
      maxTurns: 1,
      allowedTools: [],
      thinkingLevel: modelContext.thinkingLevel,
      readOnly: true,
      settingSources: modelContext.autoLoadClaudeMd ? ['user', 'project', 'local'] : undefined,
      claudeCompatibleProvider: modelContext.provider,
      credentials: modelContext.credentials,
      abortController,
    });
    return this.descriptionResponse(result.text);
  }

  async describeImage(imagePath: string, abortController: AbortController) {
    const actualPath = await this.findActualFilePath(imagePath);
    if (!actualPath) throw new NotFoundDomainError(`File not found: ${imagePath}`);

    const extension = path.extname(actualPath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) {
      throw new ValidationDomainError('Unsupported image type.');
    }

    let content: Buffer;
    try {
      const stats = await this.files.stat(actualPath);
      if (!stats.isFile) throw new ValidationDomainError('Image path must refer to a file.');
      if (stats.size > MAX_IMAGE_BYTES) {
        throw new ContextPayloadTooLargeError(
          'The image is too large to send for description. Please resize/compress it and try again.'
        );
      }
      content = await this.files.readBuffer(actualPath);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw this.mapFileError(error, `File not found: ${imagePath}`);
    }

    if (content.length > MAX_IMAGE_BYTES) {
      throw new ContextPayloadTooLargeError(
        'The image is too large to send for description. Please resize/compress it and try again.'
      );
    }

    const cwd = path.dirname(path.resolve(actualPath));
    const prompts = await getPromptCustomization(this.settings, '[DescribeImage]');
    const modelContext = await this.resolveModel('imageDescriptionModel', cwd, '[DescribeImage]');
    const mimeType = getMimeTypeForImage(actualPath);
    const prompt = isCursorModel(modelContext.model)
      ? `${prompts.contextDescription.describeImagePrompt}\n\nImage file: ${actualPath}\nMIME type: ${mimeType}`
      : [
          { type: 'text', text: prompts.contextDescription.describeImagePrompt },
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: content.toString('base64') },
          },
        ];

    try {
      const result = await this.queries.execute({
        settingsService: this.settings,
        providerId: modelContext.phaseModelEntry.providerId,
        prompt,
        model: modelContext.model,
        cwd,
        maxTurns: 1,
        allowedTools: isCursorModel(modelContext.model) ? ['Read'] : [],
        thinkingLevel: modelContext.thinkingLevel,
        readOnly: true,
        settingSources: modelContext.autoLoadClaudeMd ? ['user', 'project', 'local'] : undefined,
        claudeCompatibleProvider: modelContext.provider,
        credentials: modelContext.credentials,
        abortController,
      });
      return this.descriptionResponse(result.text);
    } catch (error) {
      throw this.mapProviderError(error);
    }
  }

  private async resolveModel(
    phase: 'fileDescriptionModel' | 'imageDescriptionModel',
    cwd: string,
    logPrefix: string
  ) {
    const autoLoadClaudeMd = await getAutoLoadClaudeMdSetting(cwd, this.settings, logPrefix);
    const {
      phaseModel: phaseModelEntry,
      provider,
      credentials,
    } = await getPhaseModelWithOverrides(phase, this.settings, cwd, logPrefix);
    const { model, thinkingLevel } = resolvePhaseModel(phaseModelEntry);
    return {
      autoLoadClaudeMd,
      phaseModelEntry,
      provider,
      credentials,
      model,
      thinkingLevel,
    };
  }

  private async findActualFilePath(requestedPath: string): Promise<string | undefined> {
    if (await this.files.exists(requestedPath)) return requestedPath;
    const normalizedPath = requestedPath.normalize('NFC');
    if (normalizedPath !== requestedPath && (await this.files.exists(normalizedPath))) {
      return normalizedPath;
    }

    const directory = path.dirname(requestedPath);
    if (!(await this.files.exists(directory))) return undefined;
    const normalizeSpaces = (value: string) => value.replace(/[\u00A0\u202F\u2009\u200A]/g, ' ');
    const basename = normalizeSpaces(path.basename(requestedPath));
    const entry = (await this.files.list(directory)).find(
      (candidate) => candidate.isFile && normalizeSpaces(candidate.name) === basename
    );
    return entry ? path.join(directory, entry.name) : undefined;
  }

  private descriptionResponse(description: string) {
    if (!description?.trim()) {
      throw new UnknownOutcomeDomainError('Failed to generate description - empty response');
    }
    return { success: true as const, description: description.trim() };
  }

  private mapFileError(error: unknown, notFoundMessage: string): DomainError {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return new NotFoundDomainError(notFoundMessage);
    }
    return mapInfrastructureError(error);
  }

  private mapProviderError(error: unknown): DomainError {
    const message = error instanceof Error ? error.message : String(error);
    if (/rate limit|429/i.test(message)) {
      return new DomainError(
        'Rate limited while describing the image. Please wait a moment and try again.',
        'UNAVAILABLE',
        429
      );
    }
    if (/payload too large|413/i.test(message)) {
      return new ContextPayloadTooLargeError(
        'The image is too large to send for description. Please resize/compress it and try again.'
      );
    }
    if (
      /Claude Code process|Claude CLI|executable not found|native binary not found/i.test(message)
    ) {
      return new UnavailableDomainError('AI provider is unavailable. Please try again.');
    }
    return error instanceof DomainError ? error : new UnknownOutcomeDomainError();
  }
}
