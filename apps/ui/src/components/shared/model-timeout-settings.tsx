import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_MODEL_TIMEOUTS,
  MAX_MODEL_TIMEOUT_MS,
  parseModelTimeoutSettings,
  type ModelTimeoutSettings,
  type ModelTimeoutProvider,
  PROVIDER_TIMEOUT_KEYS,
} from '@automaker/types';
import { getHttpApiClient } from '@/lib/http-api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const descriptions: Record<keyof ModelTimeoutSettings, [string, string]> = {
  requestTimeoutMs: [
    'Request timeout',
    'Whole Direct HTTP request, including streaming, or the Claude API timeout. An existing connection timeout takes precedence.',
  ],
  responseHeadersTimeoutMs: [
    'Response headers timeout',
    'Wait for Direct HTTP response headers. The whole-request deadline still applies.',
  ],
  modelDiscoveryTimeoutMs: [
    'Model discovery timeout',
    'Fetch /models, including the response body.',
  ],
  connectionTestTimeoutMs: [
    'Connection test timeout',
    'Direct text/tool checks and native Claude/Codex authentication probes. The Direct response-header deadline also applies.',
  ],
  agentTimeoutMs: [
    'Agent duration timeout',
    'Whole Direct agent run across all turns and tools. Unset retains legacy 300s / managed 900s, or existing agent limits.',
  ],
  toolTimeoutMs: [
    'Tool execution timeout',
    'Each Direct tool or shell command. Unset retains legacy 10s / managed 180s, or existing agent limits.',
  ],
  checkpointTimeoutMs: ['Checkpoint save timeout', 'Persist each Direct agent checkpoint.'],
  cliIdleTimeoutMs: [
    'CLI/SDK idle timeout',
    'Base no-output timeout. Existing reasoning multipliers (up to ×4) still apply. Remote SDK heartbeats count as output; native SDKs have no extra idle timer.',
  ],
  codexExtendedIdleTimeoutMs: [
    'Codex extended idle timeout',
    'Base idle timeout for native Codex xhigh queries, before the reasoning multiplier.',
  ],
  remoteProcessTimeoutMs: [
    'Remote process duration timeout',
    'Whole Docker/SSH CLI or SDK process, independent of output.',
  ],
  verificationTimeoutMs: [
    'Verification command timeout',
    'Each automatic Verify lint, test or build command.',
  ],
  pipelineTestTimeoutMs: [
    'Pipeline test wait timeout',
    'Waiting for a host test-runner session to complete during a pipeline.',
  ],
  commitMessageTimeoutMs: [
    'Commit message timeout',
    'Whole AI commit-message generation using this provider.',
  ],
  prDescriptionTimeoutMs: [
    'PR description timeout',
    'Whole AI pull-request description generation using this provider.',
  ],
  retryAfterMaxMs: [
    'Maximum Retry-After wait',
    'Accept this much server-requested delay. Longer waits are not retried; requests are never retried earlier than requested.',
  ],
  retryBackoffMaxMs: [
    'Maximum retry backoff',
    'Maximum exponential delay for retryable HTTP statuses, before any model output.',
  ],
};

