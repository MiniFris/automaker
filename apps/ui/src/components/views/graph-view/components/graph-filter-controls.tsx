import { translate, useUiLocale } from '@/lib/i18n';
import { Panel } from '@xyflow/react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Filter,
  X,
  Eye,
  EyeOff,
  ChevronDown,
  Play,
  Pause,
  Clock,
  CheckCircle2,
  CircleDot,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  GraphFilterState,
  STATUS_FILTER_OPTIONS,
  StatusFilterValue,
} from '../hooks/use-graph-filter';

// Status display configuration
const statusDisplayConfig: Record<
  StatusFilterValue,
  { label: string; icon: typeof Play; colorClass: string }
> = {
  running: {
    get label() {
      return translate('Running');
    },
    icon: Play,
    colorClass: 'text-[var(--status-in-progress)]',
  },
  paused: {
    get label() {
      return translate('Paused');
    },
    icon: Pause,
    colorClass: 'text-[var(--status-warning)]',
  },
  backlog: {
    get label() {
      return translate('Backlog');
    },
    icon: Clock,
    colorClass: 'text-muted-foreground',
  },
  waiting_approval: {
    get label() {
      return translate('Waiting Approval');
    },
    icon: CircleDot,
    colorClass: 'text-[var(--status-waiting)]',
  },
  verified: {
    get label() {
      return translate('Verified');
    },
    icon: CheckCircle2,
    colorClass: 'text-[var(--status-success)]',
  },
};

interface GraphFilterControlsProps {
  filterState: GraphFilterState;
  availableCategories: string[];
  hasActiveFilter: boolean;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onCategoriesChange: (categories: string[]) => void;
  onStatusesChange: (statuses: string[]) => void;
  onNegativeFilterChange: (isNegative: boolean) => void;
  onClearFilters: () => void;
}

