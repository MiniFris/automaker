import { translate } from '@/lib/i18n';

/** Localize built-in task categories, never arbitrary project/user-defined names or stored IDs. */
export function getFeatureCategoryLabel(category: string): string {
  switch (category) {
    case 'feature':
      return translate('New feature');
    case 'bug':
    case 'bug-fix':
      return translate('Bug fix');
    case 'enhancement':
      return translate('Enhancement');
    case 'refactor':
      return translate('Refactoring');
    default:
      return category;
  }
}
