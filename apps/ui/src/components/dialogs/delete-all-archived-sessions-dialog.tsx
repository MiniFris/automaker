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

interface DeleteAllArchivedSessionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  archivedCount: number;
  onConfirm: () => void;
}

export function DeleteAllArchivedSessionsDialog({
  open,
  onOpenChange,
  archivedCount,
  onConfirm,
}: DeleteAllArchivedSessionsDialogProps) {
  useUiLocale();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="delete-all-archived-sessions-dialog">
        <DialogHeader>
          <DialogTitle>{translate('Delete All Archived Sessions')}</DialogTitle>
          <DialogDescription>
            {translate(
              'Are you sure you want to delete all archived sessions? This action cannot be undone.'
            )}
            {archivedCount > 0 && (
              <span className="block mt-2 text-yellow-500">
                {archivedCount} {translate(' session(s) will be deleted.')}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {translate('Cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            data-testid="confirm-delete-all-archived-sessions"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {translate('Delete All')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
