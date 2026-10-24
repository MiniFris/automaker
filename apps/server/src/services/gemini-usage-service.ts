/**
 * Gemini Usage Service
 *
 * Service for tracking Gemini CLI usage and quota.
 * Uses the internal Google Cloud quota API (same as CodexBar).
 * See: https://github.com/steipete/CodexBar/blob/main/docs/gemini.md
 *
 * Reads an existing CLI access token for quota requests. OAuth refresh and
 * vendor credential writes remain the responsibility of the Gemini CLI.
 */

import { createLogger } from '@automaker/utils';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const logger = createLogger('GeminiUsage');

// Quota API endpoint (internal Google Cloud API)
const QUOTA_API_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';

// Code Assist endpoint for getting project ID and tier info
const CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';

/** Default timeout for fetch requests in milliseconds */
const FETCH_TIMEOUT_MS = 10_000;

/** TTL for cached credentials in milliseconds (5 minutes) */
const CREDENTIALS_CACHE_TTL_MS = 5 * 60 * 1000;

export interface GeminiQuotaBucket {
  /** Model ID this quota applies to */
  modelId: string;
  /** Remaining fraction (0-1) */
  remainingFraction: number;
  /** ISO-8601 reset time */
  resetTime: string;
}

/** Simplified quota info for a model tier (Flash or Pro) */
export interface GeminiTierQuota {
  /** Used percentage (0-100) */
  usedPercent: number;
  /** Remaining percentage (0-100) */
  remainingPercent: number;
  /** Reset time as human-readable string */
  resetText?: string;
  /** ISO-8601 reset time */
  resetTime?: string;
}

export interface GeminiUsageData {
  /** Whether authenticated via CLI */
  authenticated: boolean;
  /** Authentication method */
  authMethod: 'cli_login' | 'api_key' | 'none';
  /** Usage percentage (100 - remainingFraction * 100) - overall most constrained */
  usedPercent: number;
  /** Remaining percentage - overall most constrained */
  remainingPercent: number;
  /** Reset time as human-readable string */
  resetText?: string;
  /** ISO-8601 reset time */
  resetTime?: string;
  /** Model ID with lowest remaining quota */
  constrainedModel?: string;
  /** Flash tier quota (aggregated from all flash models) */
  flashQuota?: GeminiTierQuota;
  /** Pro tier quota (aggregated from all pro models) */
  proQuota?: GeminiTierQuota;
  /** Raw quota buckets for detailed view */
  quotaBuckets?: GeminiQuotaBucket[];
  /** When this data was last fetched */
  lastUpdated: string;
  /** Optional error message */
  error?: string;
}

interface OAuthCredentials {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  expiry_date?: number;
  client_id?: string;
  client_secret?: string;
}

interface QuotaResponse {
  // The actual API returns 'buckets', not 'quotaBuckets'
  buckets?: Array<{
    modelId?: string;
    remainingFraction?: number;
    resetTime?: string;
    tokenType?: string;
  }>;
  // Legacy field name (in case API changes)
  quotaBuckets?: Array<{
    modelId?: string;
    remainingFraction?: number;
    resetTime?: string;
    tokenType?: string;
  }>;
}

/**
 * Gemini Usage Service
 *
 * Provides real usage/quota data for Gemini CLI users.
 * Extracts OAuth credentials from the Gemini CLI installation.
 */
export class GeminiUsageService {
  private cachedCredentials: OAuthCredentials | null = null;
  private cachedCredentialsAt: number | null = null;
  private credentialsPath: string;
  /** The actual path from which credentials were loaded (for write-back) */
  private loadedCredentialsPath: string | null = null;
  private readonly environment: Readonly<NodeJS.ProcessEnv>;
  private readonly homeDirectory: string;

  constructor(
    environment: Readonly<NodeJS.ProcessEnv> = process.env,
    private readonly workingDirectory: string = process.cwd()
  ) {
    this.environment = Object.freeze({ ...environment });
    this.homeDirectory = this.environment.HOME || this.environment.USERPROFILE || os.homedir();
    // Default credentials path for Gemini CLI
    this.credentialsPath = path.join(this.homeDirectory, '.gemini', 'oauth_creds.json');
  }

  /**
   * Check if Gemini CLI is authenticated
   */
  async isAvailable(): Promise<boolean> {
    const creds = await this.loadCredentials();
    return Boolean(creds?.access_token || creds?.refresh_token);
  }

