import { mkdtemp, mkdir, rm, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it, vi } from 'vitest';
import { createNestApplication } from '../../src/main.js';
import { AppSpecApplicationService } from '../../src/modules/app-spec/app-spec-application.service.js';
import { AppSpecJobRegistry } from '../../src/modules/app-spec/app-spec-job.registry.js';
import {
  APP_SPEC_WORKFLOW_PORT,
  type AppSpecWorkflowPort,
} from '../../src/modules/app-spec/app-spec-workflow.port.js';
import { BacklogPlanApplicationService } from '../../src/modules/backlog-plan/backlog-plan-application.service.js';
import { BacklogPlanJobRegistry } from '../../src/modules/backlog-plan/backlog-plan-job.registry.js';
import {
  BACKLOG_PLAN_WORKFLOW,
  type BacklogPlanWorkflow,
} from '../../src/modules/backlog-plan/backlog-plan.ports.js';
import { RunningAgentsService } from '../../src/modules/agents/running-agents.service.js';
import { SECURE_FILESYSTEM } from '../../src/core/security/index.js';
import { NativeAppSpecWorkflow } from '../../src/modules/app-spec/native-app-spec.workflow.js';
import { NativeBacklogPlanWorkflow } from '../../src/modules/backlog-plan/native-backlog-plan.workflow.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { ExecuteOptions } from '../../src/providers/types.js';
import { PlanningWorkflowContext } from '../../src/modules/app-spec/planning-workflow.context.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('keeps same-project planning jobs and Running Agents isolated between apps, and drains accepted work before filesystem close', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'automaker-planning-owners-'));
  const project = path.join(root, 'project');
  await mkdir(project);
  const apps: Awaited<ReturnType<typeof createNestApplication>>[] = [];
  const releases: Array<() => void> = [];
  async function owner(name: string) {
    const runtime = await createNestApplication({
      workingDirectory: root,
      dataDir: path.join(root, name),
      runStartupTasks: false,
      providerRegistrations: [],
      enableShutdownHooks: false,
      environment: {
        NODE_ENV: 'test',
        HOME: root,
        XDG_CONFIG_HOME: path.join(root, 'config'),
        AUTOMAKER_API_KEY: 'fixture',
        ALLOWED_ROOT_DIRECTORY: root,
        ENABLE_REQUEST_LOGGING: 'false',
      },
    });
    apps.push(runtime);
    const spec = runtime.app.get<AppSpecWorkflowPort>(APP_SPEC_WORKFLOW_PORT),
      backlog = runtime.app.get<BacklogPlanWorkflow>(BACKLOG_PLAN_WORKFLOW);
    expect(spec).toBeInstanceOf(NativeAppSpecWorkflow);
    expect(backlog).toBeInstanceOf(NativeBacklogPlanWorkflow);
    const held = deferred();
    releases.push(held.resolve);
    const signals: AbortSignal[] = [],
      events: string[] = [];
    vi.spyOn(spec, 'generate').mockImplementation(async (input) => {
      signals.push(input.abortController.signal);
      await held.promise;
      events.push('spec-settled');
    });
    vi.spyOn(backlog, 'generate').mockImplementation(async (_input, controller) => {
      signals.push(controller.signal);
      await held.promise;
      events.push('backlog-settled');
      return { changes: [], summary: '', dependencyUpdates: [] };
    });
    const filesystem = runtime.app.get(SECURE_FILESYSTEM),
      closeFilesystem = filesystem.close.bind(filesystem);
    const closedFilesystem = vi.spyOn(filesystem, 'close').mockImplementation(async () => {
      events.push('filesystem');
      await closeFilesystem();
    });
    const specs = runtime.app.get(AppSpecApplicationService),
      plans = runtime.app.get(BacklogPlanApplicationService);
    expect(specs.generate({ projectPath: project, projectDefinition: 'Owned spec' }).success).toBe(
      true
    );
    expect(plans.generate({ projectPath: project, prompt: name }).success).toBe(true);
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    return {
      ...runtime,
      specs,
      plans,
      signals,
      held,
      events,
      closedFilesystem,
      running: runtime.app.get(RunningAgentsService),
    };
  }
  try {
    const first = await owner('first'),
      second = await owner('second');
    expect((await first.running.list()).totalCount).toBe(2);
    expect((await second.running.list()).totalCount).toBe(2);
    first.specs.stop(project);
    first.plans.stop();
    expect(first.signals.every((signal) => signal.aborted)).toBe(true);
    expect(second.signals.some((signal) => signal.aborted)).toBe(false);
    expect(first.specs.status(project).isRunning).toBe(true);
    expect(first.plans.generate({ projectPath: project, prompt: 'replacement' }).success).toBe(
      false
    );
    let closed = false;
    const closing = first.app.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(first.closedFilesystem).not.toHaveBeenCalled();
    expect((await second.running.list()).totalCount).toBe(2);
    first.held.resolve();
    await closing;
    expect(first.events.at(-1)).toBe('filesystem');
    expect(first.events).toContain('spec-settled');
    expect(first.events).toContain('backlog-settled');
    expect(first.app.get(AppSpecJobRegistry).snapshot()).toEqual([]);
    expect(first.app.get(BacklogPlanJobRegistry).isRunning).toBe(false);
    expect(second.signals.some((signal) => signal.aborted)).toBe(false);
    second.held.resolve();
    await second.app.close();
  } finally {
    releases.forEach((release) => release());
    await Promise.allSettled(apps.map(({ app }) => app.close()));
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});

