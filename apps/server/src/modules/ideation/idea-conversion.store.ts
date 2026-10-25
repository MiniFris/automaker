import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { getFeatureDir, getIdeasDir } from '@automaker/platform';
import type { Feature } from '@automaker/types';
import { secureFs } from '@automaker/platform';
import { SECURE_FILESYSTEM } from '../../core/security/security.module.js';
import { ConflictDomainError } from '../../core/errors/index.js';

type Filesystem = Pick<typeof secureFs, 'readFile' | 'writeFile' | 'mkdir' | 'link' | 'unlink'>;
interface ConversionIntent {
  version: 1;
  ideaId: string;
  token: string;
  feature: Feature;
}
type ConvertedFeature = Feature & {
  ideationConversion: { version: 1; ideaId: string; token: string };
};

/** Durable intent and exclusive publication; ambiguous reads never become overwrite permission. */
@Injectable()
export class IdeaConversionStore {
  constructor(@Inject(SECURE_FILESYSTEM) private readonly filesystem: Filesystem) {}

  private location(project: string, ideaId: string): { file: string; featureId: string } {
    const key = createHash('sha256').update(ideaId).digest('hex');
    return {
      file: path.join(path.dirname(getIdeasDir(project)), 'conversions', key + '.json'),
      featureId: 'feature-idea-' + key.slice(0, 32),
    };
  }

  private async read<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse((await this.filesystem.readFile(file, 'utf8')) as string) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async get(project: string, ideaId: string): Promise<ConversionIntent | null> {
    const location = this.location(project, ideaId);
    const intent = await this.read<ConversionIntent>(location.file);
    if (
      intent &&
      (intent.version !== 1 ||
        intent.ideaId !== ideaId ||
        typeof intent.token !== 'string' ||
        intent.feature?.id !== location.featureId)
    )
      throw new ConflictDomainError('Idea conversion intent is inconsistent.');
    return intent;
  }

  private async publish(file: string, data: unknown): Promise<void> {
    await this.filesystem.mkdir(path.dirname(file), { recursive: true });
    const temporary = file + '.tmp.' + randomUUID();
    let failure: unknown;
    try {
      await this.filesystem.writeFile(temporary, JSON.stringify(data, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      try {
        await this.filesystem.link(temporary, file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    } catch (error) {
      failure = error;
    } finally {
      try {
        await this.filesystem.unlink(temporary);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failure ??= error;
      }
    }
    if (failure) throw failure;
  }

  async prepare(project: string, ideaId: string, data: Feature): Promise<ConversionIntent> {
    const location = this.location(project, ideaId);
    const now = new Date().toISOString();
    const feature: Feature = {
      ...data,
      id: location.featureId,
      createdAt: now,
      descriptionHistory: data.description?.trim()
        ? [{ description: data.description, timestamp: now, source: 'initial' }]
        : [],
    };
    await this.publish(location.file, { version: 1, ideaId, token: randomUUID(), feature });
    const intent = await this.get(project, ideaId);
    if (!intent) throw new Error('Idea conversion intent publication could not be confirmed.');
    return intent;
  }

  async createFeature(project: string, intent: ConversionIntent): Promise<Feature> {
    const file = path.join(getFeatureDir(project, intent.feature.id), 'feature.json');
    let existing = await this.read<ConvertedFeature>(file);
    if (!existing) {
      await this.publish(file, {
        ...intent.feature,
        ideationConversion: { version: 1, ideaId: intent.ideaId, token: intent.token },
      });
      existing = await this.read<ConvertedFeature>(file);
    }
    if (
      !existing ||
      existing.id !== intent.feature.id ||
      existing.ideationConversion?.version !== 1 ||
      existing.ideationConversion.ideaId !== intent.ideaId ||
      existing.ideationConversion.token !== intent.token
    )
      throw new ConflictDomainError(
        'Idea conversion feature identity conflicts with existing data.'
      );
    return existing;
  }
}
