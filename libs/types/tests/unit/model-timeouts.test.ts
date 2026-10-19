import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_TIMEOUTS,
  DIRECT_TIMEOUT_KEYS,
  MAX_MODEL_TIMEOUT_MS,
  modelTimeout,
  parseModelTimeoutSettings,
  providerModelTimeouts,
  parseProviderModelTimeoutSettings,
} from '../../src/model-timeouts.js';

describe('model timeout configuration', () => {
  it('keeps providers independent while preserving legacy values until explicitly saved', () => {
    const settings = {
      modelTimeouts: { requestTimeoutMs: 111, cliIdleTimeoutMs: 222 },
      providerModelTimeouts: { claude: { requestTimeoutMs: 333 }, cursor: {} },
    };
    expect(providerModelTimeouts(settings, 'claude')).toEqual({ requestTimeoutMs: 333 });
    expect(providerModelTimeouts(settings, 'cursor')).toEqual({});
    expect(providerModelTimeouts(settings, 'codex')).toEqual({ cliIdleTimeoutMs: 222 });
    expect(providerModelTimeouts(settings, 'openai-compatible')).toEqual({ requestTimeoutMs: 111 });
  });
  it('rejects unknown providers and fields that do not apply to that provider', () => {
    expect(() => parseProviderModelTimeoutSettings({ custom: {} })).toThrow();
    expect(() =>
      parseProviderModelTimeoutSettings({ cursor: { requestTimeoutMs: 100 } })
    ).toThrow();
    expect(() => parseProviderModelTimeoutSettings({ claude: { agentTimeoutMs: 100 } })).toThrow();
    expect(
      parseProviderModelTimeoutSettings({
        claude: { requestTimeoutMs: 100 },
        codex: { codexExtendedIdleTimeoutMs: 200 },
      })
    ).toEqual({ claude: { requestTimeoutMs: 100 }, codex: { codexExtendedIdleTimeoutMs: 200 } });
  });
  it('keeps inheritance explicit and returns detached numeric values', () => {
    expect(parseModelTimeoutSettings({})).toEqual({});
    expect(modelTimeout(undefined, 'requestTimeoutMs')).toBe(120_000);
    const input = { toolTimeoutMs: 900_000 };
    const parsed = parseModelTimeoutSettings(input);
    input.toolTimeoutMs = 10;
    expect(parsed).toEqual({ toolTimeoutMs: 900_000 });
  });
  it('supports every exposed field through the safe Node timer boundary', () => {
    for (const key of Object.keys(DEFAULT_MODEL_TIMEOUTS)) {
      expect(parseModelTimeoutSettings({ [key]: MAX_MODEL_TIMEOUT_MS })).toEqual({
        [key]: MAX_MODEL_TIMEOUT_MS,
      });
    }
  });
  it.each([0, -1, 0.5, MAX_MODEL_TIMEOUT_MS + 1, NaN, Infinity, '60000', null, true])(
    'rejects invalid milliseconds %s without echoing their values',
    (value) => {
      expect(() => parseModelTimeoutSettings({ requestTimeoutMs: value })).toThrow(
        'Invalid model timeout'
      );
    }
  );
  it.each([
    null,
    undefined,
    [],
    'secret-value',
    { secretValue: 123 },
    JSON.parse('{"__proto__":{}}'),
  ])('rejects non-objects and unknown settings', (value) => {
    expect(() => parseModelTimeoutSettings(value)).toThrow();
  });
  it('only allows Direct-specific endpoint overrides, not unused CLI settings', () => {
    expect(parseModelTimeoutSettings({ agentTimeoutMs: 1_800_000 }, DIRECT_TIMEOUT_KEYS)).toEqual({
      agentTimeoutMs: 1_800_000,
    });
    expect(() =>
      parseModelTimeoutSettings({ remoteProcessTimeoutMs: 1_800_000 }, DIRECT_TIMEOUT_KEYS)
    ).toThrow('Unknown model timeout');
  });
});
