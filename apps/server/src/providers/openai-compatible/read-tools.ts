import path from 'node:path';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import { ReadOnlyWorkspace, MAX_FILE_BYTES, textHash } from './workspace.js';
import { checkAbort, ToolError } from './runtime.js';
import type { LocalTool } from './local-tool.js';

const string = { type: 'string', minLength: 1, maxLength: 4096 };
const directory = { ...string, description: 'Workspace-relative directory; defaults to .' };
const patternSchema = { type: 'string', minLength: 1, maxLength: 128 };
const limit = (max: number) => ({ type: 'integer', minimum: 1, maximum: max });

/** Small bounded glob dialect: *, ?, and whole-segment **. No regex or brace expansion. */
function globPattern(pattern: string): string[] {
  if (
    pattern.length > 128 ||
    /[\x00-\x1f\x7f\\[\]{}]/.test(pattern) ||
    path.posix.isAbsolute(pattern)
  ) {
    throw new ToolError(
      'INVALID_PATTERN',
      'Glob supports only relative paths, *, ?, and whole-segment **.'
    );
  }
  const parts = pattern.split('/');
  if (
    parts.some(
      (part) => !part || part === '..' || part === '.' || (part.includes('**') && part !== '**')
    )
  ) {
    throw new ToolError(
      'INVALID_PATTERN',
      'Glob supports only relative paths, *, ?, and whole-segment **.'
    );
  }
  return parts;
}

function segmentMatches(pattern: string, text: string): boolean {
  const characters = Array.from(text);
  let states = new Array<boolean>(characters.length + 1).fill(false);
  states[0] = true;
  for (const char of pattern) {
    const next = new Array<boolean>(characters.length + 1).fill(false);
    if (char === '*') next[0] = states[0];
    for (let i = 1; i <= characters.length; i++)
      next[i] =
        char === '*'
          ? states[i] || next[i - 1]
          : (char === '?' || char === characters[i - 1]) && states[i - 1];
    states = next;
  }
  return states[characters.length];
}

function matches(parts: string[], name: string): boolean {
  const segments = name.split('/');
  let states = new Array<boolean>(segments.length + 1).fill(false);
  states[0] = true;
  for (const part of parts) {
    const next = new Array<boolean>(segments.length + 1).fill(false);
    if (part === '**') next[0] = states[0];
    for (let i = 1; i <= segments.length; i++)
      next[i] =
        part === '**'
          ? states[i] || next[i - 1]
          : states[i - 1] && segmentMatches(part, segments[i - 1]);
    states = next;
  }
  return states[segments.length];
}

async function walk(
  workspace: ReadOnlyWorkspace,
  start: string,
  signal: AbortSignal,
  visitor: (name: string, relative: string) => Promise<boolean>
): Promise<boolean> {
  const queue = [{ name: start, relative: '', depth: 0 }];
  let visited = 0;
  let truncated = false;
  while (queue.length) {
    checkAbort(signal);
    const item = queue.shift()!;
    const listing = await workspace.list(item.name, Math.min(2000, 5000 - visited), signal);
    truncated ||= listing.truncated;
    for (const entry of listing.entries) {
      if (++visited > 5000) return true;
      if (visited % 64 === 0) await yieldEventLoop(undefined, { signal });
      const name = path.join(item.name, entry.name);
      const relative = item.relative ? `${item.relative}/${entry.name}` : entry.name;
      if (entry.type === 'directory') {
        if (['node_modules', 'dist', 'build', '.next'].includes(entry.name)) continue;
        if (item.depth >= 16) {
          truncated = true;
          continue;
        }
        queue.push({ name, relative, depth: item.depth + 1 });
      } else if (!(await visitor(name, relative))) return true;
    }
    if (visited >= 5000) return true;
    await yieldEventLoop(undefined, { signal });
  }
  return truncated;
}

