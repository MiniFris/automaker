import { translate, useUiLocale } from '@/lib/i18n';
import { Tag } from 'lucide-react';
import { Autocomplete } from '@/components/ui/autocomplete';

interface CategoryAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  error?: boolean;
  'data-testid'?: string;
}

export function CategoryAutocomplete({
  value,
  onChange,
  suggestions,
  placeholder = translate('Select or type a category...'),
  className,
  disabled = false,
  error = false,
  'data-testid': testId,
}: CategoryAutocompleteProps) {
  useUiLocale();
  return (
    <Autocomplete
      value={value}
      onChange={onChange}
      options={suggestions}
      placeholder={placeholder}
      searchPlaceholder={translate('Search or type new category...')}
      emptyMessage={translate('No category found.')}
      className={className}
      disabled={disabled}
      error={error}
      icon={Tag}
      allowCreate
      createLabel={(v) => `Create "${v}"`}
      data-testid={testId}
      itemTestIdPrefix="category-option"
    />
  );
}
