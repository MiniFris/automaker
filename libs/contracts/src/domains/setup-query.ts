import { z } from 'zod';

// Express's simple query parser returns strings or arrays for repeated keys.
// Refresh is enabled only for the literal string 'true'; other values remain false.
export const SetupQueryValueSchema = z.union([z.string(), z.array(z.string())]).optional();
export const ProviderRefreshQuerySchema = SetupQueryValueSchema;

// Semantic validation remains after service admission, preserving its wire errors.
export const VerificationAuthMethodSchema = z.enum(['cli', 'api_key']);
export const CursorPermissionsScopeSchema = z.enum(['global', 'project']);
export const CursorPermissionProfileIdSchema = z.enum(['strict', 'development']);