it.each([false, true])(
  'runs the native backlog provider/store workflow without legacy state and skips persistence after abort=%s',
  async (cancel) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'automaker-native-backlog-'));
    let controller: AbortController | undefined;
    class PlanProvider extends MockProvider {
      protected async *execute(_options: ExecuteOptions) {
        yield {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  changes: [],
                  summary: 'Native plan',
                  dependencyUpdates: [],
                }),
              },
            ],
          },
        };
        if (cancel) controller!.abort();
      }
    }
    const runtime = await createNestApplication({
      workingDirectory: root,
      dataDir: path.join(root, 'data'),
      runStartupTasks: false,
      enableShutdownHooks: false,
      providerRegistrations: [{ name: 'claude', create: () => new PlanProvider('claude') }],
      environment: {
        NODE_ENV: 'test',
        HOME: root,
        XDG_CONFIG_HOME: path.join(root, 'config'),
        AUTOMAKER_API_KEY: 'fixture',
        ALLOWED_ROOT_DIRECTORY: root,
        ENABLE_REQUEST_LOGGING: 'false',
      },
    });
    try {
      const workflow = runtime.app.get<BacklogPlanWorkflow>(BACKLOG_PLAN_WORKFLOW),
        original = workflow.generate.bind(workflow);
      vi.spyOn(workflow, 'generate').mockImplementation((input, owned) => {
        controller = owned;
        return original(input, owned);
      });
      const service = runtime.app.get(BacklogPlanApplicationService),
        jobs = runtime.app.get(BacklogPlanJobRegistry);
      expect(
        service.generate({ projectPath: root, prompt: 'Plan offline', model: 'claude-sonnet' })
          .success
      ).toBe(true);
      await vi.waitFor(() => expect(jobs.isRunning).toBe(false));
      const saved = await service.status(root);
      if (cancel) expect(saved.savedPlan).toBeNull();
      else {
        expect(saved.savedPlan?.result.summary).toBe('Native plan');
        expect(
          JSON.parse(await readFile(path.join(root, '.automaker', 'backlog-plan.json'), 'utf8'))
            .prompt
        ).toBe('Plan offline');
      }
      const context = runtime.app
        .get(PlanningWorkflowContext)
        .operation(root, new AbortController().signal);
      await expect(context.writeFeature(root, { id: '../escape' })).rejects.toThrow(
        'Invalid generated feature'
      );
      await expect(access(path.join(root, 'escape', 'feature.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      vi.restoreAllMocks();
      await runtime.app.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);
