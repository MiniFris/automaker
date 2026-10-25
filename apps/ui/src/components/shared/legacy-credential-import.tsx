import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getHttpApiClient } from '@/lib/http-api-client';
import { getItem } from '@/lib/storage';
import { translate, useUiLocale } from '@/lib/i18n';
import {
  inspectLegacyCredentials,
  LEGACY_CREDENTIAL_PROVIDERS,
  type LegacyCredentialProvider,
} from '@/lib/legacy-credential-import';

export function LegacyCredentialImport({
  onImported,
}: {
  onImported?: () => void | Promise<void>;
}) {
  useUiLocale();
  const candidates = useRef<Partial<Record<LegacyCredentialProvider, string>>>({});
  const busy = useRef(false);
  const [providers, setProviders] = useState<LegacyCredentialProvider[] | null>(null);
  const [imported, setImported] = useState<LegacyCredentialProvider[]>([]);
  const [pending, setPending] = useState<LegacyCredentialProvider>();
  useEffect(
    () => () => {
      candidates.current = {};
    },
    []
  );
  const inspect = () => {
    if (busy.current) return;
    try {
      candidates.current = inspectLegacyCredentials(getItem('automaker-storage'));
      setProviders(
        LEGACY_CREDENTIAL_PROVIDERS.filter((provider) => !!candidates.current[provider])
      );
      setImported([]);
    } catch {
      candidates.current = {};
      setProviders([]);
      toast.error(
        translate('Legacy credentials could not be inspected. Use manual credential entry.')
      );
    }
  };
  const importKey = async (provider: LegacyCredentialProvider) => {
    const key = candidates.current[provider];
    if (!key || busy.current) return;
    busy.current = true;
    setPending(provider);
    let committed = false;
    try {
      const result = await getHttpApiClient().setup.storeApiKey(provider, key);
      if (!result.success) return;
      committed = true;
      delete candidates.current[provider];
      setImported((previous) => [...previous, provider]);
      toast.success(translate('Legacy key imported; authentication not checked.'));
      await onImported?.();
    } catch {
      toast.error(
        translate(
          committed ? 'Key imported, but status refresh failed.' : 'Failed to import legacy key.'
        )
      );
    } finally {
      busy.current = false;
      setPending(undefined);
    }
  };
  return (
    <section
      className="space-y-3 rounded-lg border border-border p-4"
      aria-label={translate('Legacy browser credential import')}
    >
      <h3 className="font-medium">{translate('Legacy browser credential import')}</h3>
      <p className="text-sm text-muted-foreground">
        {translate(
          'Inspect old browser keys, then confirm each import for this backend. An import may replace a backend key; it does not verify authentication. The original browser backup is not changed.'
        )}
      </p>
      <Button variant="outline" onClick={inspect} disabled={!!pending}>
        {translate('Inspect legacy browser keys')}
      </Button>
      {providers?.length === 0 && (
        <p className="text-sm">{translate('No supported legacy key candidates found.')}</p>
      )}
      {providers?.map((provider) => (
        <div className="flex items-center justify-between gap-3" key={provider}>
          <span>{provider}</span>
          {imported.includes(provider) ? (
            <span className="text-sm">{translate('Imported; authentication not checked')}</span>
          ) : (
            <Button
              variant="outline"
              disabled={!!pending}
              onClick={() => void importKey(provider)}
              aria-label={translate('Import legacy {provider} key', { provider })}
            >
              {pending === provider
                ? translate('Importing...')
                : translate('Import legacy {provider} key', { provider })}
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
