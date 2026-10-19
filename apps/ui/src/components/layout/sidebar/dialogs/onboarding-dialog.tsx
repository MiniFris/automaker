import { translate, useUiLocale } from '@/lib/i18n';
import { useRef } from 'react';
import { Rocket, CheckCircle2, Zap, FileText, Sparkles, ArrowRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface OnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newProjectName: string;
  onSkip: () => void;
  onGenerateSpec: () => void;
}

export function OnboardingDialog({
  open,
  onOpenChange,
  newProjectName,
  onSkip,
  onGenerateSpec,
}: OnboardingDialogProps) {
  useUiLocale();
  // Track if we're closing because user clicked "Generate App Spec"
  // to avoid incorrectly calling onSkip
  const isGeneratingRef = useRef(false);

  const handleGenerateSpec = () => {
    isGeneratingRef.current = true;
    onGenerateSpec();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !isGeneratingRef.current) {
          // Only call onSkip when user dismisses dialog (escape, click outside, or skip button)
          // NOT when they click "Generate App Spec"
          onSkip();
        }
        isGeneratingRef.current = false;
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="max-w-2xl bg-popover/95 backdrop-blur-xl">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-brand-500/10 border border-brand-500/20 shrink-0">
              <Rocket className="w-6 h-6 text-brand-500" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-2xl truncate">
                {translate('Welcome to ')}
                {newProjectName}!
              </DialogTitle>
              <DialogDescription className="text-muted-foreground mt-1">
                {translate("Your new project is ready. Let's get you started.")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-6">
          {/* Main explanation */}
          <div className="space-y-3">
            <p className="text-sm text-foreground leading-relaxed">
              {translate('Would you like to auto-generate your ')}
              <strong>app_spec.txt</strong>
              {translate(
                '? This file helps describe your project and is used to pre-populate your backlog with features to work on.'
              )}
            </p>
          </div>

          {/* Benefits list */}
          <div className="space-y-3 rounded-xl bg-muted/30 border border-border/50 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-brand-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {translate('Pre-populate your backlog')}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {translate('Automatically generate features based on your project specification')}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Zap className="w-5 h-5 text-brand-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {translate('Better AI assistance')}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {translate('Help AI agents understand your project structure and tech stack')}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <FileText className="w-5 h-5 text-brand-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {translate('Project documentation')}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {translate("Keep a clear record of your project's capabilities and features")}
                </p>
              </div>
            </div>
          </div>

          {/* Info box */}
          <div className="rounded-xl bg-brand-500/5 border border-brand-500/10 p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">{translate('Tip:')}</strong>{' '}
              {translate(
                ' You can always generate or edit your app_spec.txt later from the Spec Editor in the sidebar.'
              )}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={onSkip}
            className="text-muted-foreground hover:text-foreground"
          >
            {translate('Skip for now')}
          </Button>
          <Button
            onClick={handleGenerateSpec}
            className="bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-600 text-white border-0"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {translate('Generate App Spec')}
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
