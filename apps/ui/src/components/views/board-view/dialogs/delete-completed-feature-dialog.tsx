import { translate, useUiLocale } from '@/lib/i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { Feature } from '@/store/app-store';

interface DeleteCompletedFeatureDialogProps {
  feature: Feature | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteCompletedFeatureDialog({
  feature,
  onClose,
  onConfirm,
}: DeleteCompletedFeatureDialogProps) {
  useUiLocale();
  if (!feature) return null;

  return (
    <Dialog open={!!feature} onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="delete-completed-confirmation-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="w-5 h-5" />
            {translate('Delete Feature')}
          </DialogTitle>
          <DialogDescription>
            {translate('Are you sure you want to permanently delete this feature?')}
            <span className="block mt-2 font-medium text-foreground">
              {translate('"')}
              {feature.description?.slice(0, 100)}
              {(feature.description?.length ?? 0) > 100 ? '...' : ''}
              {translate('"')}
            </span>
            <span className="block mt-2 text-destructive font-medium">
              {translate('This action cannot be undone.')}
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="cancel-delete-completed-button">
            {translate('Cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            data-testid="confirm-delete-completed-button"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {translate('Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
