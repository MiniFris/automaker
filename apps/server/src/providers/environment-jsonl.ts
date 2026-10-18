import { StringDecoder } from 'node:string_decoder';
import { DEFAULT_MODEL_TIMEOUTS } from '@automaker/types';
import type { SubprocessOptions } from '@automaker/platform';
import type { ExecutionEnvironment } from '../services/execution-environment/runtime.js';
import { ExecutionEnvironmentError } from '../services/execution-environment/runtime.js';

/** Streams JSONL without shell expansion, environment forwarding, replay or unbounded buffering. */
export async function* environmentJSONL(
  runtime: ExecutionEnvironment,
  options: SubprocessOptions,
  processTimeoutMs: number = DEFAULT_MODEL_TIMEOUTS.remoteProcessTimeoutMs
): AsyncGenerator<unknown> {
  if (!runtime.runProcess)
    throw new ExecutionEnvironmentError('PROCESS_UNSUPPORTED', 'CLI streaming is unavailable.');
  const controller = new AbortController();
  const signal = options.abortController
    ? AbortSignal.any([controller.signal, options.abortController.signal])
    : controller.signal;
  const decoder = new StringDecoder('utf8');
  const queue: Array<{ value: unknown; bytes: number }> = [];
  let pending = '',
    queuedBytes = 0,
    stderr = '',
    stderrBytes = 0,
    ended = false;
  let error: unknown;
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const invalid = () =>
    new ExecutionEnvironmentError(
      'PROCESS_JSONL_INVALID',
      'Remote CLI output is invalid or exceeded the stream buffer. Inspect prior effects before retrying.'
    );
  const line = (value: string) => {
    if (!value.trim()) return;
    if (value.length > 1024 * 1024) throw invalid();
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw invalid();
    }
    const bytes = Buffer.byteLength(value);
    queuedBytes += bytes;
    if (queuedBytes > 2 * 1024 * 1024 || queue.length >= 4096) throw invalid();
    queue.push({ value: parsed, bytes });
    notify();
  };
  const operation = runtime
    .runProcess(
      {
        command: options.command,
        args: options.args,
        stdin: options.stdinData,
        timeoutMs: processTimeoutMs,
        idleTimeoutMs: options.timeout ?? DEFAULT_MODEL_TIMEOUTS.cliIdleTimeoutMs,
      },
      signal,
      (stream, data) => {
        if (stream === 'stderr') {
          // Do not log remote stderr: it can contain credentials or project secrets.
          if (stderrBytes < 65_536)
            stderr += data.subarray(0, 65_536 - stderrBytes).toString('utf8');
          stderrBytes += data.length;
          return;
        }
        pending += decoder.write(data);
        let end: number;
        while ((end = pending.indexOf('\n')) >= 0) {
          line(pending.slice(0, end));
          pending = pending.slice(end + 1);
        }
        if (pending.length > 1024 * 1024) throw invalid();
      }
    )
    .then((result) => {
      pending += decoder.end();
      if (pending) line(pending);
      if (result.exitCode !== 0)
        throw Object.assign(
          new Error(
            `Remote ${options.command} exited with code ${result.exitCode}. Check installation and authentication inside ${runtime.type}; controller credentials are not forwarded.`
          ),
          { stderr, exitCode: result.exitCode }
        );
    })
    .catch((failure) => {
      error = failure;
    })
    .finally(() => {
      ended = true;
      notify();
    });
  try {
    while (queue.length || !ended) {
      if (queue.length) {
        const next = queue.shift()!;
        queuedBytes -= next.bytes;
        yield next.value;
      } else
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
    }
    if (error) throw error;
  } finally {
    controller.abort();
    await operation; // A stopped consumer must await verified remote cleanup before releasing its lease.
    if (
      error instanceof ExecutionEnvironmentError &&
      ['PROCESS_CLEANUP_FAILED', 'SSH_OUTCOME_UNKNOWN'].includes(error.code)
    )
      await Promise.reject(error);
  }
}
