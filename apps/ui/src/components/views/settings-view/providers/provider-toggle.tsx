import { translate, useUiLocale } from '@/lib/i18n';
import { useAppStore } from '@/store/app-store';
import type { ModelProvider } from '@automaker/types';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { EyeOff, Eye } from 'lucide-react';

interface ProviderToggleProps {
  provider: ModelProvider;
  providerLabel: string;
}

export function ProviderToggle({ provider, providerLabel }: ProviderToggleProps) {
  useUiLocale();
  const { disabledProviders, toggleProviderDisabled } = useAppStore();
  const isDisabled = disabledProviders.includes(provider);

  return (
    <div className="flex items-center justify-between p-4 rounded-xl bg-accent/20 border border-border/30">
      <div className="flex items-center gap-3">
        {isDisabled ? (
          <EyeOff className="w-4 h-4 text-muted-foreground" />
        ) : (
          <Eye className="w-4 h-4 text-primary" />
        )}
        <div>
          <Label className="text-sm font-medium">
            {translate('Show ')}
            {providerLabel} {translate(' in model dropdowns')}
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isDisabled
              ? translate('{value1} models are hidden from all model selectors', {
                  value1: providerLabel,
                })
              : translate('{value1} models appear in model selection dropdowns', {
                  value1: providerLabel,
                })}
          </p>
        </div>
      </div>
      <Switch
        checked={!isDisabled}
        onCheckedChange={(checked) => toggleProviderDisabled(provider, !checked)}
      />
    </div>
  );
}

export default ProviderToggle;
