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

## Phase B (verschoben) — nicht in diesem Change

- Direkte Twitch-/YouTube-Verlinkung der Streamer in der Operation.
- Multi-Stream: vdo.ninja-URLs der Co-Streamer hinterlegen.
- Eigene Tabelle/Relation `OperationStream` (userId + Plattform + URL) statt nur Boolean.

## Status

⏳ Phase A in Arbeit (branch `feat/stream-event`, 2026-06-29). Phase B Plan, kein Code.
