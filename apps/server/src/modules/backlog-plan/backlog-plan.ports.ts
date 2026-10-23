import type { BacklogPlanResult } from '@automaker/types';
import type { StoredBacklogPlan } from '../../routes/backlog-plan/common.js';
import type { BacklogGenerateRequest } from './backlog-plan.schemas.js';

export const BACKLOG_PLAN_WORKFLOW = Symbol('BACKLOG_PLAN_WORKFLOW');
export interface BacklogPlanWorkflow {
  generate(
    input: BacklogGenerateRequest,
    abortController: AbortController
  ): Promise<BacklogPlanResult>;
}

export const BACKLOG_PLAN_STORE = Symbol('BACKLOG_PLAN_STORE');
export interface BacklogPlanStore {
  load(projectPath: string): Promise<StoredBacklogPlan | null>;
  clear(projectPath: string): Promise<void>;
}
