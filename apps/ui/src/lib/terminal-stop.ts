/** A failed/ambiguous stop must not discard the only recoverable session identity. */
export async function stopTerminalSession(
  sessionId: string,
  ports: {
    request: (sessionId: string) => Promise<Response>;
    remove: (sessionId: string) => void;
    failed: () => void;
  }
): Promise<boolean> {
  let confirmed = false;
  try {
    const response = await ports.request(sessionId);
    confirmed =
      response.status === 404 || (response.ok && (await response.json()).success === true);
  } catch {
    // A disconnected client has no evidence that the owned shell was stopped.
  }
  if (!confirmed) {
    ports.failed();
    return false;
  }
  ports.remove(sessionId);
  return true;
}

export async function stopTerminalTab(
  sessionIds: string[],
  stop: (sessionId: string) => Promise<boolean>,
  removeTab: () => void
): Promise<void> {
  const stopped = await Promise.all(sessionIds.map(stop));
  if (stopped.every(Boolean)) removeTab();
}

/** Only a confirmed missing identity may disappear during saved-layout restore. */
export async function inspectTerminalSession(
  inspect: () => Promise<Response>
): Promise<'active' | 'missing' | 'unknown'> {
  try {
    const response = await inspect();
    if (response.status === 404) return 'missing';
    if (response.ok && (await response.json()).success === true) return 'active';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
