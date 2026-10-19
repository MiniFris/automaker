import type { PipelineConfig } from '@automaker/types';
import { translate } from '@/lib/i18n';

/** Only built-in stage names are localized. Custom names and persisted data stay intact. */
export function getPipelineStepLabel(name?: string): string {
  switch (name) {
    case 'Code Review':
      return translate('Code Review');
    case 'Security Review':
      return translate('Security Review');
    case 'User Experience':
      return translate('User Experience');
    case 'Testing':
      return translate('Testing');
    case 'Documentation':
      return translate('Documentation');
    case 'Performance':
      return translate('Performance');
    case 'Commit Changes':
      return translate('Commit Changes');
    case 'Planning':
      return translate('Planning');
    case 'Implementation':
      return translate('Implementation');
    case 'Verification':
    case 'Verify':
      return translate('Verification');
    case 'Review':
      return translate('Review');
    case 'Commit':
      return translate('Commit');
    default:
      return name || translate('Pipeline Step');
  }
}

/** Translate known workflow IDs at the display boundary, never in filters/API payloads. */
export function getWorkflowStatusLabel(status: string, pipeline?: PipelineConfig | null): string {
  switch (status) {
    case 'backlog':
      return translate('Backlog');
    case 'merge_conflict':
      return translate('Merge Conflict');
    case 'ready':
      return translate('Ready');
    case 'interrupted':
      return translate('Interrupted');
    case 'in_progress':
      return translate('In Progress');
    case 'waiting_approval':
      return translate('Waiting Approval');
    case 'verified':
      return translate('Verified');
    case 'completed':
      return translate('Completed');
    case 'pending':
      return translate('Pending');
    case 'running':
      return translate('Running');
    case 'paused':
      return translate('Paused');
    case 'failed':
      return translate('Failed');
    case 'cancelled':
      return translate('Cancelled');
    case 'stopped':
      return translate('Stopped');
  }
  if (status.startsWith('pipeline_')) {
    const id = status.slice('pipeline_'.length);
    const step = pipeline?.steps.find((item) => item.id === id);
    if (step) return getPipelineStepLabel(step.name);
    return translate('Pipeline Step');
  }
  return status.replace(/_/g, ' ');
}
