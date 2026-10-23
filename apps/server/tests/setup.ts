/**
 * Vitest global setup file
 * Runs before each test file
 */

import { vi, beforeEach } from 'vitest';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = '/tmp/test-data';
process.env.AUTOMAKER_API_KEY = 'automaker-test-api-key';
process.env.ENABLE_REQUEST_LOGGING = 'false';

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});
