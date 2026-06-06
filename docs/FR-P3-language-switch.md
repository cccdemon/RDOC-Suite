# Language Switch (i18n) — one preference for Fleetplanner + Companion + MissionCover

**FeatureRequest — Priority 3** (scale 1 highest … 5 lowest) — *prio adjustable; large/phased.*
**Status:** Plan, **NOT yet implemented**. Captured 2026-06-07.

## Dependencies
- **Hängt an:** nichts hartes. Braucht das `User`-Modell (Profil) im Fleetplanner als Quelle der Wahrheit.
- **Blockiert:** nichts.
- **Quer:** mergelog-first; Discord IDs als String; Inputs Zod-validieren; Companion baut nur lokal (Windows).

## Goal
One language preference per **user**, set once in the profile (GUI), applied everywhere:
**Fleetplanner** (SSR web), **Companion** (Tauri/React), **MissionCover** (render engine).
Single source of truth so the user never sets it three times.

**Languages:** `de`, `en` (en-GB/international), `en-US`, `fr`, `es`.
- `en` vs `en-US`: mostly spelling + date/number/“color/colour” + 12h/24h. Share one base `en`
  dictionary with a thin `en-US` override layer rather than a full second copy.
- Map request labels → BCP-47: DE→`de`, EN→`en`, EN_US→`en-US`, FR→`fr`, SP→`es`.

## Single source of truth
- **`User.locale String @default("de")`** (Fleetplanner Postgres). Validated against the allowed set.
- The profile page gets a **language `<select>`** writing `User.locale`.
- Consumers:
  - **Fleetplanner** reads `ctx.user.locale` server-side per request → renders in that locale.
    Logged-out: `Accept-Language` header → nearest allowed, else `de`.
  - **Companion** already authenticates against the Fleetplanner/Bridge → fetch `locale` on
    login (extend an existing `/api/companion/*` or `/suite/capabilities` response) + cache in
    the settings store; re-fetch on reconnect. No separate companion-side switch (one switch only).
  - **MissionCover**: rendered per op by the service. Cover language = **op creator’s locale**
    (passed in the render payload) — see open decision 1.

## Per-surface approach
### Fleetplanner (Fastify SSR) — the big one
- Strings are currently inline in `apps/fleetplanner/src/web/pages.ts` (thousands, mixed DE/EN).
  Introduce `t(key, locale, vars?)` + per-locale JSON dictionaries (`src/i18n/<locale>.json`),
  `en` as the key base. Lazy-load dicts at boot.
- **Phased extraction** (don’t boil the ocean): translate the highest-traffic surfaces first
  (nav, home, player join page, wizard, manage tabs, profile), then the long tail. Untranslated
  keys fall back to `en`.
- Date/number/relative-time already partly handled via `lib/timezone.ts` + `Intl`; route them
  through the active locale.

### Companion (Tauri + React)
- Add `react-i18next` (or a tiny custom hook) + the same 5 dictionaries (shared JSON, copied or a
  small `@rdoc-suite/i18n` package). Init locale from the fetched `User.locale`.

### MissionCover (engine, React)
- Engine already ships i18n DE/EN (per FR-P4 §1). Extend to all 5 locales; the service injects the
  chosen locale into the engine config at render time (alongside the existing prefill).

## Optional shared package
`packages/i18n` holding the 5 dictionaries + `t()` so Fleetplanner, Companion and the MissionCover
engine consume one source. Avoids three drifting copies. (Engine builds standalone, so it may need
the dicts copied in at build time rather than imported.)

## Build order
1. `User.locale` column + migration + profile language switch + Zod validation.
2. Fleetplanner i18n infra (`t()` + dicts, `en` base) + locale resolution (user → Accept-Language → de);
   translate the high-traffic pages first.
3. Companion: fetch locale on login + react-i18next + dicts.
4. MissionCover: extend engine i18n to 5 locales + service passes locale in the render payload.
5. (Optional) extract dictionaries into `packages/i18n` once all three consume them.

## Open decisions
1. **Cover language source** — op creator’s locale (proposed) vs guild default vs per-cover override?
   A cover is one shared image per op, so a single language must be chosen.
2. **Translation source** — hand-authored dicts only, or seed via machine translation then review?
   SC-specific terms (ship roles, “Command Net”, “Global Radio”) must stay consistent — needs a glossary.
3. **en-US scope** — spelling/format overrides only, or full copy? (Proposed: thin override layer.)
4. **Companion offline** — last fetched locale cached; no live switch in the companion UI (one switch rule).

---
*Design doc only. Implement on explicit instruction, mergelog-first. Effort is large (Fleetplanner
string extraction dominates) — expect to ship in phases per build order.*
