import { useId } from 'react';
import { setUiLocale, translate, UI_LANGUAGES, useUiLocale } from '@/lib/i18n';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const locale = useUiLocale();
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <div className={compact ? 'flex items-center gap-2' : 'space-y-2'}>
      <Label htmlFor={id}>{translate('Interface language')}</Label>
      <Select
        value={locale}
        onValueChange={(value) => {
          if (value === 'en' || value === 'ru') setUiLocale(value);
        }}
      >
        <SelectTrigger
          id={id}
          className={compact ? 'w-36 shrink-0' : 'w-full sm:w-60'}
          aria-describedby={compact ? undefined : descriptionId}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UI_LANGUAGES.map(({ value, label }) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!compact && (
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {translate(
            'Choose the interface language. New tasks, agent progress messages, and final reports use this language. Existing content stays unchanged.'
          )}
        </p>
      )}
    </div>
  );
}
