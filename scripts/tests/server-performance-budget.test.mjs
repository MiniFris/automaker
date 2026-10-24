import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkServerPerformance,
  extraResources,
  SERVER_PERFORMANCE_LIMITS,
} from '../server-performance-budget.mjs';

function measurement() {
  return {
    importDurationMs: 1,
    compositionDurationMs: 1,
    startupDurationMs: 1,
    healthLatencyMs: { p95: 1 },
    memoryBytes: { rss: 1024 },
    shutdownDurationMs: 1,
    samples: 100,
    unexpectedResourcesAfterShutdown: [],
  };
}
test('accepts a complete measurement inside the fixed idle API limits', () => {
  assert.deepEqual(checkServerPerformance(measurement()), { passed: true, violations: [] });
});
for (const [metric, maximum] of Object.entries(SERVER_PERFORMANCE_LIMITS)) {
  test(`rejects a regression in ${metric}`, () => {
    const result = measurement();
    const parts = metric.split('.'),
      last = parts.pop();
    const container = parts.reduce((value, part) => value[part], result);
    container[last] = maximum + 1;
    const check = checkServerPerformance(result);
    assert.equal(check.passed, false);
    assert.deepEqual(check.violations, [{ metric, actual: maximum + 1, maximum }]);
  });
}
test('does not allow missing, negative or nonfinite measurements to pass', () => {
  for (const value of [undefined, -1, NaN, Infinity]) {
    assert.equal(
      checkServerPerformance({ ...measurement(), importDurationMs: value }).passed,
      false
    );
  }
});
test('requires enough requests and no unexpected resources', () => {
  assert.equal(checkServerPerformance({ ...measurement(), samples: 99 }).passed, false);
  assert.equal(
    checkServerPerformance({ ...measurement(), unexpectedResourcesAfterShutdown: ['Timeout'] })
      .passed,
    false
  );
  assert.equal(
    checkServerPerformance({ ...measurement(), unexpectedResourcesAfterShutdown: undefined })
      .passed,
    false
  );
});
test('subtracts baseline resource multiplicity without hiding additional child pipes', () => {
  assert.deepEqual(extraResources(['PipeWrap', 'PipeWrap'], ['PipeWrap', 'PipeWrap']), []);
  assert.deepEqual(
    extraResources(['PipeWrap', 'PipeWrap'], ['PipeWrap', 'Timeout', 'PipeWrap', 'PipeWrap']),
    ['PipeWrap', 'Timeout']
  );
});
