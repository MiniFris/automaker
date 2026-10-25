import { translate } from '@/lib/i18n';
import { useUiLocale } from '@/lib/i18n';
import { AlertCircle } from 'lucide-react';

interface SecurityNoticeProps {
  title?: string;
  message?: string;
}

export function SecurityNotice({
  title = translate('Security Notice'),
  message = translate(
    'Saved keys are stored unencrypted in the backend private credentials file. Protect backend and browser data, and never commit credentials to version control.'
  ),
}: SecurityNoticeProps) {
  useUiLocale();
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
      <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" />
      <div className="text-sm">
        <p className="font-medium text-yellow-500">{title}</p>
        <p className="text-yellow-500/80 text-xs mt-1">{message}</p>
      </div>
    </div>
  );
}
