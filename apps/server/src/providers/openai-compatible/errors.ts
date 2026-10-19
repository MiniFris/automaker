/** Only locally authored messages may escape to ProviderMessage or logs. */
export class OpenAICompatibleError extends Error {
  constructor(message: string) {
    super(`OpenAI-compatible: ${message}`);
    this.name = 'OpenAICompatibleError';
  }
}

export function protocolError(): never {
  throw new OpenAICompatibleError('Invalid or incomplete Chat Completions response.');
}
