import { Inject, Injectable } from '@nestjs/common';
import { SecurityService } from '../../core/security/index.js';

@Injectable()
export class ProjectFeatureSerializer {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(@Inject(SecurityService) private readonly security?: SecurityService) {}

  run<T>(projectPath: string, operation: () => Promise<T>): Promise<T> {
    projectPath = this.security?.validateLocalPath(projectPath, 'feature command') ?? projectPath;
    const previous = this.tails.get(projectPath) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    this.tails.set(projectPath, tail);
    void tail.finally(() => {
      if (this.tails.get(projectPath) === tail) this.tails.delete(projectPath);
    });
    return result;
  }
}
