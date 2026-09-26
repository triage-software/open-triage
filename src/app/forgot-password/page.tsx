import { getLocale, getTranslations } from 'next-intl/server';
import { PasswordResetCard } from '@/components/password-reset-card';
import { LanguageToggle } from '@/components/auth-chrome';
import { TriageMark } from '@/components/ui';

export default async function ForgotPasswordPage() {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('auth')]);
  return (
    <main className="auth-page">
      <div className="auth-brand">
        <span className="auth-mark" aria-hidden="true">
          <TriageMark size={24} />
        </span>
        <strong>open<span>·</span>triage</strong>
        <p>{t('tagline')}</p>
      </div>
      <div className="auth-panel">
        <LanguageToggle current={locale} />
        <PasswordResetCard mode="request" />
      </div>
    </main>
  );
}
