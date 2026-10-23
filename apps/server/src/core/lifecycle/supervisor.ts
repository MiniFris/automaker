export interface SupervisorHealth {
  healthy: boolean;
  detail?: string;
}

export interface ApplicationSupervisor {
  readonly name: string;
  start(): void | Promise<void>;
  stop(reason: string): void | Promise<void>;
  health(): SupervisorHealth | Promise<SupervisorHealth>;
}
