import { z } from 'zod';

export const LoginRequestSchema = z.object({ apiKey: z.string().min(1) }).strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AuthStatusResponseSchema = z.object({
  success: z.literal(true),
  authenticated: z.boolean(),
  required: z.literal(true),
});
export const LoginResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  token: z.string().min(1),
});
export const WebSocketTokenResponseSchema = z.object({
  success: z.literal(true),
  token: z.string().min(1),
  expiresIn: z.number().int().positive(),
});
export const LogoutResponseSchema = z.object({ success: z.literal(true), message: z.string() });
