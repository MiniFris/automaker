import { translate, useUiLocale } from '@/lib/i18n';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCursorStatus } from '@/components/views/settings-view/hooks/use-cursor-status';
import { PassiveAuthenticationNotice } from './passive-authentication-notice';

/** Copying a command is not login and never starts authentication polling. */
export function CursorSetupPanel() {
  useUiLocale();
  const { status, isLoading, loadData, error } = useCursorStatus();
  const copyLogin = async () => {
    try {
      await navigator.clipboard.writeText('cursor-agent login');
      toast.info(translate('Login command copied! Paste in terminal to authenticate.'));
    } catch {
      toast.error(translate('Failed to copy command'));
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{translate('Cursor CLI Status')}</CardTitle>
        <CardDescription>
          {translate('CLI installation and authentication are separate checks.')}
        </CardDescription>
        <Button onClick={loadData} disabled={isLoading} data-testid="refresh-cursor-cli">
          {translate('Refresh')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert">{translate('Failed to read Cursor status.')}</p>}
        {status && (
          <>
            <p>
              {translate(status.installed ? 'CLI Installed' : 'Cursor CLI not found')}
              {status.version ? ` (${status.version})` : ''}
            </p>
            <PassiveAuthenticationNotice
              hasCredentialsHint={status.hasEnvApiKey}
              hasConfigFile={status.hasCredentialsFile}
            />
            {!status.installed && <code>curl https://cursor.com/install -fsS | bash</code>}
            <code className="block">cursor-agent login</code>
            <Button onClick={copyLogin}>{translate('Copy login command')}</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
