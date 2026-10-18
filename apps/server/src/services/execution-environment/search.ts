import path from 'node:path';
import { TextDecoder } from 'node:util';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import {
  ExecutionEnvironmentError,
  type ExecutionEnvironment,
  type EnvironmentSearchOptions,
} from './runtime.js';

function glob(pattern: string): { test(value: string): boolean } {
  if (
    !pattern ||
    pattern.length > 256 ||
    pattern.split('/').includes('..') ||
    /[\x00-\x1f]/.test(pattern)
  )
    throw new ExecutionEnvironmentError(
      'INVALID_PATTERN',
      'Use a relative glob with *, ? and ** (max 256 characters).'
    );
  const parts = pattern.split('/');
  if (parts.some((part) => !part || part === '.' || (part.includes('**') && part !== '**')))
    throw new ExecutionEnvironmentError('INVALID_PATTERN', '** must be a complete path segment.');
  const segment = (pattern: string, value: string) => {
    const chars = Array.from(value);
    let states = new Array<boolean>(chars.length + 1).fill(false);
    states[0] = true;
    for (const char of pattern) {
      const next = new Array<boolean>(chars.length + 1).fill(false);
      if (char === '*') next[0] = states[0];
      for (let index = 1; index <= chars.length; index++)
        next[index] =
          char === '*'
            ? states[index] || next[index - 1]
            : (char === '?' || char === chars[index - 1]) && states[index - 1];
      states = next;
    }
    return states[chars.length];
  };
  // Dynamic programming: untrusted model globs never become backtracking regexes.
  return {
    test(value) {
      const names = value.split('/');
      let states = new Array<boolean>(names.length + 1).fill(false);
      states[0] = true;
      for (const part of parts) {
        const next = new Array<boolean>(names.length + 1).fill(false);
        if (part === '**') next[0] = states[0];
        for (let index = 1; index <= names.length; index++)
          next[index] =
            part === '**'
              ? states[index] || next[index - 1]
              : states[index - 1] && segment(part, names[index - 1]);
        states = next;
      }
      return states[names.length];
    },
  };
}

/** Bounded discovery, not a restriction on explicit file paths or shell operations. */
export async function searchEnvironment(
  environment: ExecutionEnvironment,
  options: EnvironmentSearchOptions,
  signal: AbortSignal
) {
  if (environment.search) return environment.search(options, signal);
  const pattern = glob(options.glob ?? '**/*');
  const queue = [{ directory: options.path ?? '.', relative: '', depth: 0 }];
  const files: string[] = [];
  const matches: Array<{ path: string; line: number; text: string }> = [];
  let visited = 0;
  let scanned = 0;
  let truncated = false;
  const maximum = options.maxResults ?? 100;
  const needle = options.caseSensitive === false ? options.text?.toLowerCase() : options.text;
  while (queue.length) {
    signal.throwIfAborted();
    const current = queue.shift()!;
    const listing = await environment.listDirectory(current.directory, 10_000 - visited, signal);
    truncated ||= listing.truncated;
    for (const entry of listing.entries) {
      if (++visited > 10_000) return { files, matches, truncated: true };
      signal.throwIfAborted();
      if (visited % 32 === 0) await yieldEventLoop(undefined, { signal });
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      const target = path.join(current.directory, entry.name);
      if (entry.type === 'directory') {
        if (
          !options.includeDependencies &&
          ['node_modules', '.git', 'dist', 'build', '.next'].includes(entry.name)
        )
          continue;
        if (current.depth < 32)
          queue.push({ directory: target, relative, depth: current.depth + 1 });
        else truncated = true;
      } else if (entry.type === 'file' && pattern.test(relative)) {
        if (needle === undefined) files.push(target);
        else {
          if (scanned >= 8 * 1024 * 1024) return { files, matches, truncated: true };
          const read = await environment.readFile(
            target,
            0,
            Math.min(256 * 1024, 8 * 1024 * 1024 - scanned),
            signal
          );
          scanned += read.data.length;
          truncated ||= read.data.length < read.size;
          let text: string;
          try {
            text = new TextDecoder('utf8', { fatal: true }).decode(read.data);
          } catch {
            continue;
          }
          if (text.includes('\0')) continue;
          for (const [index, line] of text.split('\n').entries()) {
            if ((options.caseSensitive === false ? line.toLowerCase() : line).includes(needle)) {
              matches.push({ path: target, line: index + 1, text: line.slice(0, 1000) });
              if (matches.length >= maximum) return { files, matches, truncated: true };
            }
          }
        }
        if (files.length >= maximum) return { files, matches, truncated: true };
      }
    }
    if (visited >= 10_000) return { files, matches, truncated: true };
  }
  return { files, matches, truncated };
}
