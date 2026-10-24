import { Inject, Injectable } from '@nestjs/common';
import { TextDecoder } from 'node:util';
import type { ReadableStreamDefaultReader } from 'node:stream/web';
import { CodexCredentialRuntime, type CodexCredential } from './codex-credential.runtime.js';

export type CodexVerificationOutcome =
  | 'verified'
  | 'authentication'
  | 'billing'
  | 'rate-limit'
  | 'no-response'
  | 'timeout'
  | 'failed';
export interface CodexVerificationRun {
  endpoint: string;
  model: 'gpt-5.2-codex';
  authMethod: 'cli' | 'api_key';
  credentialKind: CodexCredential['kind'];
  apiKey?: string;
  controller: AbortController;
}
export abstract class CodexVerificationRuntime {
  abstract run(input: CodexVerificationRun): Promise<CodexVerificationOutcome>;
}

/** Tool-free Responses request: no agent thread or local tool execution loop. */
@Injectable()
export class NodeCodexVerificationRuntime extends CodexVerificationRuntime {
  constructor(
    @Inject(CodexCredentialRuntime) private readonly credentials: CodexCredentialRuntime
  ) {
    super();
  }
  async run(input: CodexVerificationRun): Promise<CodexVerificationOutcome> {
    const classify = (text: string): CodexVerificationOutcome | undefined => {
      if (
        /insufficient_quota|insufficient credit|credit balance|billing|payment required/i.test(text)
      )
        return 'billing';
      if (/rate.?limit|too many requests|429/i.test(text)) return 'rate-limit';
      if (/unauthorized|invalid.?api.?key|authentication|not authenticated|401|403/i.test(text))
        return 'authentication';
    };
    if (input.controller.signal.aborted) return 'timeout';
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const credential =
        input.authMethod === 'cli'
          ? await this.credentials.read(true, input.controller)
          : { kind: 'api-key' as const, token: input.apiKey };
      if (credential.kind !== input.credentialKind || !credential.token) return 'authentication';
      const headers: Record<string, string> = {
        Authorization: `Bearer ${credential.token}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      };
      if (credential.kind === 'chatgpt') {
        const payload = credential.token.split('.')[1];
        if (!payload || payload.length > 16384) return 'authentication';
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        const id = claims['https://api.openai.com/auth']?.chatgpt_account_id;
        if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(id)) return 'authentication';
        headers['ChatGPT-Account-Id'] = id;
      }
      const response = await fetch(input.endpoint, {
        method: 'POST',
        headers,
        signal: input.controller.signal,
        redirect: 'error',
        body: JSON.stringify({
          model: input.model,
          instructions: "Reply with only the word 'ok'.",
          input: [
            {
              role: 'user',
              content: [{ type: 'input_text', text: 'Reply with only the word ok.' }],
            },
          ],
          tools: [],
          tool_choice: 'none',
          parallel_tool_calls: false,
          store: false,
          stream: true,
        }),
      });
      if (!response.body) return 'no-response';
      reader = response.body.getReader();
      let buffer = '',
        bytes = 0,
        events = 0;
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1048576) return 'failed';
        buffer += decoder.decode(chunk.value, { stream: true });
        if (!response.ok) {
          if (buffer.length > 131072) return 'failed';
          continue;
        }
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const block = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          if (++events > 1000 || block.length > 131072) return 'failed';
          const data = block
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (!data || data === '[DONE]') continue;
          const event = JSON.parse(data);
          if (event.type === 'error' || event.type === 'response.failed')
            return classify(JSON.stringify(event.error ?? event.response?.error ?? {})) ?? 'failed';
          if (event.type === 'response.completed') {
            const result = event.response;
            if (result?.status !== 'completed' || result.error || !Array.isArray(result.output))
              return 'failed';
            if (
              result.output.some(
                (item: { type?: string }) => !['message', 'reasoning'].includes(item.type ?? '')
              )
            )
              return 'failed';
            const text = result.output
              .filter((item: { type?: string }) => item.type === 'message')
              .flatMap(
                (item: { content?: Array<{ type?: string; text?: string }> }) => item.content ?? []
              )
              .filter(
                (part: { type?: string; text?: string }) =>
                  part.type === 'output_text' && typeof part.text === 'string'
              )
              .map((part: { text: string }) => part.text)
              .join('');
            return classify(text) ?? (text.trim() ? 'verified' : 'no-response');
          }
        }
        if (buffer.length > 131072) return 'failed';
      }
      return response.ok
        ? 'no-response'
        : (classify(buffer) ??
            (response.status === 401 || response.status === 403
              ? 'authentication'
              : response.status === 402
                ? 'billing'
                : response.status === 429
                  ? 'rate-limit'
                  : 'failed'));
    } catch {
      return input.controller.signal.aborted ? 'timeout' : 'failed';
    } finally {
      await reader?.cancel().catch(() => undefined);
      reader?.releaseLock();
    }
  }
}
