export const MCP_FRAME_BYTES = 2 * 1024 * 1024;
export const MCP_OPERATION_BYTES = 4 * 1024 * 1024;
export const MCP_STDERR_BYTES = 64 * 1024;
export class MCPOperationError extends Error {}
export class MCPCleanupError extends Error {
  constructor() {
    super('MCP cleanup is unconfirmed. Inspect owned resources before retrying.');
  }
}
export async function bounded<T>(
  operation: Promise<T>,
  milliseconds: number,
  error: Error
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(error), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export class MCPByteBudget {
  private bytes = 0;
  consume(size: number): void {
    this.bytes += size;
    if (this.bytes > MCP_OPERATION_BYTES)
      throw new MCPOperationError('MCP response exceeds the allowed size');
  }
}
