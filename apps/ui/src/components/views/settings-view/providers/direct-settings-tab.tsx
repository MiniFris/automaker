import { translate, useUiLocale } from '@/lib/i18n';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { OpenAICompatibleEndpoint } from '@automaker/types';
import {
  DIRECT_TIMEOUT_KEYS,
  WORKFLOW_TIMEOUT_KEYS,
  parseModelTimeoutSettings,
} from '@automaker/types';
import {
  ProviderModelTimeoutSettings,
  ModelTimeoutFields,
} from '@/components/shared/model-timeout-settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getHttpApiClient } from '@/lib/http-api-client';
import {
  useDirectEndpoints,
  DIRECT_ENDPOINTS_QUERY_KEY,
} from '@/hooks/queries/use-direct-endpoints';

const selectStyle = 'rounded-md border bg-background p-2 text-sm';
function freshEndpoint(): OpenAICompatibleEndpoint {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `direct-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    name: 'Direct endpoint',
    enabled: true,
    baseUrl: 'http://localhost:1234/v1/',
    protocol: 'chat-completions',
    auth: { type: 'credentials', credentialId: id },
    models: [],
  };
}

export function DirectSettingsTab() {
  useUiLocale();
  const { data, isLoading, error } = useDirectEndpoints();
  const client = useQueryClient();
  const [draft, setDraft] = useState<OpenAICompatibleEndpoint | null>(null);
  const [apiKey, setApiKey] = useState(''); // Write-only field: never put in Zustand/localStorage/query cache.
  const [clearKey, setClearKey] = useState(false);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const api = getHttpApiClient().directEndpoints;
  const update = (changes: Partial<OpenAICompatibleEndpoint>) =>
    setDraft((value) => (value ? { ...value, ...changes } : value));
  const refresh = (result: Awaited<ReturnType<typeof api.list>>) => {
    if (!result.success) throw new Error(result.error || 'Endpoint update failed');
    client.setQueryData(DIRECT_ENDPOINTS_QUERY_KEY, result);
  };
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : translate('Request failed'));
    } finally {
      setBusy(false);
    }
  };
  const edit = (endpoint: OpenAICompatibleEndpoint) => {
    setDraft(JSON.parse(JSON.stringify(endpoint)));
    setApiKey('');
    setClearKey(false);
    setCatalog([]);
    setMessage('');
  };

  if (isLoading) return <p>{translate('Loading direct endpoints…')}</p>;
  if (error || !data)
    return <p role="alert">{translate('Unable to load direct endpoint settings.')}</p>;
  return (
    <div className="space-y-6" data-testid="direct-provider-settings">
      <div>
        <h2 className="text-lg font-semibold">{translate('OpenAI-compatible endpoints')}</h2>
        <p className="text-sm text-muted-foreground">
          {translate(
            'Connect directly without an agent CLI. Chat Completions only; tool calling must be supported by your model. API prefixes such as /v1 are not added automatically. Keys stay on the server.'
          )}
        </p>
      </div>
      {message && (
        <p role="status" className="text-sm whitespace-pre-wrap">
          {message}
        </p>
      )}
      <div className="space-y-2">
        {data.endpoints.map(({ endpoint, keyConfigured }) => (
          <div
            key={endpoint.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div>
              <span className="font-medium">{endpoint.name}</span>
              <p className="text-sm text-muted-foreground">
                {endpoint.enabled ? translate('Enabled') : translate('Disabled')} ·{' '}
                {endpoint.models.length} {translate(' models ·')}{' '}
                {endpoint.auth.type === 'none'
                  ? translate('No key required')
                  : keyConfigured
                    ? translate('Key configured')
                    : translate('Key missing')}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" disabled={busy} onClick={() => edit(endpoint)}>
                {translate('Edit')}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      translate(
                        'Remove endpoint “{value1}”? Existing selections will fail until you choose another endpoint. Stored credentials are retained.',
                        { value1: endpoint.name }
                      )
                    )
                  )
                    void action(async () => {
                      refresh(await api.remove(endpoint.id));
                      if (draft?.id === endpoint.id) {
                        setDraft(null);
                        setApiKey('');
                      }
                    });
                }}
              >
                {translate('Remove')}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button variant="outline" disabled={busy} onClick={() => edit(freshEndpoint())}>
        {translate('Add direct endpoint')}
      </Button>
      <ProviderModelTimeoutSettings
        provider="openai-compatible"
        keys={WORKFLOW_TIMEOUT_KEYS}
        title={translate('Direct task timeouts')}
      />
      {draft && (
        <fieldset
          disabled={busy}
          className="space-y-4 rounded-lg border p-4"
          data-testid="direct-endpoint-editor"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="direct-name">{translate('Name')}</Label>
              <Input
                id="direct-name"
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="direct-url">{translate('API base URL')}</Label>
              <Input
                id="direct-url"
                value={draft.baseUrl}
                onChange={(event) => update({ baseUrl: event.target.value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="direct-protocol">{translate('Protocol')}</Label>
            <select
              id="direct-protocol"
              className={selectStyle}
              value={draft.protocol}
              onChange={(event) =>
                update({ protocol: event.target.value as OpenAICompatibleEndpoint['protocol'] })
              }
            >
              <option value="chat-completions">{translate('Chat Completions')}</option>
              <option value="responses" disabled>
                {translate('Responses (not implemented)')}
              </option>
            </select>
          </div>
          <ModelTimeoutFields
            prefix="direct-timeout"
            keys={['requestTimeoutMs', ...DIRECT_TIMEOUT_KEYS]}
            value={{
              ...draft.timeouts,
              ...(draft.timeoutMs !== undefined && { requestTimeoutMs: draft.timeoutMs }),
            }}
            onChange={(value) => {
              const { requestTimeoutMs, ...timeouts } = value;
              update({
                timeoutMs: requestTimeoutMs,
                timeouts: Object.keys(timeouts).length ? timeouts : undefined,
              });
            }}
          />
          <div>
            <Label htmlFor="direct-retries">{translate('Maximum HTTP retries')}</Label>
            <Input
              id="direct-retries"
              type="number"
              min={0}
              max={5}
              step={1}
              value={draft.maxRetries ?? ''}
              placeholder={translate('Default: 2')}
              onChange={(event) =>
                update({
                  maxRetries: event.target.value === '' ? undefined : Number(event.target.value),
                })
              }
            />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => update({ enabled: event.target.checked })}
            />
            {translate('Enabled')}
          </label>
          <div className="flex flex-wrap gap-3">
            <Label htmlFor="direct-auth">{translate('Authentication')}</Label>
            <select
              id="direct-auth"
              className={selectStyle}
              value={draft.auth.type}
              onChange={(event) =>
                update({
                  auth:
                    event.target.value === 'none'
                      ? { type: 'none' }
                      : event.target.value === 'env'
                        ? { type: 'env', variableName: 'OPENAI_API_KEY' }
                        : { type: 'credentials', credentialId: draft.id },
                })
              }
            >
              <option value="credentials">{translate('Stored API key')}</option>
              <option value="env">{translate('Server environment variable')}</option>
              <option value="none">{translate('No authentication')}</option>
            </select>
          </div>
          {draft.auth.type === 'env' && (
            <div>
              <Label htmlFor="direct-env">{translate('Server variable name')}</Label>
              <Input
                id="direct-env"
                value={draft.auth.variableName}
                onChange={(event) =>
                  update({ auth: { type: 'env', variableName: event.target.value } })
                }
              />
            </div>
          )}
          {draft.auth.type === 'credentials' && (
            <div className="space-y-2">
              <Label htmlFor="direct-key">
                {translate('New API key (leave blank to keep existing)')}
              </Label>
              <Input
                id="direct-key"
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setClearKey(false);
                }}
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={clearKey}
                  onChange={(event) => {
                    setClearKey(event.target.checked);
                    setApiKey('');
                  }}
                />
                {translate('Explicitly clear stored key')}
              </label>
            </div>
          )}
          <div className="space-y-3">
            <h3 className="font-medium">{translate('Models (exact API IDs)')}</h3>
            {draft.models.map((model, index) => (
              <div key={index} className="space-y-2 rounded-md border p-3">
                <Label htmlFor={`direct-model-${index}`}>{translate('Model ID')}</Label>
                <Input
                  id={`direct-model-${index}`}
                  value={model.id}
                  onChange={(event) =>
                    update({
                      models: draft.models.map((item, i) =>
                        i === index ? { ...item, id: event.target.value } : item
                      ),
                    })
                  }
                />
                <Label htmlFor={`direct-label-${index}`}>{translate('Display name')}</Label>
                <Input
                  id={`direct-label-${index}`}
                  value={model.displayName}
                  onChange={(event) =>
                    update({
                      models: draft.models.map((item, i) =>
                        i === index ? { ...item, displayName: event.target.value } : item
                      ),
                    })
                  }
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  {(['contextWindow', 'maxOutputTokens'] as const).map((field) => (
                    <div key={field}>
                      <Label htmlFor={`direct-${field}-${index}`}>
                        {field === 'contextWindow'
                          ? translate('Context window (optional)')
                          : translate('Max output tokens (optional)')}
                      </Label>
                      <Input
                        id={`direct-${field}-${index}`}
                        type="number"
                        min={1}
                        step={1}
                        value={model[field] ?? ''}
                        onChange={(event) =>
                          update({
                            models: draft.models.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    [field]:
                                      event.target.value === ''
                                        ? undefined
                                        : Number(event.target.value),
                                  }
                                : item
                            ),
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-4">
                  {(['tools', 'streaming', 'structuredOutput'] as const).map((capability) => (
                    <label key={capability} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!model.capabilities[capability]}
                        onChange={(event) =>
                          update({
                            models: draft.models.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    capabilities: {
                                      ...item.capabilities,
                                      [capability]: event.target.checked,
                                    },
                                  }
                                : item
                            ),
                          })
                        }
                      />
                      {capability}
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const result = await api.test(draft.id, model.id);
                        if (!result.success) throw new Error(result.error || 'Connection failed');
                        setMessage(translate('Text connection verified.'));
                      })
                    }
                  >
                    {translate('Test text')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || !model.capabilities.tools}
                    onClick={() =>
                      void action(async () => {
                        const result = await api.test(draft.id, model.id, true);
                        if (!result.success) throw new Error(result.error || 'Tool calling failed');
                        setMessage(
                          translate('Tool calling verified. No local tools were executed.')
                        );
                      })
                    }
                  >
                    {translate('Test tools')}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => update({ models: draft.models.filter((_, i) => i !== index) })}
                  >
                    {translate('Remove model')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                update({
                  models: [
                    ...draft.models,
                    { id: '', displayName: '', capabilities: { tools: false, streaming: false } },
                  ],
                })
              }
            >
              {translate('Add model manually')}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await api.models(draft.id);
                  if (!result.success) throw new Error(result.error || 'Catalog unavailable');
                  setCatalog(result.models ?? []);
                  setMessage(
                    translate(
                      'Discovery does not establish capabilities. Enable them explicitly, then save and test.'
                    )
                  );
                })
              }
            >
              {translate('Fetch /models')}
            </Button>
          </div>
          {!!catalog.length && (
            <div>
              <Label htmlFor="direct-catalog">{translate('Discovered models')}</Label>
              <select
                id="direct-catalog"
                className={`${selectStyle} w-full`}
                value=""
                onChange={(event) => {
                  const id = event.target.value;
                  if (id && !draft.models.some((model) => model.id === id))
                    update({
                      models: [
                        ...draft.models,
                        { id, displayName: id, capabilities: { tools: false, streaming: false } },
                      ],
                    });
                }}
              >
                <option value="">{translate('Choose a model to add')}</option>
                {catalog.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {translate(
              'Save before discovery/tests. Tests send a small paid API request to the saved endpoint. Responses, images, reasoning options, MCP and subagents are not supported yet.'
            )}
          </p>
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  parseModelTimeoutSettings({
                    ...draft.timeouts,
                    ...(draft.timeoutMs !== undefined && { requestTimeoutMs: draft.timeoutMs }),
                  });
                  refresh(await api.save(draft, apiKey || undefined, clearKey || undefined));
                  setApiKey('');
                  setClearKey(false);
                  setMessage(translate('Endpoint saved. Key values are never returned.'));
                })
              }
            >
              {translate('Save endpoint')}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setApiKey('');
              }}
            >
              {translate('Close')}
            </Button>
          </div>
        </fieldset>
      )}
      <p className="text-sm text-muted-foreground">
        {translate('Execution and access are configured in')}{' '}
        <a className="underline" href="/settings?view=execution-environment">
          {translate('Execution Environment')}
        </a>
        {translate(
          ', with optional project overrides. Legacy Direct settings are retained for existing runs, not automatically upgraded.'
        )}
      </p>
    </div>
  );
}
