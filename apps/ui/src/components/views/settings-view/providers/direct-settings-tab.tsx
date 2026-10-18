import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { OpenAICompatibleEndpoint } from '@automaker/types';
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
      setMessage(failure instanceof Error ? failure.message : 'Request failed');
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

  if (isLoading) return <p>Loading direct endpoints…</p>;
  if (error || !data) return <p role="alert">Unable to load direct endpoint settings.</p>;
  return (
    <div className="space-y-6" data-testid="direct-provider-settings">
      <div>
        <h2 className="text-lg font-semibold">OpenAI-compatible endpoints</h2>
        <p className="text-sm text-muted-foreground">
          Connect directly without an agent CLI. Chat Completions only; tool calling must be
          supported by your model. API prefixes such as /v1 are not added automatically. Keys stay
          on the server.
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
                {endpoint.enabled ? 'Enabled' : 'Disabled'} · {endpoint.models.length} models ·{' '}
                {endpoint.auth.type === 'none'
                  ? 'No key required'
                  : keyConfigured
                    ? 'Key configured'
                    : 'Key missing'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" disabled={busy} onClick={() => edit(endpoint)}>
                Edit
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove endpoint “${endpoint.name}”? Existing selections will fail until you choose another endpoint. Stored credentials are retained.`
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
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button variant="outline" disabled={busy} onClick={() => edit(freshEndpoint())}>
        Add direct endpoint
      </Button>
      {draft && (
        <fieldset
          disabled={busy}
          className="space-y-4 rounded-lg border p-4"
          data-testid="direct-endpoint-editor"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="direct-name">Name</Label>
              <Input
                id="direct-name"
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="direct-url">API base URL</Label>
              <Input
                id="direct-url"
                value={draft.baseUrl}
                onChange={(event) => update({ baseUrl: event.target.value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="direct-protocol">Protocol</Label>
            <select
              id="direct-protocol"
              className={selectStyle}
              value={draft.protocol}
              onChange={(event) =>
                update({ protocol: event.target.value as OpenAICompatibleEndpoint['protocol'] })
              }
            >
              <option value="chat-completions">Chat Completions</option>
              <option value="responses" disabled>
                Responses (not implemented)
              </option>
            </select>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => update({ enabled: event.target.checked })}
            />
            Enabled
          </label>
          <div className="flex flex-wrap gap-3">
            <Label htmlFor="direct-auth">Authentication</Label>
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
              <option value="credentials">Stored API key</option>
              <option value="env">Server environment variable</option>
              <option value="none">No authentication</option>
            </select>
          </div>
          {draft.auth.type === 'env' && (
            <div>
              <Label htmlFor="direct-env">Server variable name</Label>
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
              <Label htmlFor="direct-key">New API key (leave blank to keep existing)</Label>
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
                Explicitly clear stored key
              </label>
            </div>
          )}
          <div className="space-y-3">
            <h3 className="font-medium">Models (exact API IDs)</h3>
            {draft.models.map((model, index) => (
              <div key={index} className="space-y-2 rounded-md border p-3">
                <Label htmlFor={`direct-model-${index}`}>Model ID</Label>
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
                <Label htmlFor={`direct-label-${index}`}>Display name</Label>
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
                          ? 'Context window (optional)'
                          : 'Max output tokens (optional)'}
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
                        setMessage('Text connection verified.');
                      })
                    }
                  >
                    Test text
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || !model.capabilities.tools}
                    onClick={() =>
                      void action(async () => {
                        const result = await api.test(draft.id, model.id, true);
                        if (!result.success) throw new Error(result.error || 'Tool calling failed');
                        setMessage('Tool calling verified. No local tools were executed.');
                      })
                    }
                  >
                    Test tools
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => update({ models: draft.models.filter((_, i) => i !== index) })}
                  >
                    Remove model
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
              Add model manually
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
                    'Discovery does not establish capabilities. Enable them explicitly, then save and test.'
                  );
                })
              }
            >
              Fetch /models
            </Button>
          </div>
          {!!catalog.length && (
            <div>
              <Label htmlFor="direct-catalog">Discovered models</Label>
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
                <option value="">Choose a model to add</option>
                {catalog.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Save before discovery/tests. Tests send a small paid API request to the saved endpoint.
            Responses, images, reasoning options, MCP and subagents are not supported yet.
          </p>
          <div className="flex gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  refresh(await api.save(draft, apiKey || undefined, clearKey || undefined));
                  setApiKey('');
                  setClearKey(false);
                  setMessage('Endpoint saved. Key values are never returned.');
                })
              }
            >
              Save endpoint
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setApiKey('');
              }}
            >
              Close
            </Button>
          </div>
        </fieldset>
      )}
      <p className="text-sm text-muted-foreground">
        Execution and access are configured in{' '}
        <a className="underline" href="/settings?view=execution-environment">
          Execution Environment
        </a>
        , with optional project overrides. Legacy Direct settings are retained for existing runs,
        not automatically upgraded.
      </p>
    </div>
  );
}