  /**
   * Fetch quota/usage data from Google Cloud API
   */
  async fetchUsageData(): Promise<GeminiUsageData> {
    logger.info('[fetchUsageData] Starting...');

    const creds = await this.loadCredentials();

    if (!creds || (!creds.access_token && !creds.refresh_token)) {
      logger.info('[fetchUsageData] No credentials found');
      return {
        authenticated: false,
        authMethod: 'none',
        usedPercent: 0,
        remainingPercent: 100,
        lastUpdated: new Date().toISOString(),
        error: 'Not authenticated. Run "gemini auth login" to authenticate.',
      };
    }

    try {
      // Reuse only an existing usable access token; never refresh on a usage read.
      const accessToken = await this.getValidAccessToken(creds);

      if (!accessToken) {
        return {
          authenticated: false,
          authMethod: 'none',
          usedPercent: 0,
          remainingPercent: 100,
          lastUpdated: new Date().toISOString(),
          error: 'Failed to obtain access token. Try running "gemini auth login" again.',
        };
      }

      // First, get the project ID from loadCodeAssist endpoint
      // This is required to get accurate quota data
      let projectId: string | undefined;
      try {
        const codeAssistResponse = await fetch(CODE_ASSIST_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (codeAssistResponse.ok) {
          const codeAssistData = (await codeAssistResponse.json()) as {
            cloudaicompanionProject?: string;
            currentTier?: { id?: string; name?: string };
          };
          projectId = codeAssistData.cloudaicompanionProject;
          logger.debug('[fetchUsageData] Got project ID:', projectId);
        }
      } catch (e) {
        logger.debug('[fetchUsageData] Failed to get project ID:', e);
      }

      // Fetch quota from Google Cloud API
      // Pass project ID to get accurate quota (without it, returns default 100%)
      const response = await fetch(QUOTA_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(projectId ? { project: projectId } : {}),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        logger.error('[fetchUsageData] Quota API error:', response.status, errorText);

        // Still authenticated, but quota API failed
        return {
          authenticated: true,
          authMethod: 'cli_login',
          usedPercent: 0,
          remainingPercent: 100,
          lastUpdated: new Date().toISOString(),
          error: `Quota API unavailable (${response.status})`,
        };
      }

      const data = (await response.json()) as QuotaResponse;

      // API returns 'buckets', with fallback to 'quotaBuckets' for compatibility
      const apiBuckets = data.buckets || data.quotaBuckets;

      logger.debug('[fetchUsageData] Raw buckets:', JSON.stringify(apiBuckets));

      if (!apiBuckets || apiBuckets.length === 0) {
        return {
          authenticated: true,
          authMethod: 'cli_login',
          usedPercent: 0,
          remainingPercent: 100,
          lastUpdated: new Date().toISOString(),
        };
      }

      // Group buckets into Flash and Pro tiers
      // Flash: any model with "flash" in the name
      // Pro: any model with "pro" in the name
      let flashLowestRemaining = 1.0;
      let flashResetTime: string | undefined;
      let hasFlashModels = false;
      let proLowestRemaining = 1.0;
      let proResetTime: string | undefined;
      let hasProModels = false;
      let overallLowestRemaining = 1.0;
      let constrainedModel: string | undefined;
      let overallResetTime: string | undefined;

      const quotaBuckets: GeminiQuotaBucket[] = apiBuckets.map((bucket) => {
        const remaining = bucket.remainingFraction ?? 1.0;
        const modelId = bucket.modelId?.toLowerCase() || '';

        // Track overall lowest
        if (remaining < overallLowestRemaining) {
          overallLowestRemaining = remaining;
          constrainedModel = bucket.modelId;
          overallResetTime = bucket.resetTime;
        }

        // Group into Flash or Pro tier
        if (modelId.includes('flash')) {
          hasFlashModels = true;
          if (remaining < flashLowestRemaining) {
            flashLowestRemaining = remaining;
            flashResetTime = bucket.resetTime;
          }
          // Also track reset time even if at 100%
          if (!flashResetTime && bucket.resetTime) {
            flashResetTime = bucket.resetTime;
          }
        } else if (modelId.includes('pro')) {
          hasProModels = true;
          if (remaining < proLowestRemaining) {
            proLowestRemaining = remaining;
            proResetTime = bucket.resetTime;
          }
          // Also track reset time even if at 100%
          if (!proResetTime && bucket.resetTime) {
            proResetTime = bucket.resetTime;
          }
        }

        return {
          modelId: bucket.modelId || 'unknown',
          remainingFraction: remaining,
          resetTime: bucket.resetTime || '',
        };
      });

      const usedPercent = Math.round((1 - overallLowestRemaining) * 100);
      const remainingPercent = Math.round(overallLowestRemaining * 100);

      // Build tier quotas (only include if we found models for that tier)
      const flashQuota: GeminiTierQuota | undefined = hasFlashModels
        ? {
            usedPercent: Math.round((1 - flashLowestRemaining) * 100),
            remainingPercent: Math.round(flashLowestRemaining * 100),
            resetText: flashResetTime ? this.formatResetTime(flashResetTime) : undefined,
            resetTime: flashResetTime,
          }
        : undefined;

      const proQuota: GeminiTierQuota | undefined = hasProModels
        ? {
            usedPercent: Math.round((1 - proLowestRemaining) * 100),
            remainingPercent: Math.round(proLowestRemaining * 100),
            resetText: proResetTime ? this.formatResetTime(proResetTime) : undefined,
            resetTime: proResetTime,
          }
        : undefined;

      return {
        authenticated: true,
        authMethod: 'cli_login',
        usedPercent,
        remainingPercent,
        resetText: overallResetTime ? this.formatResetTime(overallResetTime) : undefined,
        resetTime: overallResetTime,
        constrainedModel,
        flashQuota,
        proQuota,
        quotaBuckets,
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[fetchUsageData] Error:', errorMsg);

      return {
        authenticated: true,
        authMethod: 'cli_login',
        usedPercent: 0,
        remainingPercent: 100,
        lastUpdated: new Date().toISOString(),
        error: 'Failed to fetch Gemini quota.',
      };
    }
  }

  /**
   * Load OAuth credentials from file.
   * Implements TTL-based cache invalidation and file mtime checks.
   */
  private async loadCredentials(): Promise<OAuthCredentials | null> {
    // Check if cached credentials are still valid
    if (this.cachedCredentials && this.cachedCredentialsAt) {
      const now = Date.now();
      const cacheAge = now - this.cachedCredentialsAt;

      if (cacheAge < CREDENTIALS_CACHE_TTL_MS) {
        // Cache is within TTL - also check file mtime
        const sourcePath = this.loadedCredentialsPath || this.credentialsPath;
        try {
          const stat = fs.statSync(sourcePath);
          if (stat.mtimeMs <= this.cachedCredentialsAt) {
            // File hasn't been modified since we cached - use cache
            return this.cachedCredentials;
          }
          // File has been modified, fall through to re-read
          logger.debug('[loadCredentials] File modified since cache, re-reading');
        } catch {
          // File doesn't exist or can't stat - use cache
          return this.cachedCredentials;
        }
      } else {
        // Cache TTL expired, discard
        logger.debug('[loadCredentials] Cache TTL expired, re-reading');
      }

      // Invalidate cached credentials
      this.cachedCredentials = null;
      this.cachedCredentialsAt = null;
    }

    // Build unique possible paths (deduplicate)
    const rawPaths = [
      this.credentialsPath,
      path.join(this.homeDirectory, '.config', 'gemini', 'oauth_creds.json'),
    ];
    const possiblePaths = [...new Set(rawPaths)];

    for (const credPath of possiblePaths) {
      try {
        if (fs.existsSync(credPath)) {
          const content = fs.readFileSync(credPath, 'utf8');
          const creds = JSON.parse(content);

          // Handle different credential formats
          if (creds.access_token || creds.refresh_token) {
            this.cachedCredentials = creds;
            this.cachedCredentialsAt = Date.now();
            this.loadedCredentialsPath = credPath;
            logger.info('[loadCredentials] Loaded from:', credPath);
            return creds;
          }

          // Some formats nest credentials under 'web' or 'installed'
          if (creds.web?.client_id || creds.installed?.client_id) {
            const clientCreds = creds.web || creds.installed;
            this.cachedCredentials = {
              client_id: clientCreds.client_id,
              client_secret: clientCreds.client_secret,
            };
            this.cachedCredentialsAt = Date.now();
            this.loadedCredentialsPath = credPath;
            return this.cachedCredentials;
          }
        }
      } catch (error) {
        logger.debug('[loadCredentials] Failed to load from', credPath, error);
      }
    }

    return null;
  }

  /** Passive usage never refreshes OAuth credentials or writes the vendor profile. */
  private async getValidAccessToken(creds: OAuthCredentials): Promise<string | null> {
    if (!creds.access_token) return null;
    if (creds.expiry_date !== undefined && creds.expiry_date <= Date.now() + 5 * 60 * 1000)
      return null;
    return creds.access_token;
  }

  /**
   * Format reset time as human-readable string
   */
  private formatResetTime(isoTime: string): string {
    try {
      const resetDate = new Date(isoTime);
      const now = new Date();
      const diff = resetDate.getTime() - now.getTime();

      if (diff < 0) {
        return 'Resetting soon';
      }

      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(minutes / 60);

      if (hours > 0) {
        const remainingMins = minutes % 60;
        return remainingMins > 0 ? `Resets in ${hours}h ${remainingMins}m` : `Resets in ${hours}h`;
      }

      return `Resets in ${minutes}m`;
    } catch {
      return '';
    }
  }

  /**
   * Clear cached credentials (useful after logout)
   */
  clearCache(): void {
    this.cachedCredentials = null;
    this.cachedCredentialsAt = null;
  }
}

// Singleton instance
let usageServiceInstance: GeminiUsageService | null = null;

/**
 * Get the singleton instance of GeminiUsageService
 */
export function getGeminiUsageService(): GeminiUsageService {
  if (!usageServiceInstance) {
    usageServiceInstance = new GeminiUsageService();
  }
  return usageServiceInstance;
}
