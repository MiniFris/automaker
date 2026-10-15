import type { LocalTool } from './local-tool.js';
import { ReadOnlyWorkspace, textHash } from './workspace.js';
import { checkAbort, ToolError } from './runtime.js';

const filePath = { type: 'string', minLength: 1, maxLength: 4096 };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const content = { type: 'string', maxLength: 1024 * 1024 };

export function createWriteTools(workspace: ReadOnlyWorkspace): LocalTool[] {
  return [
    {
      effect: 'write',
      definition: {
        type: 'function',
        function: {
          name: 'Write',
          description:
            'Atomically create or replace one UTF-8 file. Parent directory must exist. expectedSha256 is null ONLY for a new file, otherwise use the hash from Read.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'content', 'expectedSha256'],
            properties: {
              path: filePath,
              content,
              expectedSha256: { anyOf: [hash, { type: 'null' }] },
            },
          },
        },
      },
      async execute(args, signal) {
        return workspace.write(
          args.path as string,
          args.content as string,
          args.expectedSha256 as string | null,
          signal
        );
      },
    },
    {
      effect: 'write',
      definition: {
        type: 'function',
        function: {
          name: 'Edit',
          description:
            'Replace exactly one literal occurrence in a UTF-8 file. Read first and supply its sha256. Ambiguous or absent matches are rejected without writing.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'oldText', 'newText', 'expectedSha256'],
            properties: {
              path: filePath,
              oldText: { ...content, minLength: 1 },
              newText: content,
              expectedSha256: hash,
            },
          },
        },
      },
      async execute(args, signal) {
        const original = await workspace.read(args.path as string, signal);
        if (textHash(original.text) !== args.expectedSha256)
          throw new ToolError('FILE_CONFLICT', 'File changed; Read it again before editing.');
        const oldText = args.oldText as string;
        const index = original.text.indexOf(oldText);
        if (index < 0 || original.text.indexOf(oldText, index + 1) >= 0)
          throw new ToolError(
            'EDIT_CONFLICT',
            'oldText must occur exactly once; no changes were made.'
          );
        const updated =
          original.text.slice(0, index) +
          args.newText +
          original.text.slice(index + oldText.length);
        checkAbort(signal);
        return workspace.write(args.path as string, updated, args.expectedSha256 as string, signal);
      },
    },
  ];
}

/** State is local to one registry/run, never a shared provider singleton. */
export function createTodoTool(): LocalTool {
  return {
    effect: 'state',
    definition: {
      type: 'function',
      function: {
        name: 'TodoWrite',
        description: 'Replace the session todo list. Keep at most one task in progress.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['todos'],
          properties: {
            todos: {
              type: 'array',
              maxItems: 100,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['content', 'status'],
                properties: {
                  content: { type: 'string', minLength: 1, maxLength: 1000 },
                  status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
                },
              },
            },
          },
        },
      },
    },
    async execute(args, signal) {
      checkAbort(signal);
      const todos = args.todos as Array<{ content: string; status: string }>;
      if (todos.filter((todo) => todo.status === 'in_progress').length > 1)
        throw new ToolError('INVALID_ARGUMENTS', 'At most one todo may be in progress.');
      // The result itself is checkpointed in protocol history; there is no separate volatile state.
      return { todos: todos.map((todo) => ({ ...todo })) };
    },
  };
}
