import { z } from 'zod';

const success = z.literal(true);
const entry = z
  .object({ name: z.string(), isDirectory: z.boolean(), isFile: z.boolean() })
  .passthrough();
export const FilesSuccessResponseSchema = z.object({ success }).passthrough();
export const FilesReadResponseSchema = z.object({ success, content: z.string() }).passthrough();
export const FilesListResponseSchema = z.object({ success, entries: z.array(entry) }).passthrough();
export const FilesStatResponseSchema = z
  .object({
    success,
    stats: z
      .object({
        isDirectory: z.boolean(),
        isFile: z.boolean(),
        size: z.number().nonnegative(),
        // Native stat produces Date; Express previously serialized the same ISO value.
        mtime: z.preprocess(
          (value) => (value instanceof Date ? value.toJSON() : value),
          z.iso.datetime()
        ),
      })
      .passthrough(),
  })
  .passthrough();
export const FilesExistsResponseSchema = z.object({ success, exists: z.boolean() }).passthrough();
export const FilesPathResponseSchema = z.object({ success, path: z.string() }).passthrough();
export const FilesValidatedPathResponseSchema = z
  .object({ success, path: z.string(), isAllowed: z.literal(true) })
  .passthrough();
export const FilesBrowseResponseSchema = z
  .object({
    success,
    currentPath: z.string(),
    parentPath: z.string().nullable(),
    directories: z.array(z.object({ name: z.string(), path: z.string() }).passthrough()),
    drives: z.array(z.unknown()),
    warning: z.string().optional(),
  })
  .passthrough();
export const FilesBrowseProjectResponseSchema = z
  .object({
    success,
    currentRelativePath: z.string(),
    parentRelativePath: z.string().nullable(),
    entries: z.array(entry.extend({ relativePath: z.string() })),
  })
  .passthrough();
