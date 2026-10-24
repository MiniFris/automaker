import { Injectable } from '@nestjs/common';
import {
  writeValidation,
  getAllValidations,
  getValidationWithFreshness,
  deleteValidation,
  markValidationViewed,
  type StoredValidation,
} from '../../lib/validation-storage.js';

/** Native storage adapter; existing project-scoped files remain authoritative. */
@Injectable()
export class IssueValidationRepository {
  write(projectPath: string, issueNumber: number, validation: StoredValidation) {
    return writeValidation(projectPath, issueNumber, validation);
  }
  list(projectPath: string) {
    return getAllValidations(projectPath);
  }
  get(projectPath: string, issueNumber: number) {
    return getValidationWithFreshness(projectPath, issueNumber);
  }
  delete(projectPath: string, issueNumber: number) {
    return deleteValidation(projectPath, issueNumber);
  }
  markViewed(projectPath: string, issueNumber: number) {
    return markValidationViewed(projectPath, issueNumber);
  }
}
