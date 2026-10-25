export const HOST_PROFILE_CONFIG = Symbol('HOST_PROFILE_CONFIG');

/** Host identity captured during composition; never resolved from ambient env by consumers. */
export interface HostProfileConfig {
  readonly platform: NodeJS.Platform;
  readonly homeDirectory?: string;
}
