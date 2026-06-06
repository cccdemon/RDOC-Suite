# Roadmap Tab — planned features, order, Discord feedback auto-ingest

**FeatureRequest — Priority 3** (scale 1 highest … 5 lowest)
**Status:** Plan, **NOT yet implemented**. Captured from roadmap dump 2026-06-06.

## Dependencies
- Complements the existing **/changelog** (past) — roadmap = forward-looking. Same UI pattern (`changelogPage` + `lib/changelog.ts` data array → mirror as `roadmapPage` + data, or render from the FR-P*/`ROADMAP.md` docs).
- Auto-ingest is the **reverse** of the existing feedback flow: today `sendDiscordChannelMessage` posts feedback tickets INTO a Discord channel (GUI-configurable). This feature READS a Discord channel back into Fleetplanner. Needs message-read access → either the Fleetplanner bot with `Read Message History` + a gateway/poll, or a webhook/relay.
- No hard dep on the partner-event FRs.

## Goal
A public "Roadmap" tab showing:
1. **Which features are planned** — the FR-P* backlog, ideally rendered from the docs/`ROADMAP.md` so there's one source.
2. **In which order** they'll be worked — priority + dependency order (P1 → P5, deps respected).
3. **Incoming bugs/suggestions auto-read from a Discord channel** — ingest the feedback channel messages, reformat them nicely (author, subject, body, timestamp), and surface as a triage list (and/or feed into the roadmap).

## Approach (sketch)
- **Roadmap render:** a `/roadmap` route (public) listing FRs with status (Plan / In progress / Done) + priority + deps. Source: parse the `FR-P*-*.md` headers, or a curated `lib/roadmap.ts` array kept in sync with `docs/ROADMAP.md`.
- **Discord ingest:**
  - Read the configured feedback channel (the same channel ID already stored in app settings). Fleetplanner bot needs `Read Message History`.
  - Mechanism options: (A) periodic poll via REST `GET /channels/{id}/messages?after=<lastId>` storing a cursor; (B) gateway client `messageCreate`. **Lean: REST poll** (no persistent gateway, fits stateless model; reuse the scheduler pattern).
  - Parse the App-feedback embeds (From / Subject / body — see the dump format) into a `FeedbackItem` table; dedupe by Discord message id; reformat for display.
  - Optional: tag/triage state (new / accepted / linked-to-FR / rejected) editable by superadmin.

## Open decisions
1. Roadmap source of truth: parse FR-P* docs at runtime vs a curated `lib/roadmap.ts`. (Lean: curated array synced from `ROADMAP.md` — simpler, decouples render from doc churn.)
2. Ingest read mechanism: REST poll (lean) vs gateway. Privacy: only ingest the dedicated feedback channel, never arbitrary channels.
3. Show raw ingested feedback publicly, or superadmin-only triage with curated public roadmap? (Lean: triage private, roadmap public.)
4. Relation to FeatureRequest docs: should accepted feedback auto-spawn an FR-P* stub? (Later.)

---
*Design doc only. Implement on explicit instruction, mergelog-first.*
