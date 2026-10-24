import { describe, expect, it, vi } from 'vitest';
import { createProviderRegistrations } from '../../../src/modules/providers/provider-registrations.js';
import { ProviderRegistry } from '../../../src/modules/providers/provider-registry.service.js';
import { MockProvider } from '../../helpers/mock-provider.js';
import { AgentProviderSelector } from '../../../src/services/agent/agent-provider-selector.js';
import { ToolPolicyService } from '../../../src/modules/providers/tool-policy.service.js';
import type { ModelDefinition } from '../../../src/providers/types.js';
import type { ProviderFeatureCapabilities } from '../../../src/providers/provider-contract.js';

class CatalogProvider extends MockProvider {
  constructor(
    models: ModelDefinition[],
    private readonly features: Partial<ProviderFeatureCapabilities> = {}
  ) {
    super('fixture', models);
  }
  protected featureCapabilities() {
    return this.features;
  }
}
const model = (id: string, flags: Partial<ModelDefinition> = {}): ModelDefinition => ({
  id,
  modelString: id,
  name: id,
  provider: 'claude',
  description: 'Fixture',
  ...flags,
});
const registry = (adapter: CatalogProvider) =>
  new ProviderRegistry([{ name: 'fixture', canHandleModel: () => true, create: () => adapter }], {
    isDisconnected: () => false,
  } as never);
const none = { vision: false, tools: false, reasoning: false };
const matrix = {
  claude: [true, true, true, true, true],
  codex: [true, true, true, true, true],
  cursor: [false, true, false, false, true],
  gemini: [false, true, false, false, true],
  copilot: [false, true, false, false, true],
  opencode: [false, true, false, false, true],
  'openai-compatible': [false, true, false, false, true],
} as const;
describe('explicit adapter and model capability boundaries', () => {
  it.each(createProviderRegistrations({} as never))(
    '$name advertises implemented transport paths without probing a model catalog',
    ({ name, create }) => {
      const adapter = create();
      const catalog = vi.spyOn(adapter, 'getAvailableModels').mockImplementation(() => {
        throw new Error('Catalog/probe must not run');
      });
      const caps = adapter.getCapabilities();
      expect([caps.vision, caps.tools, caps.reasoning, caps.mcp, caps.remoteExecution]).toEqual(
        matrix[name as keyof typeof matrix]
      );
      expect(Object.isFrozen(caps)).toBe(true);
      expect(catalog).not.toHaveBeenCalled();
    }
  );
  it('does not grant adapter features from a model or a legacy supportsFeature flag', () => {
    const adapter = new CatalogProvider([
      model('known', { supportsVision: true, supportsTools: true, hasReasoning: true }),
    ]);
    vi.spyOn(adapter, 'supportsFeature').mockReturnValue(true);
    expect(adapter.getCapabilities()).toMatchObject({
      ...none,
      mcp: false,
      remoteExecution: false,
    });
    expect(adapter.getModelCapabilities('known')).toEqual({
      vision: true,
      tools: true,
      reasoning: true,
    });
    expect(registry(adapter).modelCapabilities('known')).toEqual(none);
  });
  it.each([
    'version',
    'sdk',
    '-version',
    ' sdk-version',
    'unknown',
    '__proto__',
    'constructor',
    '',
  ])('does not infer capabilities from partial/unknown ID %j', (id) => {
    const adapter = new CatalogProvider([
      model('fixture-sdk-version', {
        modelString: 'sdk-version',
        supportsVision: true,
        supportsTools: true,
        hasReasoning: true,
      }),
      model('invalid-empty-sdk-alias', {
        modelString: '',
        supportsVision: true,
        supportsTools: true,
        hasReasoning: true,
      }),
    ]);
    expect(adapter.getModelCapabilities(id)).toEqual(none);
  });
  it('accepts exact application IDs and SDK IDs without suffix matching', () => {
    const adapter = new CatalogProvider([
      model('fixture-sdk-version', {
        modelString: 'sdk-version',
        supportsVision: true,
        supportsTools: true,
      }),
    ]);
    expect(adapter.getModelCapabilities('fixture-sdk-version')).toEqual({
      vision: true,
      tools: true,
      reasoning: false,
    });
    expect(adapter.getModelCapabilities('sdk-version')).toEqual({
      vision: true,
      tools: true,
      reasoning: false,
    });
  });
  it('intersects ambiguous SDK aliases and gives an exact application ID priority', () => {
    const adapter = new CatalogProvider([
      model('restricted', { modelString: 'shared', supportsVision: false, supportsTools: false }),
      model('capable', { modelString: 'shared', supportsVision: true, supportsTools: true }),
    ]);
    expect(adapter.getModelCapabilities('shared')).toEqual(none);
    expect(adapter.getModelCapabilities('capable').tools).toBe(true);
    const explicit = new CatalogProvider([
      ...adapter.getAvailableModels(),
      model('shared', { modelString: 'another-sdk-id', supportsTools: true }),
    ]);
    expect(explicit.getModelCapabilities('shared').tools).toBe(true);
  });
  it('retains the explicit Claude aliases but denies version/date suffixes', () => {
    const adapter = createProviderRegistrations({} as never)
      .find((entry) => entry.name === 'claude')!
      .create();
    for (const alias of [
      'sonnet',
      'opus',
      'haiku',
      'claude-sonnet',
      'claude-opus',
      'claude-haiku',
    ]) {
      expect(adapter.getModelCapabilities(alias).vision).toBe(true);
      expect(adapter.getModelCapabilities(alias).tools).toBe(true);
    }
    for (const unknown of ['4-6', '20251001', '6', 'sonnet-ish'])
      expect(adapter.getModelCapabilities(unknown)).toEqual(none);
  });
  it('does not enable tools for another model of the same provider', () => {
    const adapter = new CatalogProvider(
      [model('with-tools', { supportsTools: true }), model('text-only', { supportsTools: false })],
      { tools: true }
    );
    const catalog = registry(adapter);
    const selector = new AgentProviderSelector(catalog, new ToolPolicyService());
    expect(selector.allowedTools('with-tools', ['Read', 'Bash'])).toEqual(['Read', 'Bash']);
    expect(selector.allowedTools('text-only', ['Read', 'Bash'])).toEqual([]);
    expect(selector.allowedTools('unknown', undefined)).toEqual([]);
  });
  it('does not advertise image transport just because the model supports vision', () => {
    const adapter = new CatalogProvider([model('vision-model', { supportsVision: true })], {
      vision: false,
    });
    expect(adapter.getModelCapabilities('vision-model').vision).toBe(true);
    expect(registry(adapter).supportsVision('vision-model')).toBe(false);
  });
  it('does not invent model grants for endpoint-scoped Direct models', () => {
    const adapter = createProviderRegistrations({} as never)
      .find((entry) => entry.name === 'openai-compatible')!
      .create();
    expect(adapter.getCapabilities().tools).toBe(true);
    expect(adapter.getModelCapabilities('direct-Exact/Model')).toEqual(none);
  });
});