export function createReadTools(workspace: ReadOnlyWorkspace): LocalTool[] {
  const tool = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    execute: LocalTool['execute']
  ): LocalTool => ({
    effect: 'read',
    execute,
    definition: {
      type: 'function',
      function: {
        name,
        description,
        parameters: { type: 'object', properties, required, additionalProperties: false },
      },
    },
  });
  return [
    tool(
      'Read',
      'Read UTF-8 text in the workspace (max 1 MiB), including a whole-file sha256 for Write/Edit. Symlinks, .env files and protected metadata are denied. Lines are 1-based.',
      {
        path: string,
        startLine: limit(1_000_000),
        maxLines: limit(500),
      },
      ['path'],
      async (args, signal) => {
        const { text } = await workspace.read(args.path as string, signal);
        const lines = text.split('\n');
        const start = ((args.startLine as number | undefined) ?? 1) - 1;
        const end = Math.min(lines.length, start + ((args.maxLines as number | undefined) ?? 200));
        return {
          path: args.path,
          sha256: textHash(text),
          startLine: start + 1,
          content: lines.slice(start, end).join('\n'),
          truncated: end < lines.length,
          ...(end < lines.length && { nextLine: end + 1 }),
        };
      }
    ),
    tool(
      'LS',
      'List workspace directory entries. Symlinks, special files and protected metadata are omitted.',
      {
        path: directory,
        maxEntries: limit(1000),
      },
      [],
      async (args, signal) =>
        workspace.list(
          (args.path as string | undefined) ?? '.',
          (args.maxEntries as number | undefined) ?? 200,
          signal
        )
    ),
    tool(
      'Glob',
      'Find workspace files by *, ?, ** glob (no braces/regex). Skips dependency/build trees; traversal is bounded.',
      {
        path: directory,
        pattern: patternSchema,
        maxResults: limit(200),
      },
      ['pattern'],
      async (args, signal) => {
        const pattern = globPattern(args.pattern as string);
        const files: string[] = [];
        const truncated = await walk(
          workspace,
          (args.path as string | undefined) ?? '.',
          signal,
          async (name, relative) => {
            if (matches(pattern, relative)) {
              if (files.length >= ((args.maxResults as number | undefined) ?? 100)) return false;
              files.push(name.split(path.sep).join('/'));
            }
            return true;
          }
        );
        return { files, truncated };
      }
    ),
    tool(
      'Grep',
      'Search for a literal substring (not regex) in workspace UTF-8 files. Optional glob supports *, ?, **. Max scan 8 MiB.',
      {
        path: directory,
        pattern: { ...string, maxLength: 512 },
        glob: patternSchema,
        caseSensitive: { type: 'boolean' },
        maxResults: limit(100),
      },
      ['pattern'],
      async (args, signal) => {
        const pattern = args.glob ? globPattern(args.glob as string) : undefined;
        const sensitive = args.caseSensitive !== false;
        const needle = sensitive
          ? (args.pattern as string)
          : (args.pattern as string).toLowerCase();
        const results: Array<{ path: string; line: number; text: string; truncated?: boolean }> =
          [];
        let bytes = 0,
          scannedFiles = 0,
          skippedFiles = 0;
        const truncated = await walk(
          workspace,
          (args.path as string | undefined) ?? '.',
          signal,
          async (name, relative) => {
            if (pattern && !matches(pattern, relative)) return true;
            const remaining = 8 * 1024 * 1024 - bytes;
            if (remaining <= 0) return false;
            let file: { text: string; bytes: number };
            try {
              file = await workspace.read(name, signal, Math.min(MAX_FILE_BYTES, remaining));
            } catch (error) {
              if (!(error instanceof ToolError)) throw error;
              if (error.code === 'FILE_TOO_LARGE' && remaining < MAX_FILE_BYTES) return false;
              skippedFiles++;
              return true;
            }
            bytes += file.bytes;
            if (bytes > 8 * 1024 * 1024) return false;
            scannedFiles++;
            for (const [index, line] of file.text.split('\n').entries()) {
              if ((sensitive ? line : line.toLowerCase()).includes(needle)) {
                if (results.length >= ((args.maxResults as number | undefined) ?? 50)) return false;
                const matchIndex = (sensitive ? line : line.toLowerCase()).indexOf(needle);
                const offset = Math.max(0, matchIndex - 200);
                results.push({
                  path: name.split(path.sep).join('/'),
                  line: index + 1,
                  text: line.slice(offset, offset + 1000),
                  ...(line.length > 1000 && { truncated: true }),
                });
              }
            }
            checkAbort(signal);
            return true;
          }
        );
        return { matches: results, truncated, scannedFiles, skippedFiles };
      }
    ),
  ];
}
