import { ConflictDomainError, UnavailableDomainError } from '../../core/errors/domain-errors.js';
import { assertCanonicalAgentSessionId } from './agent-session-id.js';

interface Execution {
  controller: AbortController;
  task: Promise<unknown>;
  selected: boolean;
}

/** Reserves ownership before any await; cancellation never releases an unsettled run. */
export class AgentExecutionCoordinator {
  private readonly executions = new Map<string, Execution>();
  private readonly mutations = new Map<string, Promise<unknown>>();
  private accepting = true;

  constructor(private readonly drainTimeoutMs = 5000) {}

  assertAccepting(): void {
    if (!this.accepting) throw new UnavailableDomainError('Agent execution is shutting down.');
  }

  assertSessionOpen(id: string): void {
    this.assertAccepting();
    assertCanonicalAgentSessionId(id);
    if (this.mutations.has(id)) throw new ConflictDomainError('Agent session state is changing.');
  }

  run<T>(id: string, operation: (controller: AbortController) => Promise<T>): Promise<T> {
    this.assertSessionOpen(id);
    if (this.executions.has(id) || this.mutations.has(id))
      throw new ConflictDomainError(
        'Agent is already processing a message or changing session state.'
      );
    const execution: Execution = {
      controller: new AbortController(),
      task: Promise.resolve(),
      selected: false,
    };
    const task = Promise.resolve()
      .then(() => operation(execution.controller))
      .finally(() => {
        if (this.executions.get(id) === execution) this.executions.delete(id);
      });
    execution.task = task;
    this.executions.set(id, execution);
    return task;
  }

  /** Serialize destructive operations and reserve their barrier before requesting abort. */
  mutate<T>(id: string, operation: () => Promise<T>, cancelActive = true): Promise<T> {
    assertCanonicalAgentSessionId(id);
    if (!this.accepting)
      return Promise.reject(new UnavailableDomainError('Agent execution is shutting down.'));
    const task = (this.mutations.get(id) ?? Promise.resolve()).then(async () => {
      if (cancelActive) await this.cancelAndDrain(id);
      else if (this.executions.has(id))
        throw new ConflictDomainError('Stop the active agent before changing its model.');
      return operation();
    });
    const tail = task.then(
      () => undefined,
      () => undefined
    );
    this.mutations.set(id, tail);
    void tail.then(() => {
      if (this.mutations.get(id) === tail) this.mutations.delete(id);
    });
    return task;
  }

  stopAccepting(): void {
    this.accepting = false;
  }
  markSelected(id: string, controller: AbortController): void {
    const execution = this.executions.get(id);
    if (execution?.controller === controller) execution.selected = true;
  }
  runningIds(): readonly string[] {
    return [...this.executions].filter(([, execution]) => execution.selected).map(([id]) => id);
  }
  abortAll(): void {
    for (const execution of this.executions.values()) execution.controller.abort();
  }
  ids(): readonly string[] {
    return [...this.executions.keys()];
  }
  has(id: string): boolean {
    return this.executions.has(id);
  }

  async cancelAndDrain(id: string): Promise<void> {
    const execution = this.executions.get(id);
    if (!execution) return;
    execution.controller.abort();
    await this.wait([execution.task]);
  }

  async drain(): Promise<void> {
    await this.wait(
      [...this.executions.values()]
        .map((execution) => execution.task)
        .concat([...this.mutations.values()])
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopAccepting();
    this.abortAll();
    await this.drain();
  }

  private async wait(tasks: readonly Promise<unknown>[]): Promise<void> {
    if (!tasks.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(tasks),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new UnavailableDomainError(
                  'Agent execution has not stopped. The session remains blocked; no replacement was started.'
                )
              ),
            this.drainTimeoutMs
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
