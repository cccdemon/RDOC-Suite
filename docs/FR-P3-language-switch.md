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

## Decisions (2026-06-07)
1. **Cover language = the op creator’s locale.** ✓ Passed in the MissionCover render payload.
2. **Proper names / SC-specific terms stay English — never translated.** Ship names, ship roles,
   and RDOC voice terms (“Command Net”, “Global Radio Net”) are eigennames → keep their English
   form in every locale. Maintain a small **do-not-translate glossary** so dictionaries leave these
   tokens intact (and translators don’t localize them).
3. **en-US = thin override layer on the `en` base** (spelling + date/number/12h formats only), not
   a full second copy. ✓
4. **Companion: no separate switch** — caches the last fetched `User.locale`; one switch only (the
   profile). Live re-fetch on reconnect.

**Prio:** P3 — scheduled. Build in phases per the build order; no code yet.

---
*Design doc only. Implement on explicit instruction, mergelog-first. Effort is large (Fleetplanner
string extraction dominates) — expect to ship in phases per build order.*
