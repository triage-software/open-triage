---
name: ot-geo-i18n-strategy
description: Strategy and implementation requirements for a bilingual EN/PL marketing site with visitor-location-based language selection — URL structure, redirect rules, hreflang, per-locale proof. Use when building or reviewing a multi-language landing page.
---

# Geo-Language Strategy (EN/PL marketing sites)

Decide i18n BEFORE design. Retrofitting language routing into a finished landing page is the classic budget trap.

## Decisions to lock first

1. **URL structure:** default locale at `/` (for open-source/global audiences, that is EN); secondary locale in a path prefix (`/pl/`). No subdomains, no query params.
2. **Detection:** first visit only — `Accept-Language` header / `navigator.language`. If `pl-*` and no stored preference → redirect once to `/pl/` with a dismissible banner ("Pokazujemy polską wersję"). Server-side redirect preferred; client-only detection causes locale flicker.
3. **Never trap:** visible EN/PL toggle in the nav on every page; choice persisted in a cookie; switching preserves the current path.
4. **hreflang pair** on every page: `en` (self + alternate), `pl-PL`, `x-default` → EN. Both locale versions must be indexable (no JS-only swap).
5. **Localize proof, not just words:** each locale carries market-specific evidence — PL: PLN implementation pricing, EU data residency, local-market competitor language; EN: GitHub stars, self-host benchmark, HN-style credibility.
6. **Copy is written per locale, not translated:** brief the copywriter in the target market's own number-led language patterns (verified examples live in the competitor teardown), never translate EN idioms.

## Build requirements to hand the implementer

- Locale routing via the framework's native i18n (e.g. next-intl or i18n routing) from day 1; keys namespaced per page section.
- All strings in key files (en.json / pl.json); zero hard-coded copy in components — lint for it.
- Locale-aware formatting: PLN vs USD, date formats, thousands separators.
- Legal/trust pages (privacy, GDPR, data residency) exist in both locales — they are trust surfaces, not legal afterthoughts.

## Acceptance checks

- `/pl/` served with `lang="pl-PL"`, redirect happens exactly once, toggle escapes cleanly, hreflang validates, no untranslated strings (spot-check nav, footer, forms, error states).
