import { formatCount } from '@/lib/i18n';
import { getFormattingLocale } from '@/lib/i18n';
import { translate, useUiLocale } from '@/lib/i18n';
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import {
  History,
  RefreshCw,
  Trash2,
  Play,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import type { StoredEventSummary, StoredEvent, EventHookTrigger } from '@automaker/types';
import { EVENT_HOOK_TRIGGER_LABELS } from '@automaker/types';
import { getHttpApiClient } from '@/lib/http-api-client';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from 'sonner';

export function EventHistoryView() {
  useUiLocale();
  const currentProject = useAppStore((state) => state.currentProject);
  const projectPath = currentProject?.path;
  const [events, setEvents] = useState<StoredEventSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [expandedEventData, setExpandedEventData] = useState<StoredEvent | null>(null);
  const [replayingEvent, setReplayingEvent] = useState<string | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  const loadEvents = useCallback(async () => {
    if (!projectPath) return;

    setLoading(true);
    try {
      const api = getHttpApiClient();
      const result = await api.eventHistory.list(projectPath, { limit: 100 });
      if (result.success && result.events) {
        setEvents(result.events);
      }
    } catch (error) {
      console.error('Failed to load events:', error);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const handleExpand = async (eventId: string) => {
    if (expandedEvent === eventId) {
      setExpandedEvent(null);
      setExpandedEventData(null);
      return;
    }

    if (!projectPath) return;

    setExpandedEvent(eventId);
    try {
      const api = getHttpApiClient();
      const result = await api.eventHistory.get(projectPath, eventId);
      if (result.success && result.event) {
        setExpandedEventData(result.event);
      }
    } catch (error) {
      console.error('Failed to load event details:', error);
    }
  };

  const handleReplay = async (eventId: string) => {
    if (!projectPath) return;

    setReplayingEvent(eventId);
    try {
      const api = getHttpApiClient();
      const result = await api.eventHistory.replay(projectPath, eventId);
      if (result.success && result.result) {
        const { hooksTriggered, hookResults } = result.result;
        const successCount = hookResults.filter((r) => r.success).length;
        const failCount = hookResults.filter((r) => !r.success).length;

        if (hooksTriggered === 0) {
          toast.info(translate('No matching hooks found for this event trigger.'));
        } else if (failCount === 0) {
          toast.success(translate('Successfully ran {value1} hook(s).', { value1: successCount }));
        } else {
          toast.warning(
            translate('Ran {value1} hook(s): {value2} succeeded, {value3} failed.', {
              value1: hooksTriggered,
              value2: successCount,
              value3: failCount,
            })
          );
        }
      }
    } catch (error) {
      console.error('Failed to replay event:', error);
      toast.error(translate('Failed to replay event. Check console for details.'));
    } finally {
      setReplayingEvent(null);
    }
  };

  const handleDelete = async (eventId: string) => {
    if (!projectPath) return;

    try {
      const api = getHttpApiClient();
      const result = await api.eventHistory.delete(projectPath, eventId);
      if (result.success) {
        setEvents((prev) => prev.filter((e) => e.id !== eventId));
        if (expandedEvent === eventId) {
          setExpandedEvent(null);
          setExpandedEventData(null);
        }
      }
    } catch (error) {
      console.error('Failed to delete event:', error);
    }
  };

  const handleClearAll = async () => {
    if (!projectPath) return;

    try {
      const api = getHttpApiClient();
      const result = await api.eventHistory.clear(projectPath);
      if (result.success) {
        setEvents([]);
        setExpandedEvent(null);
        setExpandedEventData(null);
      }
    } catch (error) {
      console.error('Failed to clear events:', error);
    }
    setClearDialogOpen(false);
  };

  const getTriggerIcon = (trigger: EventHookTrigger) => {
    switch (trigger) {
      case 'feature_created':
        return <Clock className="w-4 h-4 text-blue-500" />;
      case 'feature_success':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'feature_error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'auto_mode_complete':
        return <CheckCircle className="w-4 h-4 text-purple-500" />;
      case 'auto_mode_error':
        return <AlertCircle className="w-4 h-4 text-orange-500" />;
      default:
        return <History className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return translate('Just now');
    if (diffMins < 60) return translate('{value1}m ago', { value1: diffMins });
    if (diffHours < 24) return translate('{value1}h ago', { value1: diffHours });
    if (diffDays < 7) return translate('{value1}d ago', { value1: diffDays });
    return date.toLocaleDateString(getFormattingLocale());
  };

  if (!projectPath) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="text-sm">{translate('Select a project to view event history')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {formatCount(events.length, 'event')} {translate(' recorded')}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadEvents} disabled={loading}>
            {loading ? (
              <Spinner size="sm" className="mr-2" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            {translate('Refresh')}
          </Button>
          {events.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setClearDialogOpen(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {translate('Clear All')}
            </Button>
          )}
        </div>
      </div>

      {/* Events list */}
      {events.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{translate('No events recorded yet')}</p>
          <p className="text-xs mt-1">
            {translate('Events will appear here when features are created or completed')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div
              key={event.id}
              className={cn(
                'rounded-lg border bg-background/50',
                expandedEvent === event.id && 'ring-1 ring-brand-500/30'
              )}
            >
              {/* Event header */}
              <div
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => handleExpand(event.id)}
              >
                <button className="p-0.5">
                  {expandedEvent === event.id ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>

                {getTriggerIcon(event.trigger)}

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {EVENT_HOOK_TRIGGER_LABELS[event.trigger]}
                  </p>
                  {event.featureName && (
                    <p className="text-xs text-muted-foreground truncate">{event.featureName}</p>
                  )}
                </div>

                <span className="text-xs text-muted-foreground">
                  {formatTimestamp(event.timestamp)}
                </span>

                {/* Actions */}
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleReplay(event.id)}
                    disabled={replayingEvent === event.id}
                    title={translate('Replay event (trigger matching hooks)')}
                  >
                    <Play
                      className={cn('w-3.5 h-3.5', replayingEvent === event.id && 'animate-pulse')}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(event.id)}
                    title={translate('Delete event')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Expanded details */}
              {expandedEvent === event.id && expandedEventData && (
                <div className="px-4 pb-4 pt-0 border-t border-border/50">
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-muted-foreground">{translate('Event ID:')}</span>
                        <p className="font-mono text-[10px] truncate">{expandedEventData.id}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">{translate('Timestamp:')}</span>
                        <p>
                          {new Date(expandedEventData.timestamp).toLocaleString(
                            getFormattingLocale()
                          )}
                        </p>
                      </div>
                      {expandedEventData.featureId && (
                        <div>
                          <span className="text-muted-foreground">{translate('Feature ID:')}</span>
                          <p className="font-mono text-[10px] truncate">
                            {expandedEventData.featureId}
                          </p>
                        </div>
                      )}
                      {expandedEventData.passes !== undefined && (
                        <div>
                          <span className="text-muted-foreground">{translate('Passed:')}</span>
                          <p>{expandedEventData.passes ? translate('Yes') : translate('No')}</p>
                        </div>
                      )}
                    </div>
                    {expandedEventData.error && (
                      <div>
                        <span className="text-muted-foreground">{translate('Error:')}</span>
                        <p className="text-red-400 mt-1 p-2 bg-red-500/10 rounded text-[10px] font-mono whitespace-pre-wrap">
                          {expandedEventData.error}
                        </p>
                      </div>
                    )}
                    <div>
                      <span className="text-muted-foreground">{translate('Project:')}</span>
                      <p className="font-mono text-[10px] truncate">
                        {expandedEventData.projectPath}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Clear confirmation dialog */}
      <ConfirmDialog
        open={clearDialogOpen}
        onOpenChange={setClearDialogOpen}
        onConfirm={handleClearAll}
        title={translate('Clear Event History')}
        description={translate(
          'This will permanently delete all {value1} recorded events. This action cannot be undone.',
          { value1: events.length }
        )}
        icon={Trash2}
        iconClassName="text-destructive"
        confirmText={translate('Clear All')}
        confirmVariant="destructive"
      />
    </div>
  );
}
