import { AsyncLocalStorage } from 'node:async_hooks';
import {
  LogLevel,
  registerLoggerContextProvider,
  type LoggerConfiguration,
} from '@automaker/utils/logger';

const storage = new AsyncLocalStorage<ApplicationLoggingPolicy>();
const levels: Record<string, LogLevel> = {
  error: LogLevel.ERROR,
  warn: LogLevel.WARN,
  info: LogLevel.INFO,
  debug: LogLevel.DEBUG,
};
let installed = false;
// One stateless process bridge, never a process-global current application/policy.
function installBridge(): void {
  if (installed) return;
  registerLoggerContextProvider(() => storage.getStore()?.configuration);
  installed = true;
}

const PRIVATE_LOG_FIELD =
  /authorization|cookie|token|api[-_]?key|password|credential|prompt|^(?:message|stack|stdout|stderr|cause|error)$/i;
function diagnosticArguments(level: LogLevel, args: readonly unknown[]): readonly unknown[] {
  const seen = new WeakSet<object>();
  function clean(value: unknown, depth: number): unknown {
    if (value instanceof Error)
      return {
        errorType:
          value instanceof SyntaxError
            ? 'SyntaxError'
            : value instanceof TypeError
              ? 'TypeError'
              : value instanceof RangeError
                ? 'RangeError'
                : 'Error',
      };
    if (typeof value === 'string') return value.length > 4096 ? '[Truncated text]' : value;
    if (!value || typeof value !== 'object') return value;
    if (depth > 6) return '[Truncated object]';
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[Binary data]';
    if (Array.isArray(value)) return value.slice(0, 64).map((item) => clean(item, depth + 1));
    return Object.fromEntries(
      Object.entries(Object.getOwnPropertyDescriptors(value))
        .slice(0, 64)
        .map(([key, descriptor]) => [
          key,
          PRIVATE_LOG_FIELD.test(key)
            ? '[REDACTED]'
            : 'value' in descriptor
              ? clean(descriptor.value, depth + 1)
              : '[Accessor]',
        ])
    );
  }
  return args.map((value, index) =>
    index > 0 && level <= LogLevel.WARN && typeof value === 'string'
      ? '[REDACTED TEXT]'
      : clean(value, 0)
  );
}

export class ApplicationLoggingPolicy {
  readonly configuration: LoggerConfiguration;
  requestLogging: boolean;
  constructor(environment: Readonly<NodeJS.ProcessEnv> = {}, requestLogging = true) {
    this.configuration = {
      transformArguments: diagnosticArguments,
      level: levels[environment.LOG_LEVEL?.toLowerCase() ?? ''] ?? LogLevel.INFO,
      colorsEnabled: environment.LOG_COLORS !== 'false',
      timestampsEnabled: environment.LOG_TIMESTAMPS === 'true',
    };
    this.requestLogging = requestLogging;
  }
  apply(settings: { serverLogLevel?: string; enableRequestLogging?: boolean }): void {
    const level = levels[settings.serverLogLevel ?? ''];
    if (level !== undefined) this.configuration.level = level;
    if (typeof settings.enableRequestLogging === 'boolean')
      this.requestLogging = settings.enableRequestLogging;
  }
  run<T>(operation: () => T): T {
    installBridge();
    return storage.run(this, operation);
  }
  bind<Args extends unknown[], Result>(
    operation: (...args: Args) => Result
  ): (...args: Args) => Result {
    return (...args) => this.run(() => operation(...args));
  }
}
