import { translate, useUiLocale } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { CursorSetupPanel } from '@/components/shared/cursor-setup-panel';

interface CursorSetupStepProps {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function CursorSetupStep({ onNext, onBack, onSkip }: CursorSetupStepProps) {
  useUiLocale();
  return (
    <div className="space-y-6">
      <CursorSetupPanel />
      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          {translate('Back')}
        </Button>
        <Button variant="ghost" onClick={onSkip}>
          {translate('Skip for now')}
        </Button>
        <Button onClick={onNext} data-testid="cursor-next-button">
          {translate('Continue')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {translate('You can always configure Cursor later in Settings')}
      </p>
    </div>
  );
}
