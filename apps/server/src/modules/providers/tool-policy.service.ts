import { Injectable } from '@nestjs/common';

export type ToolEffect = 'read' | 'write' | 'shell' | 'delete' | 'coordination';

const TOOL_EFFECTS: Readonly<Record<string, ToolEffect>> = Object.freeze({
  read: 'read',
  ls: 'read',
  glob: 'read',
  grep: 'read',
  websearch: 'read',
  webfetch: 'read',
  write: 'write',
  edit: 'write',
  multiedit: 'write',
  bash: 'shell',
  shell: 'shell',
  delete: 'delete',
  remove: 'delete',
  todowrite: 'coordination',
  skill: 'coordination',
  task: 'coordination',
});

const CANONICAL_NAMES: Readonly<Record<string, string>> = Object.freeze({
  read: 'Read',
  ls: 'LS',
  glob: 'Glob',
  grep: 'Grep',
  websearch: 'WebSearch',
  webfetch: 'WebFetch',
  write: 'Write',
  edit: 'Edit',
  multiedit: 'MultiEdit',
  bash: 'Bash',
  shell: 'Bash',
  delete: 'Delete',
  remove: 'Delete',
  todowrite: 'TodoWrite',
  skill: 'Skill',
  task: 'Task',
});

export interface ToolPolicyInput {
  requested?: readonly string[];
  readOnly: boolean;
  providerSupportsTools: boolean;
  environment?: { shell: boolean; remove: boolean };
}

@Injectable()
export class ToolPolicyService {
  resolve(input: ToolPolicyInput): string[] | undefined {
    if (!input.providerSupportsTools) return [];
    if (input.requested === undefined) return undefined;
    const resolved: string[] = [];
    for (const rawName of input.requested) {
      const key = rawName.replace(/[^a-z]/gi, '').toLowerCase();
      const effect = TOOL_EFFECTS[key];
      const name = CANONICAL_NAMES[key];
      if (!effect || !name) throw new Error(`Unknown tool requested: ${rawName}`);
      if (input.readOnly && ['write', 'shell', 'delete'].includes(effect)) continue;
      if (effect === 'shell' && input.environment?.shell === false) continue;
      if (effect === 'delete' && input.environment?.remove === false) continue;
      if (!resolved.includes(name)) resolved.push(name);
    }
    return resolved;
  }

  isDestructiveCommand(command: string): boolean {
    const normalized = command
      .replace(/^\s*(?:sudo\s+|env(?:\s+\w+=\S+)*\s+|(?:bash|sh|zsh|pwsh)\s+-[a-z]*c\s+)+/i, '')
      .trim()
      .toLowerCase();
    return (
      /(?:^|[;&|]\s*)(?:rm\s+(?:-[a-z]*r[a-z]*f?|-[a-z]*f[a-z]*r)|rmdir\b|del\s+\/s\b|remove-item\b)/i.test(
        normalized
      ) ||
      /(?:^|\s)(?:>|>>|2>|&>)\s*\/(?:etc|usr|var|home|root)\b/i.test(normalized) ||
      /\b(?:mkfs|diskpart|format\s+[a-z]:|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f[a-z]*)\b/i.test(
        normalized
      )
    );
  }
}
