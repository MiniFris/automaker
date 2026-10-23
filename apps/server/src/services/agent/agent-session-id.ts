import { SessionIdSchema } from '@automaker/contracts';
import { ValidationDomainError } from '../../core/errors/domain-errors.js';

/** Transport may trim IDs, but storage/execution must share exactly one canonical key. */
export function assertCanonicalAgentSessionId(id: string): void {
  const parsed = SessionIdSchema.safeParse(id);
  if (!parsed.success || parsed.data !== id)
    throw new ValidationDomainError('Invalid agent session identifier.');
}
