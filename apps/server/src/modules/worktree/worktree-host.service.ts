import { Inject, Injectable } from '@nestjs/common';
import {
  clearEditorCache,
  clearTerminalCache,
  detectAllEditors,
  detectAllTerminals,
  detectDefaultEditor,
  detectDefaultTerminal,
  openInEditor,
  openInExternalTerminal,
  openInFileManager,
  openInTerminal,
} from '@automaker/platform';
import { ProjectGitService } from '../../services/execution-environment/project-git.js';
import { ExecutionEnvironmentError } from '../../services/execution-environment/runtime.js';
import type { WorktreeOpenEditorRequest, WorktreeOpenTerminalRequest } from './worktree.schemas.js';

@Injectable()
export class WorktreeHostService {
  constructor(@Inject(ProjectGitService) private readonly git: ProjectGitService) {}

  async availableEditors() {
    return { success: true as const, result: { editors: await detectAllEditors() } };
  }

  async defaultEditor() {
    const editor = await detectDefaultEditor();
    return {
      success: true as const,
      result: { editorName: editor.name, editorCommand: editor.command },
    };
  }

  async refreshEditors() {
    clearEditorCache();
    const editors = await detectAllEditors();
    return {
      success: true as const,
      result: { editors, message: `Found ${editors.length} available editors` },
    };
  }

  async openEditor(input: WorktreeOpenEditorRequest) {
    await this.requireControllerLocal(input.worktreePath);
    try {
      const opened = await openInEditor(input.worktreePath, input.editorCommand);
      return {
        success: true as const,
        result: {
          message: `Opened ${input.worktreePath} in ${opened.editorName}`,
          editorName: opened.editorName,
        },
      };
    } catch {
      const opened = await openInFileManager(input.worktreePath);
      return {
        success: true as const,
        result: {
          message: `Opened ${input.worktreePath} in ${opened.editorName}`,
          editorName: opened.editorName,
        },
      };
    }
  }

  async availableTerminals() {
    return { success: true as const, result: { terminals: await detectAllTerminals() } };
  }

  async defaultTerminal() {
    const terminal = await detectDefaultTerminal();
    return {
      success: true as const,
      result: terminal
        ? {
            terminalId: terminal.id,
            terminalName: terminal.name,
            terminalCommand: terminal.command,
          }
        : null,
    };
  }

  async refreshTerminals() {
    clearTerminalCache();
    const terminals = await detectAllTerminals();
    return {
      success: true as const,
      result: {
        terminals,
        message: `Found ${terminals.length} available external terminals`,
      },
    };
  }

  async openTerminal(input: WorktreeOpenTerminalRequest, external: boolean) {
    await this.requireControllerLocal(input.worktreePath);
    const opened = external
      ? await openInExternalTerminal(input.worktreePath, input.terminalId)
      : await openInTerminal(input.worktreePath);
    return {
      success: true as const,
      result: {
        message: external
          ? `Opened ${input.worktreePath} in ${opened.terminalName}`
          : `Opened terminal in ${input.worktreePath}`,
        terminalName: opened.terminalName,
      },
    };
  }

  private async requireControllerLocal(worktreePath: string) {
    if (await this.git.resolve(worktreePath))
      throw new ExecutionEnvironmentError(
        'HOST_INTEGRATION_UNSUPPORTED',
        'Desktop editors and external terminals can only open controller-local worktrees. Use the managed terminal for Docker or SSH targets.'
      );
    await this.git.resolveOrLocal(worktreePath);
  }
}
