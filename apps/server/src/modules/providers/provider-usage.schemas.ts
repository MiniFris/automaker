import { z } from 'zod';

export const ZaiConfigureSchema = z
  .object({
    apiToken: z.string(),
    apiHost: z
      .string()
      .url()
      .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
        message: 'apiHost must use HTTP or HTTPS',
      })
      .optional(),
  })
  .strict();
export const ZaiVerifySchema = z.object({ apiKey: z.string() }).strict();

export type ZaiConfigureRequest = z.infer<typeof ZaiConfigureSchema>;
export type ZaiVerifyRequest = z.infer<typeof ZaiVerifySchema>;
