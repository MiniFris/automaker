import { formatCount } from '@/lib/i18n';
import { translate, useUiLocale } from '@/lib/i18n';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Pencil, X, CheckSquare, Trash2, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type SelectionActionMode = 'backlog' | 'waiting_approval';

interface SelectionActionBarProps {
  selectedCount: number;
  totalCount: number;
  onEdit?: () => void;
  onDelete?: () => void;
  onVerify?: () => Promise<void> | void;
  onClear: () => void;
  onSelectAll: () => void;
  mode?: SelectionActionMode;
}

export function SelectionActionBar({
  selectedCount,
  totalCount,
  onEdit,
  onDelete,
  onVerify,
  onClear,
  onSelectAll,
  mode = 'backlog',
}: SelectionActionBarProps) {
  useUiLocale();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showVerifyDialog, setShowVerifyDialog] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const allSelected = selectedCount === totalCount && totalCount > 0;

  const handleDeleteClick = () => {
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = () => {
    setShowDeleteDialog(false);
    onDelete?.();
  };

  const handleVerifyClick = () => {
    if (!onVerify) return;
    setShowVerifyDialog(true);
  };

  const handleConfirmVerify = async () => {
    if (!onVerify) {
      setShowVerifyDialog(false);
      return;
    }
    setIsVerifying(true);
    try {
      await onVerify();
    } finally {
      setIsVerifying(false);
      setShowVerifyDialog(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          'fixed bottom-6 left-1/2 -translate-x-1/2 z-50',
          'flex items-center gap-3 px-4 py-3 rounded-xl',
          'bg-background/95 backdrop-blur-sm border border-border shadow-lg',
          'animate-in slide-in-from-bottom-4 fade-in duration-200'
        )}
        data-testid="selection-action-bar"
      >
        <span className="text-sm font-medium text-foreground">
          {selectedCount === 0
            ? mode === 'waiting_approval'
              ? translate('Select features to verify')
              : translate('Select features to edit')
            : translate('{value1} selected', { value1: formatCount(selectedCount, 'feature') })}
        </span>

        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-2">
          {mode === 'backlog' && (
            <>
              <Button
                variant="default"
                size="sm"
                onClick={onEdit}
                disabled={selectedCount === 0}
                className="h-8 bg-brand-500 hover:bg-brand-600 disabled:opacity-50"
                data-testid="selection-edit-button"
              >
                <Pencil className="w-4 h-4 mr-1.5" />
                {translate('Edit Selected')}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleDeleteClick}
                disabled={selectedCount === 0}
                className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
                data-testid="selection-delete-button"
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                {translate('Delete')}
              </Button>
            </>
          )}

          {mode === 'waiting_approval' && (
            <Button
              variant="default"
              size="sm"
              onClick={handleVerifyClick}
              disabled={selectedCount === 0 || !onVerify}
              className="h-8 bg-green-600 hover:bg-green-700 disabled:opacity-50"
              data-testid="selection-verify-button"
            >
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              {translate('Verify Selected')}
            </Button>
          )}

          {!allSelected && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSelectAll}
              className="h-8"
              data-testid="selection-select-all-button"
            >
              <CheckSquare className="w-4 h-4 mr-1.5" />
              {translate('Select All (')}
              {totalCount})
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-8 text-muted-foreground hover:text-foreground"
            data-testid="selection-clear-button"
          >
            <X className="w-4 h-4 mr-1.5" />
            {translate('Clear')}
          </Button>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent data-testid="bulk-delete-confirmation-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              {translate('Delete Selected Features?')}
            </DialogTitle>
            <DialogDescription>
              {translate('Are you sure you want to permanently delete ')}
              {formatCount(selectedCount, 'feature')}?
              <span className="block mt-2 text-destructive font-medium">
                {translate('This action cannot be undone.')}
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowDeleteDialog(false)}
              data-testid="cancel-bulk-delete-button"
            >
              {translate('Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              data-testid="confirm-bulk-delete-button"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {translate('Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Verify Confirmation Dialog */}
      <Dialog
        open={showVerifyDialog}
        onOpenChange={(open) => {
          if (!isVerifying) setShowVerifyDialog(open);
        }}
      >
        <DialogContent data-testid="bulk-verify-confirmation-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="w-5 h-5" />
              {translate('Verify Selected Features?')}
            </DialogTitle>
            <DialogDescription>
              {translate('Are you sure you want to mark ')}
              {formatCount(selectedCount, 'feature')} {translate(' as verified?')}
              <span className="block mt-2 text-muted-foreground">
                {translate('This will move them to the Verified column.')}
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowVerifyDialog(false)}
              disabled={isVerifying}
              data-testid="cancel-bulk-verify-button"
            >
              {translate('Cancel')}
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={handleConfirmVerify}
              disabled={isVerifying || !onVerify}
              data-testid="confirm-bulk-verify-button"
            >
              {isVerifying ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              )}
              {isVerifying ? translate('Verifying...') : translate('Verify')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
