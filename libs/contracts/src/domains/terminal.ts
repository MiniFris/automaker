import { z } from 'zod';

// Keep these bounds aligned with the terminal service admission limits.
export const TERMINAL_MIN_MAX_SESSIONS = 1;
export const TERMINAL_MAX_MAX_SESSIONS = 1000;
export const TerminalSessionIdSchema = z.string();

const TerminalColumnsSchema = z.number().int().min(1).max(1000);
const TerminalRowsSchema = z.number().int().min(1).max(500);

// Existing terminal HTTP handlers ignore additional options rather than rejecting them.
export const TerminalCreateSessionSchema = z
  .looseObject({
    cwd: z
      .string()
      .min(1)
      .regex(/^[^\0]+$/)
      .optional(),
    cols: TerminalColumnsSchema.optional(),
    rows: TerminalRowsSchema.optional(),
    shell: z.string().optional(),
    environmentTargetId: z.string().optional(),
  })
  .or(z.array(z.unknown()))
  .nullish();

export const TerminalResizeSchema = z.looseObject({
  cols: TerminalColumnsSchema,
  rows: TerminalRowsSchema,
});

export const TerminalSettingsSchema = z
  .looseObject({
    maxSessions: z
      .number()
      .int()
      .min(TERMINAL_MIN_MAX_SESSIONS)
      .max(TERMINAL_MAX_MAX_SESSIONS)
      .optional(),
  })
  .or(z.array(z.unknown()));

export type TerminalCreateSessionRequest = z.infer<typeof TerminalCreateSessionSchema>;
export type TerminalResizeRequest = z.infer<typeof TerminalResizeSchema>;
export type TerminalSettingsRequest = z.infer<typeof TerminalSettingsSchema>;
