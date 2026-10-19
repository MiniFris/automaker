import { OpenAICompatibleError } from './errors.js';

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new OpenAICompatibleError('Agent operation cancelled or timed out.');
}

/** Stop awaiting promptly; the operation must also observe signal and release its own resources. */
export async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) void operation.catch(() => {});
  checkAbort(signal);
  let listener: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    listener = () => reject(new OpenAICompatibleError('Agent operation cancelled or timed out.'));
    signal.addEventListener('abort', listener, { once: true });
  });
  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    signal.removeEventListener('abort', listener);
  }
}

export class AgentLimitError extends OpenAICompatibleError {
  constructor(
    message: string,
    readonly subtype: 'error_max_turns' | 'error_during_execution' = 'error_during_execution'
  ) {
    super(message);
  }
}

export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
