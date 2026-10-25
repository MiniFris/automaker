export function malformedWorktreeResponse(value: unknown): Record<string, unknown> {
  const copy = structuredClone(value) as Record<string, unknown>;
  const target =
    copy.result && typeof copy.result === 'object'
      ? (copy.result as Record<string, unknown>)
      : copy;
  const field = Object.keys(target).find(
    (key) => key !== 'success' && key !== 'executionEnvironment'
  );
  if (field) {
    const before = target[field];
    target[field] =
      typeof before === 'string'
        ? 17
        : typeof before === 'boolean'
          ? 'bad'
          : before === null
            ? {}
            : Array.isArray(before)
              ? {}
              : null;
  } else (copy.executionEnvironment as Record<string, unknown>).path = 17;
  copy.privateMarker = 'private-malformed-response-fixture';
  return copy;
}
