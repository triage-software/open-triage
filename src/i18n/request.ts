import {getRequestConfig} from 'next-intl/server';
import {cookies} from 'next/headers';

// ADR-0004: locale comes from the session (cookie `ot_locale` set at login),
// no [locale] URL segment in MVP. Fallback locale is `en`.
export const locales = ['en', 'pl'] as const;
export type Locale = (typeof locales)[number];

export default getRequestConfig(async () => {
  const store = await cookies();
  const requested = store.get('ot_locale')?.value;
  const locale: Locale = locales.includes(requested as Locale) ? (requested as Locale) : 'en';

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
