import { Injectable } from '@nestjs/common';
import { query } from '@anthropic-ai/claude-agent-sdk';

export type ClaudeVerificationOutcome =
  | 'verified'
  | 'authentication'
  | 'billing'
  | 'rate-limit'
  | 'no-response'
  | 'timeout'
  | 'failed';
export interface ClaudeVerificationRun {
  cwd: string;
  model: 'claude-sonnet-4-6';
  environment: NodeJS.ProcessEnv;
  controller: AbortController;
}
export abstract class ClaudeVerificationRuntime {
  abstract run(input: ClaudeVerificationRun): Promise<ClaudeVerificationOutcome>;
}

/** A minimal host SDK probe. Never writes process.env, installs tools, or logs SDK output. */
@Injectable()
export class NodeClaudeVerificationRuntime extends ClaudeVerificationRuntime {
  async run(input: ClaudeVerificationRun): Promise<ClaudeVerificationOutcome> {
    if (input.controller.signal.aborted) return 'timeout';
    const stream = query({
      prompt: "Reply with only the word 'ok'",
      options: {
        cwd: input.cwd,
        model: input.model,
        env: { ...input.environment },
        maxTurns: 1,
        tools: [],
        allowedTools: [],
        mcpServers: {},
        strictMcpConfig: true,
        settingSources: [],
        persistSession: false,
        permissionMode: 'dontAsk',
        stderr: () => undefined,
        abortController: input.controller,
      },
    });
    const close = () => {
      try {
        stream.close();
      } catch {
        /* No raw SDK diagnostics. */
      }
    };
    input.controller.signal.addEventListener('abort', close, { once: true });
    let rejectOnAbort: () => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectOnAbort = () => reject(new Error('aborted'));
      if (input.controller.signal.aborted) reject(new Error('aborted'));
      else input.controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
    });
    const classify = (text: string): ClaudeVerificationOutcome | undefined => {
      if (/credit balance|insufficient (credit|balance)|billing|payment required/i.test(text))
        return 'billing';
      if (/rate.?limit|limit reached|too many requests|429/i.test(text)) return 'rate-limit';
      if (
        /unauthorized|invalid.?api.?key|authentication.?error|token revoked|not authenticated|please run \/login/i.test(
          text
        )
      )
        return 'authentication';
    };
    try {
      const iterator = stream[Symbol.asyncIterator]();
      let count = 0;
      while (++count <= 100) {
        const step = await Promise.race([iterator.next(), aborted]);
        if (step.done) return 'no-response';
        const message = step.value;
        // Bounded inspection, no accumulation or transmission of raw diagnostics.
        const serialized = JSON.stringify(message);
        if (serialized.length > 131072) return 'failed';
        const record = message as unknown as Record<string, unknown>;
        const content = (
          record.message as { content?: Array<{ type?: string; text?: string }> } | undefined
        )?.content;
        const diagnostic = [
          typeof record.result === 'string' ? record.result : '',
          typeof record.error === 'string' ? record.error : '',
          ...(Array.isArray(record.errors)
            ? record.errors.filter((value): value is string => typeof value === 'string')
            : []),
          ...(Array.isArray(content)
            ? content
                .filter((value) => value.type === 'text' && typeof value.text === 'string')
                .map((value) => value.text!)
            : []),
        ].join('\n');
        const failure = classify(diagnostic);
        if (failure) return failure;
        if (message.type === 'result') {
          return message.subtype === 'success' &&
            message.is_error === false &&
            message.result.trim().length > 0
            ? 'verified'
            : 'failed';
        }
      }
      return 'failed';
    } catch (error) {
      if (input.controller.signal.aborted) return 'timeout';
      return classify(error instanceof Error ? error.message : '') ?? 'failed';
    } finally {
      input.controller.signal.removeEventListener('abort', close);
      input.controller.signal.removeEventListener('abort', rejectOnAbort);
      close();
    }
  }
}