export function ModelTimeoutFields({
  value,
  onChange,
  keys = Object.keys(DEFAULT_MODEL_TIMEOUTS) as Array<keyof ModelTimeoutSettings>,
  prefix,
  disabled = false,
  provider,
}: {
  value: ModelTimeoutSettings;
  onChange: (value: ModelTimeoutSettings) => void;
  keys?: readonly (keyof ModelTimeoutSettings)[];
  prefix: string;
  disabled?: boolean;
  provider?: ModelTimeoutProvider;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="font-medium">Timeouts (seconds)</legend>
      <p className="text-xs text-muted-foreground">
        Leave blank to use provider defaults. Connection overrides inherit when blank. Positive
        values only; 0 does not disable a deadline. When deadlines overlap, the earliest one
        applies.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {keys.map((key) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`${prefix}-${key}`}>{descriptions[key][0]} (seconds)</Label>
            <Input
              id={`${prefix}-${key}`}
              type="number"
              min={0.001}
              max={MAX_MODEL_TIMEOUT_MS / 1000}
              step={0.001}
              value={value[key] === undefined ? '' : value[key] / 1000}
              placeholder={`Inherit / default ${DEFAULT_MODEL_TIMEOUTS[key] / 1000}s`}
              onChange={(event) => {
                const next = { ...value };
                if (event.target.value === '') delete next[key];
                else next[key] = Math.round(Number(event.target.value) * 1000);
                onChange(next);
              }}
            />
            <p className="text-xs text-muted-foreground">
              {key === 'requestTimeoutMs' && provider === 'claude'
                ? 'Claude API request deadline. An existing Claude connection timeout takes precedence.'
                : key === 'connectionTestTimeoutMs' && provider && provider !== 'openai-compatible'
                  ? 'Authentication probe deadline for this provider.'
                  : key === 'cliIdleTimeoutMs' && provider === 'claude'
                    ? 'Remote Docker/SSH SDK no-output deadline, before reasoning multipliers. Heartbeats count as output; native Claude SDK has no extra idle timer.'
                    : descriptions[key][1]}
            </p>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export const MODEL_TIMEOUTS_QUERY_KEY = ['settings', 'model-timeouts'] as const;
type ProviderTimeoutProps = {
  provider: ModelTimeoutProvider;
  keys?: readonly (keyof ModelTimeoutSettings)[];
  title?: string;
};
export function ProviderModelTimeoutSettings(props: ProviderTimeoutProps) {
  return (
    <details key={props.provider} className="rounded-lg border p-4">
      <summary className="cursor-pointer font-semibold">
        {props.title ?? 'Provider timeouts'}
      </summary>
      <ProviderTimeoutEditor key={props.provider} {...props} />
    </details>
  );
}
function ProviderTimeoutEditor({
  provider,
  keys = PROVIDER_TIMEOUT_KEYS[provider],
}: ProviderTimeoutProps) {
  const cache = useQueryClient();
  const [draft, setDraft] = useState<ModelTimeoutSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: [...MODEL_TIMEOUTS_QUERY_KEY, provider],
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const result = await getHttpApiClient().modelTimeouts.getProvider(provider);
      if (!result.success || !result.timeouts)
        throw new Error(result.error || 'Cannot load model timeouts.');
      return result.timeouts;
    },
  });
  if (query.isPending) return <p>Loading model timeouts…</p>;
  if (query.error || !query.data) return <p role="alert">Unable to load model timeout settings.</p>;
  return (
    <section className="space-y-4 pt-4" aria-label="Provider timeout settings">
      <div>
        <p className="text-sm text-muted-foreground">
          Applies only to this provider. Clearing a field restores its built-in default.
          Connection-specific overrides take precedence. Changes apply to new requests.
        </p>
      </div>
      <ModelTimeoutFields
        value={draft ?? query.data}
        onChange={setDraft}
        keys={keys}
        provider={provider}
        prefix={'provider-timeout-' + provider}
        disabled={busy}
      />
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMessage('');
            try {
              const parsed = parseModelTimeoutSettings(
                draft ?? query.data,
                PROVIDER_TIMEOUT_KEYS[provider]
              );
              const result = await getHttpApiClient().modelTimeouts.saveProvider(provider, parsed);
              if (!result.success || !result.timeouts)
                throw new Error(result.error || 'Cannot save model timeouts.');
              cache.setQueryData([...MODEL_TIMEOUTS_QUERY_KEY, provider], result.timeouts);
              setDraft(null);
              setMessage('Model timeouts saved. Applied to new requests.');
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Cannot save model timeouts.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Save model timeouts
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            const next = { ...(draft ?? query.data) };
            for (const key of keys) delete next[key];
            setDraft(next);
          }}
        >
          Clear overrides
        </Button>
      </div>
    </section>
  );
}
