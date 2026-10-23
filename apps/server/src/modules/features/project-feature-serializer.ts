import { Injectable } from '@nestjs/common';

@Injectable()
export class ProjectFeatureSerializer {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(projectPath: string, operation: () => Promise<T>): Promise<T> {
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
