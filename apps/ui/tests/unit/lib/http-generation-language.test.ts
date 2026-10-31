import { afterEach, expect, it, vi } from 'vitest';
import { setUiLocale, getUiLocale } from '@/lib/i18n';
import { createFeaturesClient } from '@/lib/http-domains/features';
import { createEnhancePromptClient } from '@/lib/http-domains/enhancePrompt';
import { createBacklogPlanClient } from '@/lib/http-domains/backlogPlan';
import { createSpecRegenerationClient } from '@/lib/http-domains/specRegeneration';
import { createIdeationClient } from '@/lib/http-domains/ideation';
import { createAutoModeClient } from '@/lib/http-domains/autoMode';

const original = getUiLocale();
afterEach(() => setUiLocale(original));

it('captures the current language for every task-generation entry point, even on existing clients', async () => {
  const post = vi.fn().mockResolvedValue({ success: true });
  const transport = {
    post,
    get: vi.fn(),
    httpPut: vi.fn(),
    httpDelete: vi.fn(),
    subscribeToEvent: vi.fn(),
  };
  const features = createFeaturesClient(transport);
  const enhance = createEnhancePromptClient(transport);
  const backlog = createBacklogPlanClient(transport);
  const spec = createSpecRegenerationClient(transport);
  const ideas = createIdeationClient(transport);

  for (const locale of ['ru', 'en'] as const) {
    setUiLocale(locale);
    post.mockClear();
    await features.generateTitle('Implement getUser() in src/user.ts', '/project');
    await enhance.enhance('Draft', 'acceptance');
    await backlog.generate('/project', 'Plan tasks');
    await spec.create('/project', 'Overview', true);
    await spec.generate('/project', 'Definition', true);
    await spec.generateFeatures('/project', 2);
    await ideas.startSession('/project', { initialMessage: 'Suggest ideas' });
    await ideas.sendMessage('session', 'More details');
    await ideas.generateSuggestions('/project', 'prompt', 'feature');
    expect(post).toHaveBeenCalledTimes(9);
    for (const [, body] of post.mock.calls) expect(body.outputLocale).toBe(locale);
    expect(post).toHaveBeenCalledWith('/api/features/generate-title', {
      description: 'Implement getUser() in src/user.ts',
      projectPath: '/project',
      outputLocale: locale,
    });
  }
});

it('captures the current UI language when starting or continuing a task or auto loop', async () => {
  const post = vi.fn().mockResolvedValue({ success: true });
  const auto = createAutoModeClient({ post, subscribeToEvent: vi.fn() });
  for (const locale of ['ru', 'en'] as const) {
    setUiLocale(locale);
    post.mockClear();
    await auto.start('/project');
    await auto.runFeature('/project', 'task');
    await auto.resumeFeature('/project', 'task');
    await auto.followUpFeature('/project', 'task', 'Continue');
    await auto.resumeInterrupted('/project');
    await auto.analyzeProject('/project');
    expect(post).toHaveBeenCalledTimes(6);
    for (const [, body] of post.mock.calls) expect(body.outputLocale).toBe(locale);
  }
});
