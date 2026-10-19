import { translate, useUiLocale } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface DeleteServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function DeleteServerDialog({ open, onOpenChange, onConfirm }: DeleteServerDialogProps) {
  useUiLocale();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="mcp-server-delete-dialog">
        <DialogHeader>
          <DialogTitle>{translate('Delete MCP Server')}</DialogTitle>
          <DialogDescription>
            {translate(
              'Are you sure you want to delete this MCP server? This action cannot be undone.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {translate('Cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            data-testid="mcp-server-confirm-delete-button"
          >
            {translate('Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
