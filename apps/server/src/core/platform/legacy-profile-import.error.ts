import { UnavailableDomainError } from '../errors/index.js';

/** An incomplete profile must not be accepted as a new empty/default profile. */
export class LegacyProfileImportError extends UnavailableDomainError {
  constructor() {
    super('Legacy profile import is incomplete.');
  }
}
