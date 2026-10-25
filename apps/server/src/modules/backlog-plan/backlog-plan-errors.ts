import { createLogger } from '@automaker/utils';
export const logger = createLogger('BacklogPlan');
export function mapBacklogPlanError(rawMessage: string): string {
  // Claude Code spawn failures
  if (
    rawMessage.includes('Failed to spawn Claude Code process') ||
    rawMessage.includes('spawn node ENOENT') ||
    rawMessage.includes('Claude Code executable not found') ||
    rawMessage.includes('Claude Code native binary not found')
  ) {
    return 'Claude CLI could not be launched. Make sure the Claude CLI is installed and available in PATH, or check that Node.js is correctly installed. Try running "which claude" or "claude --version" in your terminal to verify.';
  }

  // Claude Code process crash - extract exit code for diagnostics
  if (rawMessage.includes('Claude Code process exited')) {
    const exitCodeMatch = rawMessage.match(/exited with code (\d+)/);
    const exitCode = exitCodeMatch ? exitCodeMatch[1] : 'unknown';
    logger.error(`[BacklogPlan] Claude process exit code: ${exitCode}`);
    return `Claude exited unexpectedly (exit code: ${exitCode}). This is usually a transient issue. Try again. If it keeps happening, re-run \`claude login\` or update your API key in Setup.`;
  }

  // Claude Code process killed by signal
  if (rawMessage.includes('Claude Code process terminated by signal')) {
    const signalMatch = rawMessage.match(/terminated by signal (\w+)/);
    const signal = signalMatch ? signalMatch[1] : 'unknown';
    logger.error(`[BacklogPlan] Claude process terminated by signal: ${signal}`);
    return `Claude was terminated by signal ${signal}. This may indicate a resource issue. Try again.`;
  }

  // Rate limiting
  if (rawMessage.toLowerCase().includes('rate limit') || rawMessage.includes('429')) {
    return 'Rate limited. Please wait a moment and try again.';
  }

  // Network errors
  if (
    rawMessage.toLowerCase().includes('network') ||
    rawMessage.toLowerCase().includes('econnrefused') ||
    rawMessage.toLowerCase().includes('timeout')
  ) {
    return 'Network error. Check your internet connection and try again.';
  }

  // Authentication errors
  if (
    rawMessage.toLowerCase().includes('not authenticated') ||
    rawMessage.toLowerCase().includes('unauthorized') ||
    rawMessage.includes('401')
  ) {
    return 'Authentication failed. Please check your API key or run `claude login` to authenticate.';
  }

  // Return original message for unknown errors
  return rawMessage;
}

export function getErrorMessage(error: unknown): string {
  let rawMessage: string;
  if (error instanceof Error) {
    rawMessage = error.message;
  } else {
    rawMessage = String(error);
  }
  return mapBacklogPlanError(rawMessage);
}
