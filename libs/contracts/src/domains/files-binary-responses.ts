import { z } from 'zod';

export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024;
export const DIRECTORY_DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const DOWNLOAD_DISPOSITION_MAX_LENGTH = 8192;
export const IMAGE_CACHE_CONTROL = 'public, max-age=3600';
export const IMAGE_BINARY_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
] as const;
export const DOWNLOAD_BINARY_MEDIA_TYPES = ['application/octet-stream', 'application/zip'] as const;
export const IMAGE_FILE_MIME_TYPES: Readonly<
  Record<string, (typeof IMAGE_BINARY_MEDIA_TYPES)[number]>
> = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
});
const length = (maximum: number) => z.number().int().nonnegative().max(maximum);
const lengthHeader = (maximum: number) =>
  z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .refine((value) => Number.isSafeInteger(Number(value)) && Number(value) <= maximum);
const disposition = z
  .string()
  .max(DOWNLOAD_DISPOSITION_MAX_LENGTH)
  .regex(/^attachment; filename="[^"\r\n]*"$/)
  .refine((value) => /^[\t\x20-\x7e\x80-\xff]*$/.test(value));

/** Buffered image bytes only. Streamed downloads are never passed to this schema. */
export const ImageBinaryBodySchema = z
  .instanceof(Uint8Array)
  .refine((body) => body.byteLength <= IMAGE_MAX_BYTES);
export const ImageBinaryHeadersSchema = z
  .object({
    'Content-Type': z.enum(IMAGE_BINARY_MEDIA_TYPES),
    'Cache-Control': z.literal(IMAGE_CACHE_CONTROL),
    'Content-Length': lengthHeader(IMAGE_MAX_BYTES),
  })
  .strict();
export const ImageBinaryResponseDescriptorSchema = z
  .object({
    status: z.literal(200),
    headers: ImageBinaryHeadersSchema,
    byteLength: length(IMAGE_MAX_BYTES),
  })
  .strict()
  .refine((value) => value.headers['Content-Length'] === String(value.byteLength));

export const FileDownloadBinaryHeadersSchema = z
  .object({
    'Content-Type': z.literal('application/octet-stream'),
    'Content-Disposition': disposition,
    'Content-Length': lengthHeader(DOWNLOAD_MAX_BYTES),
  })
  .strict();
export const DirectoryDownloadBinaryHeadersSchema = z
  .object({
    'Content-Type': z.literal('application/zip'),
    'Content-Disposition': disposition,
    'Content-Length': lengthHeader(DOWNLOAD_MAX_BYTES),
    'X-Directory-Size': lengthHeader(DIRECTORY_DOWNLOAD_MAX_BYTES),
  })
  .strict();
export const DownloadBinaryResponseDescriptorSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('file'),
        status: z.literal(200),
        headers: FileDownloadBinaryHeadersSchema,
        byteLength: length(DOWNLOAD_MAX_BYTES),
      })
      .strict(),
    z
      .object({
        kind: z.literal('directory'),
        status: z.literal(200),
        headers: DirectoryDownloadBinaryHeadersSchema,
        byteLength: length(DOWNLOAD_MAX_BYTES),
        directoryBytes: length(DIRECTORY_DOWNLOAD_MAX_BYTES),
      })
      .strict(),
  ])
  .refine(
    (value) =>
      value.headers['Content-Length'] === String(value.byteLength) &&
      (value.kind === 'file' || value.headers['X-Directory-Size'] === String(value.directoryBytes))
  );

export type ImageBinaryResponseDescriptor = z.infer<typeof ImageBinaryResponseDescriptorSchema>;
export type DownloadBinaryResponseDescriptor = z.infer<
  typeof DownloadBinaryResponseDescriptorSchema
>;
