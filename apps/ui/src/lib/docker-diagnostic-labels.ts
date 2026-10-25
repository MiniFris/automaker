import type { DockerConnectionStatus } from '@automaker/types';
import { translate } from '@/lib/i18n';

/** Protocol status IDs stay unchanged; only their UI labels are localized. */
export function getDockerConnectionStatusLabel(status: DockerConnectionStatus): string {
  switch (status) {
    case 'available':
      return translate('Docker Engine is reachable');
    case 'client-missing':
      return translate('Docker CLI is missing');
    case 'permission-denied':
      return translate('Docker access denied');
    case 'unreachable':
      return translate('Docker Engine is unreachable');
    case 'context-unavailable':
      return translate('Docker context is unavailable');
    case 'timeout':
      return translate('Docker connection timed out');
    case 'cancelled':
      return translate('Docker connection check cancelled');
    case 'invalid-response':
      return translate('Invalid Docker response');
    case 'unavailable':
      return translate('Docker connection is unavailable');
    default:
      return status;
  }
}
