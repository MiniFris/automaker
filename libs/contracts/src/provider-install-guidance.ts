import { z } from 'zod';
import { ProviderConnectionTargetSchema } from './provider-connection.js';

/** Instructions only: neither success flag nor HTTP 200 is proof of installation. */
export const ProviderInstallGuidanceSchema = z
  .object({
    success: z.boolean(),
    message: z.string().optional(),
    error: z.string().optional(),
    requiresManualInstall: z.literal(true),
    installationPerformed: z.literal(false),
    installCommand: z.string().min(1),
    target: ProviderConnectionTargetSchema,
  })
  .strict();
export type ProviderInstallGuidance = z.infer<typeof ProviderInstallGuidanceSchema>;
