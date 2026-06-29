# FR-P3 · Stream-Event-Markierung + Filter

**FeatureRequest** · Prio 3 · Quelle: Feedback exrelax (Fleetplanner-Feedback-Ticket)

## Dependency-Block

- **Hängt ab von:** — (eigenständig; nutzt bestehende Op-Create/Edit + Discord-Event-Flow)
- **Blockiert:** Phase B (Streamer-Link-Verlinkung) baut darauf auf.
- **Berührt:** `Operation`-Schema, Contracts, `apiV1`, `operations.ts`, `presenters.ts`,
  `discord.ts`, SPA (`opForm`, `client`, `WizardPage`, `EckdatenForm`, `Icons`, `OpDetailPage`,
  `CalendarPage`).

## Problem

Manche Spieler werden von Stream-Events abgeschreckt / können sich nicht entspannen. Ein
Stream-Event ist aktuell nicht von normalen Operations unterscheidbar.

## Phase A (MVP) — dieser Change

- Operation als **Stream-Event** markierbar (`isStreamEvent`, default false).
- Eigenes Icon/Badge in **Liste**, **Detailansicht** und **Discord-Event** (🔴-Präfix im
  Event-Namen).
- **Filter** in der Operationen-Übersicht: Alle / nur Stream-Events / Stream-Events ausblenden.

## Phase B — Streamer-Links (Design, Entscheidungen gelockt 2026-06-29)

Neues Model `OperationStream { id, operationId, userId?, platform (twitch|youtube|vdo_ninja|
other), url, label, createdAt }` (eigene Tabelle, nicht `OperationResourceLink`, wegen
userId + Plattform + späterem Live-Status). vdo.ninja = Multi-Stream/Co-Streamer.

**Entscheidungen (User):**
- **Self-Service:** jeder Teilnehmer mit Op-Zugriff trägt seinen eigenen Stream ein
  („Ich streame das" → Plattform + URL). Löschen: Eintrags-Owner **oder** Operator (Moderation).
- **B1 = nur Links** (kein Live-Status). Twitch/YT-Live-Check (B2) später, braucht Creds/Polling.
- **Discord-Embed-Verlinkung** = B3, später (B1 nur Web-Op).

**B1 Umsetzung:**
- Schema: `OperationStream` + Migration; Relationen auf `Operation` + `User`.
- Contracts: `OperationStreamSchema`, `OperationDetail.streams`, `AddStreamRequest{platform,url,label?}`
  (URL pro Plattform zod-validiert; other = https).
- API: `POST /operations/:id/streams` (requireOpRole crew = jeder mit Zugriff),
  `DELETE /operations/:id/streams/:streamId` (Owner oder fleetoperator). Erster Stream setzt
  optional `isStreamEvent=true`. Service `streams.ts` (Muster: `resourceLinks.ts`).
- SPA: `OpDetailPage` Sektion „STREAMS" (Plattform-Icon + Name + Ansehen-Button; „Ich streame
  das"-Form; eigenen Eintrag löschbar; Operator alle). Icons twitch/youtube/vdo.

**B2 — verworfen (User 2026-06-29):** Live-Status (Twitch Helix) bringt keinen Mehrwert; das
Feature ist nur „Flag dass gestreamt wird + optional Twitch-Link einpflegen + anzeigen" — das
deckt B1 ab. Code wurde wieder entfernt. **B3 (offen, bei Bedarf):** Streamer-Links im Discord-Embed.

## Status

✅ Phase A + B1 umgesetzt + deployed (2026-06-29): isStreamEvent-Flag (Twitch-Lila-Markierung)
+ optionale Streamer-Links (self-service) im Op-Detail. B2 (Live-Status) verworfen. B3 offen.
