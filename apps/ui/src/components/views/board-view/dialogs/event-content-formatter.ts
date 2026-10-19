import { translate } from '@/lib/i18n';
/**
 * Event content formatting utilities for AgentOutputModal
 * Extracts the complex switch statement logic from the main component
 */

import type { AutoModeEvent } from '@/types/electron';
import type { BacklogPlanEvent } from '@automaker/types';

/**
 * Format auto mode event content for display
 */
export function formatAutoModeEventContent(event: AutoModeEvent): string {
  switch (event.type) {
    case 'auto_mode_progress':
      return event.content || '';

    case 'auto_mode_tool': {
      const toolName = event.tool || 'Unknown Tool';
      const toolInput = event.input ? JSON.stringify(event.input, null, 2) : '';
      return translate('\n🔧 Tool: {value1}\n{value2}', {
        value1: toolName,
        value2: toolInput ? `Input: ${toolInput}\n` : '',
      });
    }

    case 'auto_mode_phase': {
      const phaseEmoji = event.phase === 'planning' ? '📋' : event.phase === 'action' ? '⚡' : '✅';
      return `\n${phaseEmoji} ${event.message}\n`;
    }

    case 'auto_mode_error':
      return translate('\n❌ Error: {value1}\n', { value1: event.error });

    case 'auto_mode_ultrathink_preparation':
      return formatUltrathinkPreparation(event);

    case 'planning_started': {
      if ('mode' in event && 'message' in event) {
        const modeLabel = event.mode === 'lite' ? 'Lite' : event.mode === 'spec' ? 'Spec' : 'Full';
        return translate('\n📋 Planning Mode: {value1}\n{value2}\n', {
          value1: modeLabel,
          value2: event.message,
        });
      }
      return '';
    }

    case 'plan_approval_required':
      return translate('\n⏸️ Plan generated - waiting for your approval...\n');

    case 'plan_approved':
      return event.hasEdits
        ? translate('\n✅ Plan approved (with edits) - continuing to implementation...\n')
        : translate('\n✅ Plan approved - continuing to implementation...\n');

    case 'plan_auto_approved':
      return translate('\n✅ Plan auto-approved - continuing to implementation...\n');

    case 'plan_revision_requested': {
      const revisionEvent = event as Extract<AutoModeEvent, { type: 'plan_revision_requested' }>;
      return translate('\n🔄 Revising plan based on your feedback (v{value1})...\n', {
        value1: revisionEvent.planVersion,
      });
    }

    case 'auto_mode_task_started': {
      const taskEvent = event as Extract<AutoModeEvent, { type: 'auto_mode_task_started' }>;
      return translate('\n▶ Starting {value1}: {value2}\n', {
        value1: taskEvent.taskId,
        value2: taskEvent.taskDescription,
      });
    }

    case 'auto_mode_task_complete': {
      const taskEvent = event as Extract<AutoModeEvent, { type: 'auto_mode_task_complete' }>;
      return translate('\n✓ {value1} completed ({value2}/{value3})\n', {
        value1: taskEvent.taskId,
        value2: taskEvent.tasksCompleted,
        value3: taskEvent.tasksTotal,
      });
    }

    case 'auto_mode_phase_complete': {
      const phaseEvent = event as Extract<AutoModeEvent, { type: 'auto_mode_phase_complete' }>;
      return translate('\n🏁 Phase {value1} complete\n', { value1: phaseEvent.phaseNumber });
    }

    case 'auto_mode_feature_complete': {
      const emoji = event.passes ? '✅' : '⚠️';
      return translate('\n{value1} Task completed: {value2}\n', {
        value1: emoji,
        value2: event.message,
      });
    }

    default:
      return '';
  }
}

/**
 * Format backlog plan event content for display
 */
export function formatBacklogPlanEventContent(event: BacklogPlanEvent): string {
  switch (event.type) {
    case 'backlog_plan_progress':
      return `\n🧭 ${event.content || 'Backlog plan progress update'}\n`;

    case 'backlog_plan_error':
      return translate('\n❌ Backlog plan error: {value1}\n', {
        value1: event.error || 'Unknown error',
      });

    case 'backlog_plan_complete':
      return translate('\n✅ Backlog plan completed\n');

    default:
      return `\nℹ️ ${event.type}\n`;
  }
}

/**
 * Format ultrathink preparation details
 */
function formatUltrathinkPreparation(
  event: AutoModeEvent & {
    warnings?: string[];
    recommendations?: string[];
    estimatedCost?: number;
    estimatedTime?: string;
  }
): string {
  let prepContent = '\n🧠 Ultrathink Preparation\n';

  if (event.warnings && event.warnings.length > 0) {
    prepContent += '\n⚠️ Warnings:\n';
    event.warnings.forEach((warning: string) => {
      prepContent += `  • ${warning}\n`;
    });
  }

  if (event.recommendations && event.recommendations.length > 0) {
    prepContent += '\n💡 Recommendations:\n';
    event.recommendations.forEach((rec: string) => {
      prepContent += `  • ${rec}\n`;
    });
  }

  if (event.estimatedCost !== undefined) {
    prepContent += `\n💰 Estimated Cost: ~$${event.estimatedCost.toFixed(2)} per execution\n`;
  }

  if (event.estimatedTime) {
    prepContent += `\n⏱️ Estimated Time: ${event.estimatedTime}\n`;
  }

  return prepContent;
}
