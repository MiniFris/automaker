import { z } from 'zod';

/** Language of newly generated content; omitted by older/API-only clients. */
export const OutputLocaleSchema = z.enum(['en', 'ru']);
