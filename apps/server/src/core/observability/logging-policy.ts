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

export class ApplicationLoggingPolicy {
  readonly configuration: LoggerConfiguration;
  requestLogging: boolean;
  constructor(environment: Readonly<NodeJS.ProcessEnv> = {}, requestLogging = true) {
    this.configuration = {
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
