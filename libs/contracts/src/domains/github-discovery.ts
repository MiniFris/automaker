import { z } from 'zod';
export const GithubProjectSchema = z.object({
  projectPath: z.string().min(1, 'projectPath is required'),
});
export type GithubProjectRequest = z.infer<typeof GithubProjectSchema>;
