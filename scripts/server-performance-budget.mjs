/** Idle native composition/API budgets; not provider throughput or production load SLOs. */
export const SERVER_PERFORMANCE_LIMITS = Object.freeze({
  importDurationMs: 3000,
  compositionDurationMs: 1500,
  startupDurationMs: 1000,
  'healthLatencyMs.p95': 50,
  'memoryBytes.rss': 256 * 1024 * 1024,
  shutdownDurationMs: 1000,
});

export function checkServerPerformance(measurement, limits = SERVER_PERFORMANCE_LIMITS) {
  const violations = [];
  for (const [metric, limit] of Object.entries(limits)) {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0)
      throw new TypeError(`Invalid performance limit: ${metric}.`);
    const actual = metric.split('.').reduce((value, key) => value?.[key], measurement);
    if (typeof actual !== 'number' || !Number.isFinite(actual) || actual < 0 || actual > limit)
      violations.push({ metric, actual: actual ?? null, maximum: limit });
  }
  if (!Number.isInteger(measurement.samples) || measurement.samples < 100)
    violations.push({ metric: 'samples', actual: measurement.samples ?? null, minimum: 100 });
  if (
    !Array.isArray(measurement.unexpectedResourcesAfterShutdown) ||
    measurement.unexpectedResourcesAfterShutdown.length
  )
    violations.push({
      metric: 'unexpectedResourcesAfterShutdown',
      actual: measurement.unexpectedResourcesAfterShutdown ?? null,
      expected: [],
    });
  return { passed: violations.length === 0, violations };
}

/** Subtract resources owned by the benchmark runner itself, retaining duplicate leaks. */
export function extraResources(before, after) {
  const baseline = new Map();
  for (const name of before) baseline.set(name, (baseline.get(name) ?? 0) + 1);
  return after
    .filter((name) => {
      const count = baseline.get(name) ?? 0;
      if (!count) return true;
      baseline.set(name, count - 1);
      return false;
    })
    .sort();
}
