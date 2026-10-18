import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import type { LocalTool } from './local-tool.js';
import { ToolError } from './runtime.js';
import {
  ExecutionEnvironmentError,
  type ExecutionEnvironment,
} from '../../services/execution-environment/runtime.js';
import { searchEnvironment } from '../../services/execution-environment/search.js';

const filePath = { type: 'string', minLength: 1, maxLength: 4096 };
const integer = (maximum: number, minimum = 1) => ({ type: 'integer', minimum, maximum });
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
export function createEnvironmentTools(
  environment: ExecutionEnvironment,
  readOnly: boolean,
  toolTimeoutMs?: number
): LocalTool[] {
  const location =
    environment.type === 'local'
      ? 'the Automaker server OS user'
      : `the ${environment.type} environment user`;
  const tool = (
    name: string,
    description: string,
    effect: LocalTool['effect'],
    properties: Record<string, unknown>,
    required: string[],
    execute: LocalTool['execute']
  ): LocalTool => ({
    effect,
    definition: {
      type: 'function',
      function: {
        name,
        description,
        parameters: { type: 'object', properties, required, additionalProperties: false },
      },
    },
    async execute(args, signal) {
      try {
        return await execute(args, signal);
      } catch (error) {
        if (error instanceof ExecutionEnvironmentError)
          throw new ToolError(error.code, error.message);
        if (error instanceof ToolError) throw error;
        signal.throwIfAborted();
        throw new ToolError(
          'ENVIRONMENT_IO_ERROR',
          `Environment operation failed (${(error as NodeJS.ErrnoException).code ?? 'unknown'}).`
        );
      }
    },
  });
  const read = [
    tool(
      'Read',
      `Read a file with the rights of ${location}. Relative paths start at the working directory; absolute paths refer to that environment. Binary files use base64. Reads are paginated, not snapshots.`,
      'read',
      {
        path: filePath,
        encoding: { type: 'string', enum: ['utf8', 'base64'] },
        offset: integer(Number.MAX_SAFE_INTEGER, 0),
        maxBytes: integer(262144),
        startLine: integer(1000000),
        maxLines: integer(500),
      },
      ['path'],
      async (args, signal) => {
        const offset = (args.offset as number | undefined) ?? 0;
        const result = await environment.readFile(
          args.path as string,
          offset,
          Math.min((args.maxBytes as number | undefined) ?? 4096, 6000),
          signal
        );
        let content: string;
        let consumed = result.data.length;
        let nextLine: number | undefined;
        if (args.encoding === 'base64') content = result.data.toString('base64');
        else {
          try {
            content = new TextDecoder('utf8', { fatal: true }).decode(result.data, {
              stream: offset + result.data.length < result.size,
            });
          } catch {
            throw new ToolError(
              'BINARY_FILE',
              'File is not UTF-8. Use encoding: base64 or a shell command.'
            );
          }
          if (content.includes('\0'))
            throw new ToolError('BINARY_FILE', 'File appears binary. Use encoding: base64.');
          while (JSON.stringify(content).length > 12000) {
            const last = content.charCodeAt(content.length - 1);
            content = content.slice(0, last >= 0xdc00 && last <= 0xdfff ? -2 : -1);
          }
          // Stream decoding can buffer an incomplete UTF-8 character. Do not skip its bytes.
          consumed = Buffer.byteLength(content);
          if (!consumed && result.data.length)
            throw new ToolError(
              'INVALID_RANGE',
              'Increase maxBytes to fit a complete UTF-8 character, or use base64.'
            );
          if (args.startLine || args.maxLines) {
            const start = ((args.startLine as number | undefined) ?? 1) - 1;
            const end = start + ((args.maxLines as number | undefined) ?? 200);
            const lines = content.split('\n');
            content = lines.slice(start, end).join('\n');
            if (end < lines.length) nextLine = end + 1;
          }
        }
        return {
          path: args.path,
          content,
          encoding: args.encoding ?? 'utf8',
          offset,
          size: result.size,
          ...(offset === 0 &&
            result.data.length === result.size && { sha256: digest(result.data) }),
          truncated: nextLine !== undefined || offset + consumed < result.size,
          nextOffset: nextLine ? offset : offset + consumed,
          ...(nextLine && { nextLine }),
        };
      }
    ),
    tool(
      'LS',
      `List directory entries in the ${environment.type} environment, including symlinks and dependencies.`,
      'read',
      { path: filePath, maxEntries: integer(1000) },
      [],
      async (args, signal) =>
        environment.listDirectory(
          (args.path as string | undefined) ?? '.',
          (args.maxEntries as number | undefined) ?? 200,
          signal
        )
    ),
    tool(
      'Glob',
      'Find files by *, ? and **. Search is bounded; includeDependencies includes dependency/build/Git trees. Explicit paths remain accessible.',
      'read',
      {
        path: filePath,
        pattern: { type: 'string', minLength: 1, maxLength: 256 },
        maxResults: integer(500),
        includeDependencies: { type: 'boolean' },
      },
      ['pattern'],
      async (args, signal) =>
        searchEnvironment(
          environment,
          {
            path: args.path as string | undefined,
            glob: args.pattern as string,
            maxResults: args.maxResults as number | undefined,
            includeDependencies: args.includeDependencies as boolean | undefined,
          },
          signal
        )
    ),
    tool(
      'Grep',
      'Search environment UTF-8 files for a literal substring; optional glob and dependency traversal. File and scan limits bound each response, not the whole project.',
      'read',
      {
        path: filePath,
        pattern: { type: 'string', minLength: 1, maxLength: 512 },
        glob: { type: 'string', minLength: 1, maxLength: 256 },
        caseSensitive: { type: 'boolean' },
        maxResults: integer(100),
        includeDependencies: { type: 'boolean' },
      },
      ['pattern'],
      async (args, signal) =>
        searchEnvironment(
          environment,
          {
            path: args.path as string | undefined,
            glob: args.glob as string | undefined,
            text: args.pattern as string,
            caseSensitive: args.caseSensitive as boolean | undefined,
            maxResults: args.maxResults as number | undefined,
            includeDependencies: args.includeDependencies as boolean | undefined,
          },
          signal
        )
    ),
  ];
  if (readOnly) return read;
  return [
    ...read,
    tool(
      'Write',
      'Create/replace a file in the execution environment. Creates parent directories. Supports UTF-8 or canonical base64. Optional expectedSha256 guards a known version; null requires a new file. Not a cross-process transaction.',
      'write',
      {
        path: filePath,
        content: { type: 'string', maxLength: 524288 },
        encoding: { type: 'string', enum: ['utf8', 'base64'] },
        expectedSha256: { anyOf: [hash, { type: 'null' }] },
      },
      ['path', 'content'],
      async (args, signal) => {
        const content = args.content as string;
        const data = Buffer.from(content, args.encoding === 'base64' ? 'base64' : 'utf8');
        if (args.encoding === 'base64' && data.toString('base64') !== content)
          throw new ToolError('INVALID_BASE64', 'Use canonical base64.');
        await environment.writeFile(
          args.path as string,
          data,
          signal,
          args.expectedSha256 as string | null | undefined
        );
        return { path: args.path, bytes: data.length, sha256: digest(data) };
      }
    ),
    tool(
      'Edit',
      'Replace exactly one literal UTF-8 occurrence in an environment file (up to 2 MiB per edit). Optional sha256 detects stale reads. For larger files use shell editing commands.',
      'write',
      {
        path: filePath,
        oldText: { type: 'string', minLength: 1, maxLength: 524288 },
        newText: { type: 'string', maxLength: 524288 },
        expectedSha256: hash,
      },
      ['path', 'oldText', 'newText'],
      async (args, signal) => {
        const original = await environment.readFile(
          args.path as string,
          0,
          2 * 1024 * 1024,
          signal
        );
        if (original.data.length !== original.size)
          throw new ToolError('FILE_TOO_LARGE', 'Use a shell command for files larger than 2 MiB.');
        let text: string;
        try {
          text = new TextDecoder('utf8', { fatal: true }).decode(original.data);
        } catch {
          throw new ToolError('BINARY_FILE', 'Edit requires UTF-8 text.');
        }
        const index = text.indexOf(args.oldText as string);
        if (index < 0 || text.indexOf(args.oldText as string, index + 1) >= 0)
          throw new ToolError('EDIT_CONFLICT', 'oldText must occur exactly once.');
        const expected = args.expectedSha256 as string | undefined;
        if (expected && expected !== digest(original.data))
          throw new ToolError('FILE_CONFLICT', 'File changed; read it again.');
        const updated = Buffer.from(
          text.slice(0, index) + args.newText + text.slice(index + (args.oldText as string).length)
        );
        await environment.writeFile(args.path as string, updated, signal, digest(original.data));
        return { path: args.path, bytes: updated.length, sha256: digest(updated) };
      }
    ),
    tool(
      'Mkdir',
      'Create directories in the execution environment including missing parents.',
      'write',
      { path: filePath },
      ['path'],
      async (args, signal) => {
        await environment.mkdir(args.path as string, signal);
        return { path: args.path };
      }
    ),
    tool(
      'Delete',
      'Delete an explicit file or directory in the execution environment. Changes are NOT recoverable by this tool. Directory trees require recursive: true.',
      'write',
      { path: filePath, recursive: { type: 'boolean' } },
      ['path'],
      async (args, signal) => {
        await environment.remove(args.path as string, args.recursive === true, signal);
        return { deleted: args.path };
      }
    ),
    tool(
      environment.platform === 'win32' ? 'PowerShell' : 'Bash',
      `Execute a command in the ${environment.type} environment (${environment.platform === 'win32' ? 'PowerShell' : '/bin/sh'}) as ${location}. ${environment.capabilities.sandboxed ? 'Host paths outside the project mount are not exposed.' : 'This is not a sandbox.'} Network and environment-user permissions apply. Dependencies, binaries and deletion work normally. Timeout/cancel stops the process group where supported; earlier filesystem changes are NOT rolled back.`,
      'shell',
      { command: { type: 'string', minLength: 1, maxLength: 16000 }, cwd: filePath },
      ['command'],
      async (args, signal) =>
        environment.exec(args.command as string, signal, {
          cwd: args.cwd as string | undefined,
          timeoutMs: toolTimeoutMs,
        })
    ),
  ];
}
