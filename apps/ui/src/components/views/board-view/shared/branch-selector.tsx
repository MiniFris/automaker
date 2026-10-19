'use client';
import { translate, useUiLocale } from '@/lib/i18n';

import { Label } from '@/components/ui/label';
import { BranchAutocomplete } from '@/components/ui/branch-autocomplete';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface BranchSelectorProps {
  useCurrentBranch: boolean;
  onUseCurrentBranchChange: (useCurrent: boolean) => void;
  branchName: string;
  onBranchNameChange: (branchName: string) => void;
  branchSuggestions: string[];
  branchCardCounts?: Record<string, number>; // Map of branch name to unarchived card count
  currentBranch?: string;
  disabled?: boolean;
  testIdPrefix?: string;
}

export function BranchSelector({
  useCurrentBranch,
  onUseCurrentBranchChange,
  branchName,
  onBranchNameChange,
  branchSuggestions,
  branchCardCounts,
  currentBranch,
  disabled = false,
  testIdPrefix = 'branch',
}: BranchSelectorProps) {
  useUiLocale();
  // Validate: if "other branch" is selected, branch name is required
  const isBranchRequired = !useCurrentBranch;
  const hasError = isBranchRequired && !branchName.trim();

  return (
    <div className="space-y-2">
      <Label id={`${testIdPrefix}-label`}>{translate('Target Branch')}</Label>
      <RadioGroup
        value={useCurrentBranch ? 'current' : 'other'}
        onValueChange={(value: string) => onUseCurrentBranchChange(value === 'current')}
        disabled={disabled}
        data-testid={`${testIdPrefix}-radio-group`}
        aria-labelledby={`${testIdPrefix}-label`}
      >
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="current" id={`${testIdPrefix}-current`} />
          <Label htmlFor={`${testIdPrefix}-current`} className="font-normal cursor-pointer">
            {translate('Use current selected branch')}
            {currentBranch && <span className="text-muted-foreground ml-1">({currentBranch})</span>}
          </Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="other" id={`${testIdPrefix}-other`} />
          <Label htmlFor={`${testIdPrefix}-other`} className="font-normal cursor-pointer">
            {translate('Other branch')}
          </Label>
        </div>
      </RadioGroup>
      {!useCurrentBranch && (
        <div className="ml-6 space-y-1">
          <BranchAutocomplete
            value={branchName}
            onChange={onBranchNameChange}
            branches={branchSuggestions}
            branchCardCounts={branchCardCounts}
            placeholder={translate('Select or create branch...')}
            data-testid={`${testIdPrefix}-input`}
            disabled={disabled}
            error={hasError}
          />
          {hasError && (
            <p className="text-xs text-destructive">
              {translate('Branch name is required when "Other branch" is selected.')}
            </p>
          )}
        </div>
      )}
      {disabled ? (
        <p className="text-xs text-muted-foreground">
          {translate('Branch cannot be changed after work has started.')}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {useCurrentBranch
            ? translate(
                'Work will be done in the currently selected branch. A worktree will be created if needed.'
              )
            : translate('Work will be done in this branch. A worktree will be created if needed.')}
        </p>
      )}
    </div>
  );
}
