import { translate, useUiLocale } from '@/lib/i18n';
import { Panel } from '@xyflow/react';
import { Clock, Play, Pause, CheckCircle2, Lock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const legendItems = [
  {
    icon: Clock,
    get label() {
      return translate('Backlog');
    },
    colorClass: 'text-muted-foreground',
    bgClass: 'bg-muted/50',
  },
  {
    icon: Play,
    get label() {
      return translate('In Progress');
    },
    colorClass: 'text-[var(--status-in-progress)]',
    bgClass: 'bg-[var(--status-in-progress)]/20',
  },
  {
    icon: Pause,
    get label() {
      return translate('Waiting');
    },
    colorClass: 'text-[var(--status-waiting)]',
    bgClass: 'bg-[var(--status-warning)]/20',
  },
  {
    icon: CheckCircle2,
    get label() {
      return translate('Verified');
    },
    colorClass: 'text-[var(--status-success)]',
    bgClass: 'bg-[var(--status-success)]/20',
  },
  {
    icon: Lock,
    get label() {
      return translate('Blocked');
    },
    colorClass: 'text-orange-500',
    bgClass: 'bg-orange-500/20',
  },
  {
    icon: AlertCircle,
    get label() {
      return translate('Error');
    },
    colorClass: 'text-[var(--status-error)]',
    bgClass: 'bg-[var(--status-error)]/20',
  },
];

export function GraphLegend() {
  useUiLocale();
  return (
    <Panel position="bottom-right" className="pointer-events-none">
      <div
        className="flex flex-wrap gap-3 p-2 rounded-lg backdrop-blur-sm border border-border shadow-lg pointer-events-auto text-popover-foreground"
        style={{ backgroundColor: 'color-mix(in oklch, var(--popover) 90%, transparent)' }}
      >
        {legendItems.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="flex items-center gap-1.5">
              <div className={cn('p-1 rounded', item.bgClass)}>
                <Icon className={cn('w-3 h-3', item.colorClass)} />
              </div>
              <span className="text-xs text-muted-foreground">{item.label}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
