import { translate, useUiLocale } from '@/lib/i18n';
import { Eye, Edit3, Code } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { SpecViewMode } from '../types';

interface SpecModeTabsProps {
  mode: SpecViewMode;
  onModeChange: (mode: SpecViewMode) => void;
  isParseValid: boolean;
  disabled?: boolean;
}

export function SpecModeTabs({
  mode,
  onModeChange,
  isParseValid,
  disabled = false,
}: SpecModeTabsProps) {
  useUiLocale();
  const handleValueChange = (value: string) => {
    onModeChange(value as SpecViewMode);
  };

  return (
    <Tabs value={mode} onValueChange={handleValueChange}>
      <TabsList>
        <TabsTrigger
          value="view"
          disabled={disabled || !isParseValid}
          title={
            !isParseValid
              ? translate('Fix XML errors to enable View mode')
              : translate('View formatted spec')
          }
          aria-label={translate('View')}
        >
          <Eye className="w-4 h-4" />
          <span className="hidden sm:inline">{translate('View')}</span>
        </TabsTrigger>
        <TabsTrigger
          value="edit"
          disabled={disabled || !isParseValid}
          title={
            !isParseValid
              ? translate('Fix XML errors to enable Edit mode')
              : translate('Edit spec with form')
          }
          aria-label={translate('Edit')}
        >
          <Edit3 className="w-4 h-4" />
          <span className="hidden sm:inline">{translate('Edit')}</span>
        </TabsTrigger>
        <TabsTrigger
          value="source"
          disabled={disabled}
          title={translate('Edit raw XML source')}
          aria-label={translate('Source')}
        >
          <Code className="w-4 h-4" />
          <span className="hidden sm:inline">{translate('Source')}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
