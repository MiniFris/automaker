export const RUNTIME_CONFIG = Symbol('RUNTIME_CONFIG');
export const WORKING_DIRECTORY = Symbol('WORKING_DIRECTORY');
/** Bootstrap snapshot for host subprocesses; never expose it in HTTP responses/logs. */
export const HOST_ENVIRONMENT = Symbol('HOST_ENVIRONMENT');
