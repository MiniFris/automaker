import { ChildProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { UnavailableDomainError } from '../core/errors/domain-errors.js';
import {
  nodeOwnedLocalChildRuntime,
  type OwnedLocalChildRuntime,
  type OwnedLocalChildTarget,
} from '../core/platform/owned-local-child.runtime.js';

export class OwnedLocalChildCleanupError extends UnavailableDomainError {
  readonly status = 503;
  readonly code = 'LOCAL_PROCESS_CLEANUP_FAILED';
  constructor() {
    super('Local process cleanup could not be confirmed. Identity was retained.');
  }
}
export interface OwnedLocalChildOptions {
  cleanupTimeoutMs?: number;
  termGraceMs?: number;
  runtime?: OwnedLocalChildRuntime;
}
export interface OwnedLocalChild {
  ready(): Promise<void>;
  completion(): Promise<void>;
  close(): Promise<void>;
  readonly closing: boolean;
}

/** One original spawned child/group. Exit notification alone never certifies completion. */
export function createOwnedLocalChild(
  child: ChildProcess,
  options: OwnedLocalChildOptions = {}
): OwnedLocalChild {
  const cleanupMs = options.cleanupTimeoutMs ?? 5000,
    graceMs = options.termGraceMs ?? 1000;
  if (!Number.isFinite(cleanupMs) || cleanupMs <= 0 || !Number.isFinite(graceMs) || graceMs < 0)
    throw new Error('Invalid local child cleanup limits.');
  let target: OwnedLocalChildTarget | undefined,
    captureFailed = false;
  const awaitingSpawnProof = child.pid === undefined && child instanceof ChildProcess;
  let spawnSeen = child.pid !== undefined;
  let resolveSpawnOutcome!: (noProcessCreated: boolean) => void;
  const spawnOutcome = new Promise<boolean>((resolve) => {
    resolveSpawnOutcome = resolve;
  });
  let rootExited = child.exitCode !== null || child.signalCode !== null;
  let resolveRoot!: () => void;
  const rootExit = new Promise<void>((resolve) => {
    resolveRoot = resolve;
  });
  let resolveCompletion!: () => void, rejectCompletion!: (error: unknown) => void;
  const completed = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  // Consumers may attach after spawn returns; prevent an unhandled observer rejection.
  void completed.catch(() => {});
  let closed: Promise<void> | undefined;
  const onExit = () => {
    rootExited = true;
    resolveRoot();
    void owner.close().catch(() => {});
  };
  child.once('exit', onExit);
  child.once('spawn', () => {
    spawnSeen = true;
    resolveSpawnOutcome(false);
  });
  child.on('error', () => {
    // Only an original ChildProcess's failed initial spawn proves no resource was created.
    // An error after spawn (including IPC failure) is not termination evidence.
    if (awaitingSpawnProof && !spawnSeen && child.pid === undefined) {
      resolveSpawnOutcome(true);
      onExit();
    }
  });
  try {
    target = (options.runtime ?? nodeOwnedLocalChildRuntime).capture(child);
  } catch {
    captureFailed = true;
  }
  const ready = captureFailed
    ? Promise.reject(new OwnedLocalChildCleanupError())
    : Promise.resolve();
  void ready.catch(() => {});

  const owner: OwnedLocalChild = {
    get closing() {
      return Boolean(closed);
    },
    ready: () => ready,
    completion: () => completed,
    close() {
      if (closed) return closed;
      closed = drain();
      void closed.then(resolveCompletion, rejectCompletion);
      return closed;
    },
  };
  if (rootExited) {
    resolveRoot();
    queueMicrotask(() => {
      void owner.close().catch(() => {});
    });
  }
  async function drain(): Promise<void> {
    const deadline = performance.now() + cleanupMs;
    const observer = new AbortController();
    let escalation: NodeJS.Timeout | undefined, timer: NodeJS.Timeout | undefined;
    try {
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          observer.abort();
          reject(new OwnedLocalChildCleanupError());
        }, cleanupMs);
      });
      const work = async () => {
        if (captureFailed || !target) {
          if (awaitingSpawnProof && (await spawnOutcome)) {
            observer.signal.throwIfAborted();
            if (performance.now() >= deadline) throw new OwnedLocalChildCleanupError();
            return;
          }
          throw new OwnedLocalChildCleanupError();
        }
        try {
          await target!.prepare(observer.signal);
        } catch {
          /* Existing authority is rechecked by signal. */
        }
        observer.signal.throwIfAborted();
        try {
          target!.signal('SIGTERM');
        } catch {
          /* Only quiescence can confirm completion. */
        }
        let escalated!: () => void;
        const escalationAttempted = new Promise<void>((resolve) => {
          escalated = resolve;
        });
        escalation = setTimeout(
          () => {
            try {
              if (!observer.signal.aborted && performance.now() < deadline)
                target!.signal('SIGKILL');
            } catch {
              /* Unknown authority cannot authorize a signal. */
            } finally {
              escalated();
            }
          },
          Math.min(graceMs, Math.max(0, cleanupMs - 1))
        );
        await Promise.all([
          rootExit,
          target!.waitForQuiescence(observer.signal).catch(async (error) => {
            // Observation failure must not skip the remaining independently safe cleanup attempt.
            await escalationAttempted;
            throw error;
          }),
        ]);
        if (performance.now() >= deadline) throw new OwnedLocalChildCleanupError();
      };
      await Promise.race([work(), expired]);
    } catch {
      throw new OwnedLocalChildCleanupError();
    } finally {
      observer.abort();
      clearTimeout(escalation);
      clearTimeout(timer);
    }
  }
  return owner;
}
