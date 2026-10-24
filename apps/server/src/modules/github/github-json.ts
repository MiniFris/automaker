import { z } from 'zod';
import { GithubCommandError } from './github-command.runtime.js';
import { GithubResponseError } from './github-cli-read.adapter.js';

export function githubJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new GithubResponseError();
  }
}
export function githubDecode<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new GithubResponseError();
  return result.data;
}
export function githubGraphqlData(value: unknown): Record<string, unknown> {
  const response = githubDecode(
    z.object({
      data: z.record(z.string(), z.unknown()).nullish(),
      errors: z.array(z.object({ type: z.string().optional() }).passthrough()).optional(),
    }),
    value
  );
  if (response.errors?.some((error) => error.type === 'RATE_LIMITED'))
    throw new GithubCommandError('exit', true);
  if (response.errors?.length || !response.data) throw new GithubResponseError();
  return response.data;
}
