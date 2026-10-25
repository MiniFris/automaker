import { CodexUsageRuntime } from '../core/platform/codex-usage.runtime.js';
import { legacyCodexUsageRuntime } from './codex-usage-compat.js';
import { createLogger } from '@automaker/utils';
import {
  CodexAppServerCleanupError,
  type CodexAppServerService,
} from './codex-app-server-service.js';

const logger = createLogger('CodexUsage');

export interface CodexRateLimitWindow {
  limit: number;
  used: number;
  remaining: number;
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number;
}

export type CodexPlanType = 'free' | 'plus' | 'pro' | 'team' | 'enterprise' | 'edu' | 'unknown';

export interface CodexUsageData {
  rateLimits: {
    primary?: CodexRateLimitWindow;
    secondary?: CodexRateLimitWindow;
    planType?: CodexPlanType;
  } | null;
  lastUpdated: string;
}

/**
 * Codex Usage Service
 *
 * Fetches usage data from Codex CLI using the app-server JSON-RPC API.
 * Falls back to auth file parsing if app-server is unavailable.
 */
export class CodexUsageService {
  private appServerService: CodexAppServerService | null = null;
  private accountPlanTypeArray: CodexPlanType[] = [
    'free',
    'plus',
    'pro',
    'team',
    'enterprise',
    'edu',
  ];

  constructor(
    appServerService?: CodexAppServerService,
    private readonly runtime: CodexUsageRuntime = legacyCodexUsageRuntime
  ) {
    this.appServerService = appServerService || null;
  }

  /**
   * Check if Codex CLI is available on the system
   */
  async isAvailable(): Promise<boolean> {
    return Boolean((await this.runtime.snapshot()).cliPath);
  }

