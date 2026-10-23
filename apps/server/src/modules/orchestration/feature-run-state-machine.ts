export const FEATURE_RUN_STATES = [
  'backlog',
  'queued',
  'preparing',
  'planning',
  'awaiting_approval',
  'executing',
  'testing',
  'awaiting_review',
  'completed',
  'failed',
  'interrupted',
] as const;

export type FeatureRunState = (typeof FEATURE_RUN_STATES)[number];

const TERMINAL_STATES = new Set<FeatureRunState>(['completed', 'failed', 'interrupted']);

export const FEATURE_RUN_TRANSITIONS: Readonly<
  Record<FeatureRunState, readonly FeatureRunState[]>
> = {
  backlog: ['queued'],
  queued: ['preparing', 'interrupted', 'failed'],
  preparing: ['planning', 'executing', 'interrupted', 'failed'],
  planning: ['awaiting_approval', 'executing', 'interrupted', 'failed'],
  awaiting_approval: ['executing', 'backlog', 'interrupted', 'failed'],
  executing: ['testing', 'awaiting_review', 'completed', 'interrupted', 'failed'],
  testing: ['executing', 'awaiting_review', 'completed', 'interrupted', 'failed'],
  awaiting_review: ['executing', 'testing', 'completed', 'interrupted', 'failed'],
  completed: [],
  failed: ['queued'],
  interrupted: ['queued'],
};

export function canTransitionFeatureRun(from: FeatureRunState, to: FeatureRunState): boolean {
  return from === to || FEATURE_RUN_TRANSITIONS[from].includes(to);
}

export function isTerminalFeatureRunState(state: FeatureRunState): boolean {
  return TERMINAL_STATES.has(state);
}

export function mapLegacyFeatureStatus(status: unknown): FeatureRunState | undefined {
  if (typeof status !== 'string') return undefined;
  if ((FEATURE_RUN_STATES as readonly string[]).includes(status)) return status as FeatureRunState;
  if (status === 'pending' || status === 'ready') return 'queued';
  if (status === 'running' || status === 'in_progress' || status.startsWith('pipeline_')) {
    return 'executing';
  }
  if (status === 'waiting_approval') return 'awaiting_approval';
  if (status === 'verified') return 'completed';
  if (status === 'merge_conflict') return 'failed';
  return undefined;
}
