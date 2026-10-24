import { useState } from 'react';
import { getHttpApiClient } from '@/lib/http-api-client';
import { translate, useUiLocale } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';

export function GeminiCredentialsForm({
  configured,
  onChanged,
}: {
  configured: boolean;
  onChanged: () => void | Promise<void>;
}) {
  useUiLocale();
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const change = async (operation: 'store' | 'delete') => {
    if (busy || (operation === 'store' && !apiKey.trim())) return;
    setBusy(true);
    try {
      const setup = getHttpApiClient().setup;
      const result =
        operation === 'store'
          ? await setup.storeApiKey('google', apiKey.trim())
          : await setup.deleteApiKey('google');
      if (!result.success) return;
      setApiKey('');
      await onChanged();
      toast.success(
        translate(
          operation === 'store'
            ? 'API key saved; authentication not checked.'
            : 'API key deleted from this application.'
        )
      );
    } catch {
      toast.error(translate('Failed to change API key'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <Label htmlFor="gemini-application-key">{translate('Google API Key')}</Label>
      <Input
        id="gemini-application-key"
        type="password"
        aria-label="Gemini API key"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        autoComplete="off"
      />
      <p className="text-xs text-muted-foreground">
        {translate('This key is stored in the backend application, not verified with Google.')}
      </p>
      <a
        href="https://aistudio.google.com/apikey"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-brand-500 hover:underline"
      >
        {translate('Get an API key from Google AI Studio')}
      </a>
      <div className="flex gap-2">
        <Button onClick={() => void change('store')} disabled={busy || !apiKey.trim()}>
          {busy ? <Spinner size="sm" /> : translate('Save API Key')}
        </Button>
        {configured && (
          <Button variant="outline" onClick={() => void change('delete')} disabled={busy}>
            {translate('Delete API key')}
          </Button>
        )}
      </div>
    </div>
  );
}
