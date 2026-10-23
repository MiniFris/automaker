import { z } from 'zod';

export const LoginRequestSchema = z.object({ apiKey: z.string().min(1) }).strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