  /**
   * Attempt to fetch usage data
   *
   * Priority order:
   * 1. Codex app-server JSON-RPC API (most reliable, provides real-time data)
   * 2. Auth file JWT parsing (fallback for plan type)
   */
  async fetchUsageData(): Promise<CodexUsageData> {
    logger.info('[fetchUsageData] Starting...');
    const cliPath = (await this.runtime.snapshot()).cliPath;

    if (!cliPath) {
      logger.error('[fetchUsageData] Codex CLI not found');
      throw new Error('Codex CLI not found. Please install it with: npm install -g @openai/codex');
    }

    // Try to get usage from Codex app-server (most reliable method)
    const appServerUsage = await this.fetchFromAppServer();
    if (appServerUsage) {
      logger.info('[fetchUsageData] ✓ Fetched usage from app-server');
      return appServerUsage;
    }

    logger.info('[fetchUsageData] App-server failed, trying auth file fallback...');

    // Fallback: try to parse usage from auth file
    const authUsage = await this.fetchFromAuthFile();
    if (authUsage) {
      logger.info('[fetchUsageData] ✓ Fetched usage from auth file');
      return authUsage;
    }

    logger.info('[fetchUsageData] All methods failed, returning unknown');

    // If all else fails, return unknown
    return {
      rateLimits: {
        planType: 'unknown',
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Fetch usage data from Codex app-server using JSON-RPC API
   * This is the most reliable method as it gets real-time data from OpenAI
   */
  private async fetchFromAppServer(): Promise<CodexUsageData | null> {
    try {
      // Use CodexAppServerService if available
      if (!this.appServerService) {
        return null;
      }

      // Fetch account and rate limits in parallel
      const [accountResult, rateLimitsResult] = await Promise.all([
        this.appServerService.getAccount(),
        this.appServerService.getRateLimits(),
      ]);

      if (!accountResult) {
        return null;
      }

      // Build response
      // Prefer planType from rateLimits (more accurate/current) over account (can be stale)
      let planType: CodexPlanType = 'unknown';

      // First try rate limits planType (most accurate)
      const rateLimitsPlanType = rateLimitsResult?.rateLimits?.planType;
      if (rateLimitsPlanType) {
        const normalizedType = rateLimitsPlanType.toLowerCase() as CodexPlanType;
        if (this.accountPlanTypeArray.includes(normalizedType)) {
          planType = normalizedType;
        }
      }

      // Fall back to account planType if rate limits didn't have it
      if (planType === 'unknown' && accountResult.account?.planType) {
        const normalizedType = accountResult.account.planType.toLowerCase() as CodexPlanType;
        if (this.accountPlanTypeArray.includes(normalizedType)) {
          planType = normalizedType;
        }
      }

      const result: CodexUsageData = {
        rateLimits: {
          planType,
        },
        lastUpdated: new Date().toISOString(),
      };

      // Add rate limit info if available
      if (rateLimitsResult?.rateLimits?.primary) {
        const primary = rateLimitsResult.rateLimits.primary;
        result.rateLimits!.primary = {
          limit: -1, // Not provided by API
          used: -1, // Not provided by API
          remaining: -1, // Not provided by API
          usedPercent: primary.usedPercent,
          windowDurationMins: primary.windowDurationMins,
          resetsAt: primary.resetsAt,
        };
      }

      // Add secondary rate limit if available
      if (rateLimitsResult?.rateLimits?.secondary) {
        const secondary = rateLimitsResult.rateLimits.secondary;
        result.rateLimits!.secondary = {
          limit: -1, // Not provided by API
          used: -1, // Not provided by API
          remaining: -1, // Not provided by API
          usedPercent: secondary.usedPercent,
          windowDurationMins: secondary.windowDurationMins,
          resetsAt: secondary.resetsAt,
        };
      }

      logger.info(
        `[fetchFromAppServer] ✓ Plan: ${planType}, Primary: ${result.rateLimits?.primary?.usedPercent || 'N/A'}%, Secondary: ${result.rateLimits?.secondary?.usedPercent || 'N/A'}%`
      );
      return result;
    } catch (error) {
      if (error instanceof CodexAppServerCleanupError) throw error;
      logger.error('[fetchFromAppServer] Failed:', error);
      return null;
    }
  }

  /**
   * Extract plan type from auth file JWT token
   * Returns the actual plan type or 'unknown' if not available
   */
  private async getPlanTypeFromAuthFile(): Promise<CodexPlanType> {
    try {
      const { authFilePath } = await this.runtime.snapshot();
      const authContent = await this.runtime.readAuth(authFilePath);
      const authData = JSON.parse(authContent);

      if (!authData.tokens?.id_token) {
        logger.info('[getPlanTypeFromAuthFile] No id_token in auth file');
        return 'unknown';
      }

      const claims = this.parseJwt(authData.tokens.id_token);
      if (!claims) {
        logger.info('[getPlanTypeFromAuthFile] Failed to parse JWT');
        return 'unknown';
      }

      // Extract plan type from nested OpenAI auth object with type validation
      const openaiAuthClaim = claims['https://api.openai.com/auth'];

      let accountType: string | undefined;
      let isSubscriptionExpired = false;

      if (
        openaiAuthClaim &&
        typeof openaiAuthClaim === 'object' &&
        !Array.isArray(openaiAuthClaim)
      ) {
        const openaiAuth = openaiAuthClaim as Record<string, unknown>;

        if (typeof openaiAuth.chatgpt_plan_type === 'string') {
          accountType = openaiAuth.chatgpt_plan_type;
        }

        // Check if subscription has expired
        if (typeof openaiAuth.chatgpt_subscription_active_until === 'string') {
          const expiryDate = new Date(openaiAuth.chatgpt_subscription_active_until);
          if (!isNaN(expiryDate.getTime())) {
            isSubscriptionExpired = expiryDate < new Date();
          }
        }
      } else {
        // Fallback: try top-level claim names
        const possibleClaimNames = [
          'https://chatgpt.com/account_type',
          'account_type',
          'plan',
          'plan_type',
        ];

        for (const claimName of possibleClaimNames) {
          const claimValue = claims[claimName];
          if (claimValue && typeof claimValue === 'string') {
            accountType = claimValue;
            break;
          }
        }
      }

      // If subscription is expired, treat as free plan
      if (isSubscriptionExpired && accountType && accountType !== 'free') {
        accountType = 'free';
      }

      if (accountType) {
        const normalizedType = accountType.toLowerCase() as CodexPlanType;
        if (this.accountPlanTypeArray.includes(normalizedType)) {
          logger.info(`[getPlanTypeFromAuthFile] Returning plan type: ${normalizedType}`);
          return normalizedType;
        }
      } else {
        logger.info('[getPlanTypeFromAuthFile] No account type found in claims');
      }
    } catch {
      logger.warn('[getPlanTypeFromAuthFile] Local plan metadata unavailable.');
    }

    logger.info('[getPlanTypeFromAuthFile] Returning unknown');
    return 'unknown';
  }

  /**
   * Try to extract usage info from the Codex auth file
   * Reuses getPlanTypeFromAuthFile to avoid code duplication
   */
  private async fetchFromAuthFile(): Promise<CodexUsageData | null> {
    logger.info('[fetchFromAuthFile] Starting...');
    try {
      const planType = await this.getPlanTypeFromAuthFile();
      logger.info(`[fetchFromAuthFile] Got plan type: ${planType}`);

      if (planType === 'unknown') {
        logger.info('[fetchFromAuthFile] Plan type unknown, returning null');
        return null;
      }

      const result: CodexUsageData = {
        rateLimits: {
          planType,
        },
        lastUpdated: new Date().toISOString(),
      };

      logger.info('[fetchFromAuthFile] Returning result:', JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      logger.error('[fetchFromAuthFile] Failed to parse auth file:', error);
    }

    return null;
  }

  /**
   * Parse JWT token to extract claims
   */
  private parseJwt(token: string): Record<string, unknown> | null {
    try {
      const parts = token.split('.');

      if (parts.length !== 3) {
        return null;
      }

      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');

      // Use Buffer for Node.js environment
      const jsonPayload = Buffer.from(base64, 'base64').toString('utf-8');

      return JSON.parse(jsonPayload);
    } catch {
      return null;
    }
  }
}
