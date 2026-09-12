---
name: ot-competitor-site-teardown
description: Teardown of a competitor marketing site into a reusable structure spec — page section flow, copy patterns, CTA/demo strategy, i18n reality — using curl+HTML-parsing when scrapers are blocked. Use when designing or positioning a product website against a named incumbent.
---

# Competitor Site Teardown

Produce a structure spec that a copywriter or site builder can implement without visiting the competitor's site. Research to sell: every finding ends in a "steal list" or a differentiator.

## Method

1. **Fetch live, don't quote from memory.** `curl -sL -A "Mozilla/5.0 ..." <url> -o /tmp/page.html` then parse locally. Home + pricing + one flagship product page minimum.
2. **Extract headings in document order** (H1–H4 with a regex over the HTML after stripping scripts/styles). Heading order IS the persuasion flow.
3. **Extract copy fragments** (text runs ≥25 chars between tags) for tone and claim patterns.
4. **Extract nav/footer link frequency** — the most-repeated link is where the site wants visitors to go (e.g. a competitor linking its demo page 7× on the home page is telling you demo-led selling wins).
5. **Verify i18n empirically:** check `lang=`, `hreflang`, and probe `/<lang>` URLs (404 test). Never assume a global vendor localizes — verify; absence is your differentiator.
6. **Verify pricing claims on the pricing page itself** (tiers, per-unit AI billing, add-ons). These become the comparison anchor for the open-source positioning.

## Output (write to the product knowledge-base, dated)

- Page architecture: nav, section-by-section flow (verified headings in order), pricing page anatomy.
- Copy patterns steal list: claim→number→CTA, friction removal inside CTAs, buyer-voice FAQ, category-level H1s.
- Demo/mockup presentation notes: what the competitor demos, how UI is shown.
- i18n reality + implication for the product's geo-language strategy.
- A differentiation list: what the competitor structurally cannot say (e.g. pricing-model attack, data residency, open source).

## Rules

- Cite only what the fetched HTML shows; mark anything unreachable (G2/review walls) as unverified — never quote secondhand.
- Numbers from competitor sites are snapshot facts — always date them; pricing changes.
- Feed findings into a requirements brief with a section-by-section spec for OUR site, not a loose observation list.
