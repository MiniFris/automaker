import { UnavailableDomainError } from '../../core/errors/domain-errors.js';

/** Safe transport error: never include file contents, prompts or parse-error snippets. */
export class AgentSessionStorageError extends UnavailableDomainError {
  constructor(readonly operation: 'read' | 'write') {
    super(
      'Agent session storage is unavailable. The result may not be persisted; check history and storage before retrying.'
    );
  }
}
