import { z } from 'zod';

export const MCPServerRequestSchema = z.object({
  serverId: z.string().min(1, 'serverId is required'),
});

export type MCPServerRequest = z.infer<typeof MCPServerRequestSchema>;
