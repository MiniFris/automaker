import { randomUUID } from 'node:crypto';
import { GEMINI_CLI_SUPPORTED_VERSION, GEMINI_CLI_INSTALL_COMMAND } from '@automaker/contracts';
import path from 'node:path';
import type { ExecuteOptions } from './types.js';
import { LocalExecutionEnvironment } from '../services/execution-environment/local.js';
import {
  ExecutionEnvironmentError,
  type ExecutionEnvironment,
} from '../services/execution-environment/runtime.js';
import { ProviderCleanupError } from './provider-execution-scope.js';

export const GEMINI_POLICY_VERSION = GEMINI_CLI_SUPPORTED_VERSION;
export const GEMINI_INSTALL_COMMAND = GEMINI_CLI_INSTALL_COMMAND;
const NATIVE_TOOLS: Readonly<Record<string, readonly string[]>> = {
  read: ['read_file', 'read_many_files'],
  ls: ['list_directory'],
  glob: ['glob'],
  grep: ['grep_search'],
  websearch: ['google_web_search'],
  webfetch: ['web_fetch'],
  write: ['write_file'],
  edit: ['replace'],
  multiedit: ['replace'],
  bash: ['run_shell_command'],
  shell: ['run_shell_command'],
  todowrite: ['write_todos'],
  // Delegation and skill activation do not inherit the caller's tool grants.
  // A restricted Gemini invocation therefore exposes neither channel.
  task: [],
  skill: [],
  delete: [],
  remove: [],
};

function unsupported(): never {
  throw new ExecutionEnvironmentError(
    'GEMINI_TOOL_POLICY_UNSUPPORTED',
    'Gemini CLI cannot enforce the requested tool policy in this runtime. No model query was started.'
  );
}

/** Returns native upper-bound grants, preserving explicit [] and intersections. */
export function geminiPolicyTools(options: ExecuteOptions): string[] | undefined {
  if (options.readOnly) unsupported();
  const convert = (tools: string[]) => [
    ...new Set(
      tools.flatMap((tool) => {
        const mapped = NATIVE_TOOLS[tool.replace(/[^a-z]/gi, '').toLowerCase()];
        if (!mapped) unsupported();
        return mapped;
      })
    ),
  ];
  const allowed = options.allowedTools === undefined ? undefined : convert(options.allowedTools);
  const available = options.tools === undefined ? undefined : convert(options.tools);
  return allowed === undefined
    ? available
    : available === undefined
      ? allowed
      : available.filter((name) => allowed.includes(name));
}

export function geminiPolicyDocument(tools: readonly string[]): string {
  // Admin tier 5.x outranks user/settings/YOLO rules. Native allows cannot
  // accidentally grant an MCP tool with the same unqualified name.
  return [
    '[[rule]]',
    'toolName = "*"',
    'decision = "deny"',
    'priority = 997',
    '',
    ...(tools.length
      ? [
          '[[rule]]',
          `toolName = ${JSON.stringify(tools)}`,
          'decision = "allow"',
          'priority = 998',
          '',
        ]
      : []),
    '[[rule]]',
    'toolName = "*"',
    'mcpName = "*"',
    'decision = "deny"',
    'priority = 999',
    '',
  ].join('\n');
}

export interface GeminiPolicyLease {
  readonly file: string;
  close(): Promise<void>;
}

/** Only filesystem/process ports are used; the vendor HOME/settings are never changed. */
export async function prepareGeminiPolicy(
  options: ExecuteOptions,
  remote: ExecutionEnvironment | undefined,
  probe: (args: string[]) => Promise<string>
): Promise<GeminiPolicyLease | undefined> {
  const tools = geminiPolicyTools(options);
  if (tools === undefined) return undefined;
  const filesystem = remote ?? (await LocalExecutionEnvironment.create(options.cwd));
  const signal = options.abortController?.signal ?? new AbortController().signal;
  const platform = filesystem.platform;
  if (platform !== 'linux' && platform !== 'darwin') unsupported();
  const systemPolicies =
    platform === 'darwin'
      ? '/Library/Application Support/GeminiCli/policies'
      : '/etc/gemini-cli/policies';
  try {
    const listing = await filesystem.listDirectory(systemPolicies, 10_000, signal);
    if (listing.truncated || listing.entries.some((entry) => entry.name.endsWith('.toml')))
      unsupported();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unsupported();
  }
  if ((await probe(['--version'])).trim() !== GEMINI_POLICY_VERSION) unsupported();
  const help = await probe(['--help']);
  if (!['--admin-policy', '--extensions', '--approval-mode'].every((flag) => help.includes(flag)))
    unsupported();

  // Gemini's --admin-policy parser splits comma-separated paths even when argv
  // contains one literal value. Use a target-local, comma-free owned path rather
  // than embedding arbitrary project names in the policy argument.
  const directory = path.posix.join('/tmp', `automaker-gemini-policy-${randomUUID()}`);
  const file = path.posix.join(directory, 'tools.toml');
  let closed = false;
  const close = async () => {
    if (closed) return;
    // Query cancellation must not cancel cleanup. A failed cleanup is a failed
    // provider lease, rather than a successful result with an orphan policy.
    try {
      await filesystem.remove(directory, true, AbortSignal.timeout(5000));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        closed = true;
        return;
      }
      throw new ProviderCleanupError();
    }
    closed = true;
  };
  try {
    await filesystem.mkdir(directory, signal);
    await filesystem.writeFile(file, Buffer.from(geminiPolicyDocument(tools)), signal, null);
  } catch (error) {
    await close();
    throw error;
  }
  return { file, close };
}
