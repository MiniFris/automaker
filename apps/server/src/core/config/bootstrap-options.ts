/** Reject the removed JavaScript bootstrap seam before constructing resource owners. */
export function assertNoLegacyServiceOverrides(options: object): void {
  if ('services' in options) {
    throw new Error(
      'Legacy service overrides are not supported. Configure native services through their owning modules.'
    );
  }
}
