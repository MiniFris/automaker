import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';

export interface CommandResult {
  exitCode: number | null;
  stderr: string;
}

export interface TemplateCommandRunner {
  run(command: string, args: readonly string[], cwd: string): Promise<CommandResult>;
}

export const TEMPLATE_COMMAND_RUNNER = Symbol('TEMPLATE_COMMAND_RUNNER');

@Injectable()
export class SpawnTemplateCommandRunner implements TemplateCommandRunner {
  run(command: string, args: readonly string[], cwd: string): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], { cwd, shell: false });
      let stderr = '';
      child.stderr.on('data', (data: Buffer) => {
        if (stderr.length < 64 * 1024)
          stderr += data.toString().slice(0, 64 * 1024 - stderr.length);
      });
      child.once('error', reject);
      child.once('close', (exitCode) => resolve({ exitCode, stderr }));
    });
  }
}
