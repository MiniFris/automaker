/**
 * Validation Storage - CRUD operations for GitHub issue validation results
 *
 * Stores validation results in .automaker/validations/{issueNumber}/validation.json
 * Results include the validation verdict, metadata, and timestamp for cache invalidation.
 */

import * as secureFs from './secure-fs.js';
import { getValidationsDir, getValidationDir, getValidationPath } from '@automaker/platform';
import type { StoredValidation } from '@automaker/types';
import { atomicWriteText } from './atomic-write-text.js';

export type ValidationFilesystem = Pick<
  typeof secureFs,
  'readFile' | 'writeFile' | 'rename' | 'mkdir' | 'lstat' | 'readdir' | 'rm'
>;

// Re-export StoredValidation for convenience
export type { StoredValidation };

/** Number of hours before a validation is considered stale */
const VALIDATION_CACHE_TTL_HOURS = 24;

/**
 * Write validation result to storage
 *
 * Creates the validation directory if needed and stores the result as JSON.
 *
 * @param projectPath - Absolute path to project directory
 * @param issueNumber - GitHub issue number
 * @param data - Validation data to store
 */
export async function writeValidation(
  projectPath: string,
  issueNumber: number,
  data: StoredValidation,
  filesystem: ValidationFilesystem = secureFs
): Promise<void> {
  const validationDir = getValidationDir(projectPath, issueNumber);
  const validationPath = getValidationPath(projectPath, issueNumber);

  // Ensure directory exists
  await filesystem.mkdir(validationDir, { recursive: true });

  // Write validation result
  await atomicWriteText(validationPath, JSON.stringify(data, null, 2), filesystem);
}

/**
 * Read validation result from storage
 *
 * @param projectPath - Absolute path to project directory
 * @param issueNumber - GitHub issue number
 * @returns Stored validation or null if not found
 */
export async function readValidation(
  projectPath: string,
  issueNumber: number,
  filesystem: ValidationFilesystem = secureFs
): Promise<StoredValidation | null> {
  try {
    const validationPath = getValidationPath(projectPath, issueNumber);
    const content = (await filesystem.readFile(validationPath, 'utf-8')) as string;
    const validation = JSON.parse(content) as StoredValidation;
    if (
      !validation ||
      validation.issueNumber !== issueNumber ||
      typeof validation.issueTitle !== 'string' ||
      typeof validation.validatedAt !== 'string' ||
      typeof validation.model !== 'string' ||
      !validation.result ||
      typeof validation.result !== 'object'
    )
      throw new Error('Stored issue validation is malformed.');
    return validation;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Get all stored validations for a project
 *
 * @param projectPath - Absolute path to project directory
 * @returns Array of stored validations
 */
export async function getAllValidations(
  projectPath: string,
  filesystem: ValidationFilesystem = secureFs
): Promise<StoredValidation[]> {
  const validationsDir = getValidationsDir(projectPath);

  try {
    const dirs = await filesystem.readdir(validationsDir, { withFileTypes: true });

    // Read all validation files in parallel for better performance
    const promises = dirs
      .filter((dir) => dir.isDirectory())
      .map((dir) => {
        const issueNumber = parseInt(dir.name, 10);
        if (!isNaN(issueNumber)) {
          return readValidation(projectPath, issueNumber, filesystem);
        }
        return Promise.resolve(null);
      });

    const results = await Promise.all(promises);
    const validations = results.filter((v): v is StoredValidation => v !== null);

    // Sort by issue number
    validations.sort((a, b) => a.issueNumber - b.issueNumber);

    return validations;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Delete a validation from storage
 *
 * @param projectPath - Absolute path to project directory
 * @param issueNumber - GitHub issue number
 * @returns true if validation was deleted, false if not found
 */
export async function deleteValidation(
  projectPath: string,
  issueNumber: number,
  filesystem: ValidationFilesystem = secureFs
): Promise<boolean> {
  try {
    const validationDir = getValidationDir(projectPath, issueNumber);
    await filesystem.rm(validationDir, { recursive: true, force: true });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

/**
 * Check if a validation is stale (older than TTL)
 *
 * @param validation - Stored validation to check
 * @returns true if validation is older than 24 hours
 */
export function isValidationStale(validation: StoredValidation): boolean {
  const validatedAt = new Date(validation.validatedAt);
  const now = new Date();
  const hoursDiff = (now.getTime() - validatedAt.getTime()) / (1000 * 60 * 60);
  return hoursDiff > VALIDATION_CACHE_TTL_HOURS;
}

/**
 * Get validation with freshness info
 *
 * @param projectPath - Absolute path to project directory
 * @param issueNumber - GitHub issue number
 * @returns Object with validation and isStale flag, or null if not found
 */
export async function getValidationWithFreshness(
  projectPath: string,
  issueNumber: number,
  filesystem: ValidationFilesystem = secureFs
): Promise<{ validation: StoredValidation; isStale: boolean } | null> {
  const validation = await readValidation(projectPath, issueNumber, filesystem);
  if (!validation) {
    return null;
  }

  return {
    validation,
    isStale: isValidationStale(validation),
  };
}

/**
 * Mark a validation as viewed by the user
 *
 * @param projectPath - Absolute path to project directory
 * @param issueNumber - GitHub issue number
 * @returns true if validation was marked as viewed, false if not found
 */
export async function markValidationViewed(
  projectPath: string,
  issueNumber: number,
  filesystem: ValidationFilesystem = secureFs
): Promise<boolean> {
  const validation = await readValidation(projectPath, issueNumber, filesystem);
  if (!validation) {
    return false;
  }

  validation.viewedAt = new Date().toISOString();
  await writeValidation(projectPath, issueNumber, validation, filesystem);
  return true;
}

/**
 * Get count of unviewed, non-stale validations for a project
 *
 * @param projectPath - Absolute path to project directory
 * @returns Number of unviewed validations
 */
export async function getUnviewedValidationsCount(
  projectPath: string,
  filesystem: ValidationFilesystem = secureFs
): Promise<number> {
  const validations = await getAllValidations(projectPath, filesystem);
  return validations.filter((v) => !v.viewedAt && !isValidationStale(v)).length;
}
