import { ReadableStream, type ReadableStreamDefaultController } from 'node:stream/web';
import { MCPOperationError, MCPByteBudget, MCP_FRAME_BYTES } from './operation.js';

/** Bounds decoded response bytes before SDK JSON/EventSource parsing; owns every reader. */
export class MCPBoundedFetch {
  private readonly abort = new AbortController();
  private readonly requests = new Set<Promise<unknown>>();
  private readonly readers = new Set<{ cancel(): Promise<void> }>();
  private closed = false;
  private cleanupFailure: unknown;
  constructor(
    private readonly owner: AbortController,
    private readonly budget: MCPByteBudget,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}
  readonly fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (this.closed || this.owner.signal.aborted)
      return Promise.reject(new MCPOperationError('MCP operation cancelled'));
    const pending = this.open(input, init);
    this.requests.add(pending);
    void pending.then(
      () => this.requests.delete(pending),
      () => this.requests.delete(pending)
    );
    return pending;
  };
  private async open(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    if (this.closed || this.owner.signal.aborted)
      throw new MCPOperationError('MCP operation cancelled');
    const signal = AbortSignal.any([
      this.abort.signal,
      this.owner.signal,
      ...(init?.signal ? [init.signal] : []),
    ]);
    const response = await this.fetchImpl(input, { ...init, signal, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const error = new MCPOperationError(
        'MCP redirects are not allowed. Configure the final endpoint explicitly.'
      );
      this.owner.abort(error);
      throw error;
    }
    if (this.closed || signal.aborted) {
      await response.body?.cancel();
      throw new MCPOperationError('MCP operation cancelled');
    }
    if (!response.body) return response;
    const reader = response.body.getReader();
    let received = 0,
      finished = false,
      cancelPromise: Promise<void> | undefined;
    let output: ReadableStreamDefaultController<Uint8Array> | undefined;
    let reading: ReturnType<typeof reader.read> | undefined;
    const detach = () => {
      signal.removeEventListener('abort', onAbort);
      this.readers.delete(state);
    };
    const cancel = () =>
      (cancelPromise ??= (async () => {
        try {
          try {
            await reader.cancel();
          } catch (error) {
            if (
              !(
                signal.aborted &&
                (error === signal.reason || (error instanceof Error && error.name === 'AbortError'))
              )
            )
              throw error;
          }
          await reading?.catch(() => undefined);
        } finally {
          finished = true;
          detach();
        }
      })().catch((error) => {
        this.cleanupFailure = error;
        throw error;
      }));
    const state = { cancel };
    this.readers.add(state);
    const onAbort = () => {
      if (!finished) {
        output?.error(new MCPOperationError('MCP operation cancelled'));
        void cancel().catch(() => {});
      }
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        output = controller;
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      },
      pull: async (controller) => {
        if (finished) return;
        try {
          reading = reader.read();
          const item = await reading;
          reading = undefined;
          if (signal.aborted || finished) return;
          if (item.done) {
            finished = true;
            detach();
            controller.close();
            return;
          }
          received += item.value.byteLength;
          this.budget.consume(item.value.byteLength);
          if (received > MCP_FRAME_BYTES)
            throw new MCPOperationError('MCP response exceeds the allowed size');
          controller.enqueue(item.value);
        } catch (error) {
          if (!finished) {
            controller.error(error);
            this.owner.abort(error);
            await cancel();
          }
        }
      },
      cancel: () => cancel(),
    });
    const wrapped = new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperty(wrapped, 'url', { value: response.url });
    return wrapped;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.abort.abort();
    const requestCount = this.requests.size;
    const results = await Promise.allSettled([
      ...this.requests,
      ...[...this.readers].map((reader) => reader.cancel()),
    ]);
    // Fetch abort is affirmative cancellation; reader cancellation rejection is not proof.
    const readerFailures = results
      .slice(requestCount)
      .filter((result) => result.status === 'rejected');
    if (readerFailures.length || this.cleanupFailure)
      throw new MCPOperationError('MCP response cleanup is unconfirmed');
  }
}
