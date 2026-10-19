'use client';
import { translate, useUiLocale } from '@/lib/i18n';

import { Label } from '@/components/ui/label';
import { BranchAutocomplete } from '@/components/ui/branch-autocomplete';
import { GitBranch, GitFork, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

export type WorkMode = 'current' | 'auto' | 'custom';

interface WorkModeSelectorProps {
  workMode: WorkMode;
  onWorkModeChange: (mode: WorkMode) => void;
  branchName: string;
  onBranchNameChange: (branchName: string) => void;
  branchSuggestions: string[];
  branchCardCounts?: Record<string, number>;
  currentBranch?: string;
  disabled?: boolean;
  testIdPrefix?: string;
}

const WORK_MODES = [
  {
    value: 'current' as const,
    get label() {
      return translate('Current Branch');
    },
    get description() {
      return translate('Work directly on the selected branch');
    },
    icon: GitBranch,
  },
  {
    value: 'auto' as const,
    get label() {
      return translate('Auto Worktree');
    },
    get description() {
      return translate('Create isolated worktree automatically');
    },
    icon: GitFork,
  },
  {
    value: 'custom' as const,
    get label() {
      return translate('Custom Branch');
    },
    get description() {
      return translate('Specify a branch name');
    },
    icon: Pencil,
  },
];

export function WorkModeSelector({
  workMode,
  onWorkModeChange,
  branchName,
  onBranchNameChange,
  branchSuggestions,
  branchCardCounts,
  currentBranch,
  disabled = false,
  testIdPrefix = 'work-mode',
}: WorkModeSelectorProps) {
  useUiLocale();
  const hasError = workMode === 'custom' && !branchName.trim();

  return (
    <div className="space-y-3">
      <Label id={`${testIdPrefix}-label`}>{translate('Work Mode')}</Label>

      <div className="grid grid-cols-3 gap-2">
        {WORK_MODES.map((mode) => {
          const isSelected = workMode === mode.value;
          const Icon = mode.icon;
          return (
            <button
              key={mode.value}
              type="button"
              onClick={() => !disabled && onWorkModeChange(mode.value)}
              disabled={disabled}
              data-testid={`${testIdPrefix}-${mode.value}`}
              className={cn(
                'flex flex-col items-center gap-1.5 p-3 rounded-lg cursor-pointer transition-all duration-200',
                'border-2 hover:border-primary/50',
                isSelected
                  ? 'border-primary bg-primary/10'
                  : 'border-border/50 bg-card/50 hover:bg-accent/30',
                disabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center transition-colors',
                  isSelected ? 'bg-primary/20' : 'bg-muted'
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4 transition-colors',
                    isSelected ? 'text-primary' : 'text-muted-foreground'
                  )}
                />
              </div>
              <span
                className={cn(
                  'font-medium text-xs text-center',
                  isSelected ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {mode.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Description text based on selected mode */}
      <p className="text-xs text-muted-foreground">
        {workMode === 'current' && (
          <>
            {translate('Work will be done directly on')}{' '}
            {currentBranch ? (
              <span className="font-medium">{currentBranch}</span>
            ) : (
              translate('the current branch')
            )}
            {translate('. No isolation.')}
          </>
        )}
        {workMode === 'auto' && (
          <>
            {translate('A new worktree will be created automatically based on')}{' '}
            {currentBranch ? (
              <span className="font-medium">{currentBranch}</span>
            ) : (
              translate('the current branch')
            )}{' '}
            {translate('when this card is created.')}
          </>
        )}
        {workMode === 'custom' && (
          <>
            {translate(
              "Specify a branch name below. A worktree will be created if it doesn't exist."
            )}
          </>
        )}
      </p>

      {/* Branch input for custom mode */}
      {workMode === 'custom' && (
        <div className="space-y-1">
          <BranchAutocomplete
            value={branchName}
            onChange={onBranchNameChange}
            branches={branchSuggestions}
            branchCardCounts={branchCardCounts}
            placeholder={translate('Select or create branch...')}
            data-testid={`${testIdPrefix}-branch-input`}
            disabled={disabled}
            error={hasError}
          />
          {hasError && (
            <p className="text-xs text-destructive">
              {translate('Branch name is required for custom branch mode.')}
            </p>
          )}
        </div>
      )}

      {disabled && (
        <p className="text-xs text-muted-foreground italic">
          {translate('Work mode cannot be changed after work has started.')}
        </p>
      )}
    </div>
  );
}
