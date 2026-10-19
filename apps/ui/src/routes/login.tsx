import { useUiLocale } from '@/lib/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { LoginView } from '@/components/views/login-view';
import { LanguageSelector } from '@/components/shared/language-selector';

function LoginPage() {
  useUiLocale();
  return (
    <>
      <div className="fixed right-4 top-4 z-50">
        <LanguageSelector compact />
      </div>
      <LoginView />
    </>
  );
}

export const Route = createFileRoute('/login')({
  component: LoginPage,
});
