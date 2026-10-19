import { getFormattingLocale } from '@/lib/i18n';
import { translate, useUiLocale } from '@/lib/i18n';
/**
 * RecentActivityFeed - Timeline of recent activity across all projects
 *
 * Shows completed features, failures, and auto-mode events.
 */

import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAppStore } from '@/store/app-store';
import { initializeProject } from '@/lib/project-init';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { RecentActivity, ActivityType, ActivitySeverity } from '@automaker/types';
import { CheckCircle2, XCircle, Play, Bot, AlertTriangle, Info, Clock } from 'lucide-react';

interface RecentActivityFeedProps {
  activities: RecentActivity[];
  maxItems?: number;
}

const activityTypeConfig: Record<
  ActivityType,
  { icon: typeof CheckCircle2; defaultColor: string; label: string }
> = {
  feature_created: {
    icon: Info,
    defaultColor: 'text-blue-500',
    get label() {
      return translate('Feature created');
    },
  },
  feature_completed: {
    icon: CheckCircle2,
    defaultColor: 'text-blue-500',
    get label() {
      return translate('Feature completed');
    },
  },
  feature_verified: {
    icon: CheckCircle2,
    defaultColor: 'text-purple-500',
    get label() {
      return translate('Feature verified');
    },
  },
  feature_failed: {
    icon: XCircle,
    defaultColor: 'text-red-500',
    get label() {
      return translate('Feature failed');
    },
  },
  feature_started: {
    icon: Play,
    defaultColor: 'text-green-500',
    get label() {
      return translate('Feature started');
    },
  },
  auto_mode_started: {
    icon: Bot,
    defaultColor: 'text-green-500',
    get label() {
      return translate('Auto-mode started');
    },
  },
  auto_mode_stopped: {
    icon: Bot,
    defaultColor: 'text-muted-foreground',
    get label() {
      return translate('Auto-mode stopped');
    },
  },
  ideation_session_started: {
    icon: Play,
    defaultColor: 'text-brand-500',
    get label() {
      return translate('Ideation session started');
    },
  },
  ideation_session_ended: {
    icon: Info,
    defaultColor: 'text-muted-foreground',
    get label() {
      return translate('Ideation session ended');
    },
  },
  idea_created: {
    icon: Info,
    defaultColor: 'text-brand-500',
    get label() {
      return translate('Idea created');
    },
  },
  idea_converted: {
    icon: CheckCircle2,
    defaultColor: 'text-green-500',
    get label() {
      return translate('Idea converted to feature');
    },
  },
  notification_created: {
    icon: AlertTriangle,
    defaultColor: 'text-yellow-500',
    get label() {
      return translate('Notification');
    },
  },
  project_opened: {
    icon: Info,
    defaultColor: 'text-blue-500',
    get label() {
      return translate('Project opened');
    },
  },
};

const severityColors: Record<ActivitySeverity, string> = {
  info: 'text-blue-500',
  success: 'text-green-500',
  warning: 'text-yellow-500',
  error: 'text-red-500',
};

function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return translate('just now');
  if (diffMins < 60) return translate('{value1}m ago', { value1: diffMins });
  if (diffHours < 24) return translate('{value1}h ago', { value1: diffHours });
  if (diffDays < 7) return translate('{value1}d ago', { value1: diffDays });
  return date.toLocaleDateString(getFormattingLocale());
}

export function RecentActivityFeed({ activities, maxItems = 10 }: RecentActivityFeedProps) {
  useUiLocale();
  const navigate = useNavigate();
  const { upsertAndSetCurrentProject } = useAppStore();

  const displayActivities = activities.slice(0, maxItems);

  const handleActivityClick = useCallback(
    async (activity: RecentActivity) => {
      try {
        // Get project path from the activity (projectId is actually the path in our data model)
        const projectPath = (activity.projectPath as string | undefined) || activity.projectId;
        const projectName = activity.projectName;

        const initResult = await initializeProject(projectPath);

        if (!initResult.success) {
          toast.error(translate('Failed to initialize project'), {
            description: initResult.error || 'Unknown error',
          });
          return;
        }

        upsertAndSetCurrentProject(projectPath, projectName);

        if (activity.featureId) {
          // Navigate to the specific feature with project path for deep link handling
          navigate({
            to: '/board',
            search: {
              featureId: activity.featureId,
              projectPath: projectPath || undefined,
            },
          });
        } else {
          navigate({ to: '/board' });
        }
      } catch (error) {
        toast.error(translate('Failed to navigate to activity'), {
          description: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
    [navigate, upsertAndSetCurrentProject]
  );

  const handleActivityKeyDown = useCallback(
    (e: React.KeyboardEvent, activity: RecentActivity) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleActivityClick(activity);
      }
    },
    [handleActivityClick]
  );

  if (displayActivities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Clock className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-sm">{translate('No recent activity')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {displayActivities.map((activity) => {
        const config = activityTypeConfig[activity.type];
        const Icon = config.icon;
        const iconColor = severityColors[activity.severity] || config.defaultColor;

        return (
          <div
            key={activity.id}
            role="button"
            tabIndex={0}
            className="group flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
            onClick={() => handleActivityClick(activity)}
            onKeyDown={(e) => handleActivityKeyDown(e, activity)}
            aria-label={translate('{value1}: {value2} in {value3}', {
              value1: config.label,
              value2: activity.featureName || activity.message,
              value3: activity.projectName,
            })}
            data-testid={`activity-item-${activity.id}`}
          >
            {/* Icon */}
            <div
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5',
                activity.severity === 'error' && 'bg-red-500/10',
                activity.severity === 'success' && 'bg-green-500/10',
                activity.severity === 'warning' && 'bg-yellow-500/10',
                activity.severity === 'info' && 'bg-blue-500/10'
              )}
            >
              <Icon className={cn('w-4 h-4', iconColor)} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {activity.projectName}
                </span>
                <span className="text-xs text-muted-foreground/50">
                  {formatRelativeTime(activity.timestamp)}
                </span>
              </div>
              <p className="text-sm text-foreground truncate group-hover:text-brand-500 transition-colors">
                {activity.featureTitle || activity.description}
              </p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{config.label}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
