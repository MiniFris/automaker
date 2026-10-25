import { ApplicationMetrics } from '../../src/core/observability/application-metrics.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MockProvider } from '../helpers/mock-provider.js';
import type { ExecuteOptions } from '../../src/providers/types.js';
import { createEventEmitter } from '../../src/lib/events.js';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service.js';
import { NativeAppSpecWorkflow } from '../../src/modules/app-spec/native-app-spec.workflow.js';
import { PlanningWorkflowContext } from '../../src/modules/app-spec/planning-workflow.context.js';
import { secureFs } from '@automaker/platform';
import type * as Filesystem from '../../src/lib/secure-fs.js';
import { SettingsService } from '../../src/services/settings-service.js';
import { NotificationService } from '../../src/services/notification-service.js';
import * as notificationFilesystem from '../../src/lib/secure-fs.js';
import { FeatureLoader } from '../../src/services/feature-loader.js';

describe('spec to features provider workflow', () => {
  it.each([false, true])(
    'uses the injected registry and preserves cancellation=%s across phases',
    async (cancel) => {
      const project = await mkdtemp(path.join(os.tmpdir(), 'automaker-spec-chain-'));
      const controller = new AbortController();
      const events = createEventEmitter();
      const settings = new SettingsService(path.join(project, 'data'));
      const queries: ExecuteOptions[] = [];
      const execute = vi.fn(async function* (options: ExecuteOptions) {
        queries.push(options);
        const text =
          queries.length === 1
            ? '<project_specification><project_name>Fixture</project_name><overview>Fixture overview</overview></project_specification>'
            : JSON.stringify({
                features: [
                  {
                    id: 'chain-feature',
                    title: 'Generated feature',
                    description: 'Implement the fixture feature',
                  },
                ],
              });
        yield {
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text }] },
        };
      });
      class WorkflowProvider extends MockProvider {
        protected execute(options: ExecuteOptions) {
          return execute(options);
        }
      }
      const providers = new ProviderRegistry(
        [{ name: 'claude', create: () => new WorkflowProvider('claude') }],
        { isDisconnected: () => false } as never,
        new ApplicationMetrics()
      );
      const filesystem = secureFs.createSecureFs((candidate) => {
        const absolute = path.resolve(candidate),
          relative = path.relative(project, absolute);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
          throw new Error('Denied fixture path');
        return absolute;
      });
      const workflow = new NativeAppSpecWorkflow(
        events,
        settings,
        new NotificationService(notificationFilesystem, path.resolve),
        providers,
        new PlanningWorkflowContext(
          filesystem as unknown as typeof Filesystem,
          { validateLocalPath: (value: string) => value } as never
        )
      );
      const emitted: Array<{ type?: string; content?: string }> = [];
      const unsubscribe = events.subscribe((_type, payload) => {
        const event = payload as { type?: string; content?: string };
        emitted.push(event);
        if (cancel && event.content?.includes('[Phase: spec_complete]')) controller.abort();
      });
      try {
        const generated = workflow.generate({
          projectPath: project,
          source: 'Build a fixture app',
          generateFeatures: true,
          analyzeProject: false,
          maxFeatures: 1,
          abortController: controller,
        });
        if (cancel) await expect(generated).rejects.toMatchObject({ name: 'AbortError' });
        else await generated;
        expect(await readFile(path.join(project, '.automaker', 'app_spec.txt'), 'utf8')).toContain(
          '<project_name>Fixture</project_name>'
        );
        expect(execute).toHaveBeenCalledTimes(cancel ? 1 : 2);
        for (const query of queries) {
          expect(query.abortController).not.toBe(controller);
          expect(query.abortController).toBeInstanceOf(AbortController);
          expect(query.readOnly).toBe(true);
        }
        expect(controller.signal.aborted).toBe(cancel);
        const features = await new FeatureLoader().getAll(project);
        if (cancel) {
          expect(features).toEqual([]);
        } else {
          expect(features).toContainEqual(
            expect.objectContaining({ id: 'chain-feature', status: 'backlog' })
          );
          expect(emitted).toContainEqual(
            expect.objectContaining({ type: 'spec_regeneration_complete' })
          );
        }
      } finally {
        unsubscribe();
        await providers.onApplicationShutdown();
        await filesystem.close();
        await rm(project, { recursive: true, force: true });
      }
    }
  );
});
