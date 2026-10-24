import { z } from 'zod';
import { MODEL_TIMEOUT_PROVIDERS } from '@automaker/types';

// One provider catalog governs settings validation on server and clients.
export const ModelTimeoutProviderSchema = z.enum(MODEL_TIMEOUT_PROVIDERS);