export function GraphFilterControls({
  filterState,
  availableCategories,
  hasActiveFilter,
  searchQuery,
  onSearchQueryChange,
  onCategoriesChange,
  onStatusesChange,
  onNegativeFilterChange,
  onClearFilters,
}: GraphFilterControlsProps) {
  useUiLocale();
  const { selectedCategories, selectedStatuses, isNegativeFilter } = filterState;

  const handleCategoryToggle = (category: string) => {
    if (selectedCategories.includes(category)) {
      onCategoriesChange(selectedCategories.filter((c) => c !== category));
    } else {
      onCategoriesChange([...selectedCategories, category]);
    }
  };

  const handleSelectAllCategories = () => {
    if (selectedCategories.length === availableCategories.length) {
      onCategoriesChange([]);
    } else {
      onCategoriesChange([...availableCategories]);
    }
  };

  const handleStatusToggle = (status: string) => {
    if (selectedStatuses.includes(status)) {
      onStatusesChange(selectedStatuses.filter((s) => s !== status));
    } else {
      onStatusesChange([...selectedStatuses, status]);
    }
  };

  const handleSelectAllStatuses = () => {
    if (selectedStatuses.length === STATUS_FILTER_OPTIONS.length) {
      onStatusesChange([]);
    } else {
      onStatusesChange([...STATUS_FILTER_OPTIONS]);
    }
  };

  const categoryButtonLabel =
    selectedCategories.length === 0
      ? translate('All Categories')
      : selectedCategories.length === 1
        ? selectedCategories[0]
        : translate('Categories: {count}', { count: selectedCategories.length });

  const statusButtonLabel =
    selectedStatuses.length === 0
      ? translate('All Statuses')
      : selectedStatuses.length === 1
        ? statusDisplayConfig[selectedStatuses[0] as StatusFilterValue]?.label ||
          selectedStatuses[0]
        : translate('Statuses: {count}', { count: selectedStatuses.length });

  return (
    <Panel position="top-left" className="flex items-center gap-2">
      <div
        className="flex items-center gap-2 p-2 rounded-lg backdrop-blur-sm border border-border shadow-lg text-popover-foreground"
        style={{ backgroundColor: 'color-mix(in oklch, var(--popover) 90%, transparent)' }}
      >
        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder={translate('Search tasks...')}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="h-8 w-48 pl-8 pr-8 text-sm bg-background/50"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchQueryChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={translate('Clear search')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-border" />

        {/* Category Filter Dropdown */}
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-8 px-2 gap-1.5',
                    selectedCategories.length > 0 && 'bg-brand-500/20 text-brand-500'
                  )}
                >
                  <Filter className="w-4 h-4" />
                  <span className="text-xs max-w-[100px] truncate">{categoryButtonLabel}</span>
                  <ChevronDown className="w-3 h-3 opacity-50" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>{translate('Filter by Category')}</TooltipContent>
          </Tooltip>
          <PopoverContent
            align="start"
            className="w-56 p-2"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground px-2 py-1">
                {translate('Categories')}
              </div>

              {/* Select All option */}
              <div
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
                onClick={handleSelectAllCategories}
              >
                <Checkbox
                  checked={
                    selectedCategories.length === availableCategories.length &&
                    availableCategories.length > 0
                  }
                  onCheckedChange={handleSelectAllCategories}
                />
                <span className="text-sm font-medium">
                  {selectedCategories.length === availableCategories.length
                    ? translate('Deselect All')
                    : translate('Select All')}
                </span>
              </div>

              <div className="h-px bg-border" />

              {/* Category list */}
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {availableCategories.length === 0 ? (
                  <div className="text-xs text-muted-foreground px-2 py-2">
                    {translate('No categories available')}
                  </div>
                ) : (
                  availableCategories.map((category) => (
                    <div
                      key={category}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
                      onClick={() => handleCategoryToggle(category)}
                    >
                      <Checkbox
                        checked={selectedCategories.includes(category)}
                        onCheckedChange={() => handleCategoryToggle(category)}
                      />
                      <span className="text-sm truncate">{category}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Status Filter Dropdown */}
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-8 px-2 gap-1.5',
                    selectedStatuses.length > 0 && 'bg-brand-500/20 text-brand-500'
                  )}
                >
                  <CircleDot className="w-4 h-4" />
                  <span className="text-xs max-w-[120px] truncate">{statusButtonLabel}</span>
                  <ChevronDown className="w-3 h-3 opacity-50" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>{translate('Filter by Status')}</TooltipContent>
          </Tooltip>
          <PopoverContent
            align="start"
            className="w-56 p-2"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground px-2 py-1">
                {translate('Status')}
              </div>

              {/* Select All option */}
              <div
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
                onClick={handleSelectAllStatuses}
              >
                <Checkbox
                  checked={selectedStatuses.length === STATUS_FILTER_OPTIONS.length}
                  onCheckedChange={handleSelectAllStatuses}
                />
                <span className="text-sm font-medium">
                  {selectedStatuses.length === STATUS_FILTER_OPTIONS.length
                    ? translate('Deselect All')
                    : translate('Select All')}
                </span>
              </div>

              <div className="h-px bg-border" />

              {/* Status list */}
              <div className="space-y-0.5">
                {STATUS_FILTER_OPTIONS.map((status) => {
                  const config = statusDisplayConfig[status];
                  const StatusIcon = config.icon;
                  return (
                    <div
                      key={status}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
                      onClick={() => handleStatusToggle(status)}
                    >
                      <Checkbox
                        checked={selectedStatuses.includes(status)}
                        onCheckedChange={() => handleStatusToggle(status)}
                      />
                      <StatusIcon className={cn('w-3.5 h-3.5', config.colorClass)} />
                      <span className="text-sm">{config.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Divider */}
        <div className="h-6 w-px bg-border" />

        {/* Positive/Negative Filter Toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onNegativeFilterChange(!isNegativeFilter)}
                aria-label={
                  isNegativeFilter
                    ? translate('Switch to show matching nodes')
                    : translate('Switch to hide matching nodes')
                }
                aria-pressed={isNegativeFilter}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors',
                  isNegativeFilter
                    ? 'bg-orange-500/20 text-orange-500'
                    : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                )}
              >
                {isNegativeFilter ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>{translate('Hide')}</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    <span>{translate('Show')}</span>
                  </>
                )}
              </button>
              <Switch
                checked={isNegativeFilter}
                onCheckedChange={onNegativeFilterChange}
                aria-label={translate('Toggle between show and hide filter modes')}
                className="h-5 w-9 data-[state=checked]:bg-orange-500"
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {isNegativeFilter
              ? translate('Negative filter: Highlighting non-matching nodes')
              : translate('Positive filter: Highlighting matching nodes')}
          </TooltipContent>
        </Tooltip>

        {/* Clear Filters Button - only show when filters are active */}
        {hasActiveFilter && (
          <>
            <div className="h-6 w-px bg-border" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  onClick={onClearFilters}
                  aria-label={translate('Clear all filters')}
                >
                  <X className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{translate('Clear All Filters')}</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </Panel>
  );
}
