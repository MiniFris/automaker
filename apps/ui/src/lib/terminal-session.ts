import { apiFetch } from './api-fetch';

/** Inspect and then create against that exact target; never retry with missing/Local options. */
export async function createEnvironmentTerminal(
  cwd: string | undefined,
  headers: Record<string, string>
): Promise<Response> {
  let environmentTargetId: string | undefined;
  if (cwd) {
    const response = await apiFetch('/api/git/environment', 'POST', { body: { projectPath: cwd } });
    const inspected = await response.json();
    if (
      !response.ok ||
      !inspected.success ||
      typeof inspected.executionEnvironment?.targetId !== 'string'
    )
      throw new Error(inspected.error || 'Cannot inspect the selected terminal environment');
    environmentTargetId = inspected.executionEnvironment.targetId;
  }
  return apiFetch('/api/terminal/sessions', 'POST', {
    headers,
    body: { cwd, cols: 80, rows: 24, environmentTargetId },
  });
}
