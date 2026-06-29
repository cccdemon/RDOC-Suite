# FR-P2 · Fleetplanner Light (Org-Operator vs. Operator-Light)

**FeatureRequest** · Prio 2 · Quelle: Feedback exrelax (Fleetplanner-Feedback-Ticket)
· Status: **Plan, kein Code** (Implementierung nur auf explizite Freigabe)

## Dependency-Block

- **Hängt ab von:** bestehendes Rollen-/Tenant-Modell (`GuildMembership.role`), Op-Create/Edit,
  Op-Ownership (`createdById` + `OperationLeader`), Discord-Event-Flow.
- **Baut auf / berührt FR:** Op-Visibility (`private/partners/public` — umgesetzt),
  Event-Distribution FR-P1, SquadLink-Deep-Link (CommandNet).
- **Blockiert:** nichts hartes; macht Ops „demokratischer" (jeder kann anlegen).

## Problem / Wunsch (Original-Feedback)

> Die aktuelle Operator-Rolle könnte zu einer **Org-Operator**-Rolle werden (gleiche Funktionen
> wie heute). Die **Operator-Rolle** wird eine **Light-Variante ohne Discord-Bot-Integration**, so
> dass **jeder Spieler Operations anlegen** kann, um über den **Deep-Link** Gruppen
> zusammenzustellen. Eine Operation kann als **Org-Operation** (nur Org-Operator) oder als normale
> **Operation** angelegt werden. Eine bereits angelegte Operation lässt sich in eine Org-Operation
> **umwandeln**, wenn der Org-Operator Bearbeiten-/Owner-Rechte hat. So kann jeder Spieler Ops
> erstellen, die sich **dynamisch von kleinen Events zu Org-Events** entwickeln.

## Ist-Zustand (Code, Stand 2026-06-29)

- Rollen pro Guild: `fleetoperator | crew` (`services/guilds.ts:9`, Rang fleetoperator 3 / crew 1).
  Kein `captain` im Code (CLAUDE.md erwähnt es, Schema kennt es nicht).
- **Op anlegen** hart auf `fleetoperator` (`routes/apiV1.ts:960`); SPA-Wizard blendet Nicht-
  Operatoren ganz aus (`WizardPage.tsx:38` + „KEINE BERECHTIGUNG").
- **Op bearbeiten / Status / löschen**: `requireFleetOperator(opId)` (`apiV1.ts:989/1037`),
  d.h. via `effectiveOpRole` muss man fleetoperator der Op-Guild sein.
- **Ownership existiert schon**: `Operation.createdById` + `OperationLeader`; `canApproveUnits`
  (`routes/api.ts:193`) = `fleetoperator || creator || leader`. Edit/Status nutzen das aber NICHT.
- **Discord-Rollout** an Status→open: `createScheduledEvent` + (bei partners/public)
  `distributeOperation` (`apiV1.ts:1046-1057`), plus `announce` (`apiV1.ts:1894`).

## Designentscheidung — Capability, NICHT neue Rolle

**Empfehlung: Approach A.** Das Rollen-Enum bleibt `fleetoperator | crew`. „Operator-Light" ist
**keine neue Rolle**, sondern die Fähigkeit *jedes Members*, eine Op anzulegen — die entstehende Op
ist dann ein **Op-Tier `personal`** (Light). „Org-Operator" = der heutige `fleetoperator`; nur er
legt `org`-Ops an bzw. stuft hoch.

Begründung:
- Feedback sagt „**jeder Spieler** kann anlegen" → das ist eine Capability, kein Zwischenrang.
- Ein neuer Rang (`operator` zwischen crew/fleetoperator) würde Rang-Funktion, Discord-Mapping,
  `setMembershipRole`, alle `requireGuildRole`-Stellen und die UI anfassen — viel Risiko, wenig
  Mehrwert. (Approach B unten als Alternative dokumentiert, aber nicht empfohlen.)

### Tier-Modell (Op-Ebene)

Neues Feld `Operation.tier: "personal" | "org"` (default `"org"` → alle Bestands-Ops bleiben org).

| | **Light-Op (`personal`)** | **Org-Op (`org`)** |
|---|---|---|
| Wer legt an | jeder Guild-Member (crew+) | nur `fleetoperator` |
| Verwalten (Edit/Needs/Seats/Status/Delete) | Ersteller + Leader + fleetoperator | fleetoperator (+ Ersteller/Leader) |
| Sichtbarkeit | `private` / `public` (Deep-Link) | `private` / `partners` / `public` |
| Discord Scheduled-Event | ❌ | ✅ |
| Partner-Distribution (FR-P1) | ❌ | ✅ |
| Channel-Announce | ❌ | ✅ |
| SquadLink-Voice-Deep-Link | ✅ (optional) | ✅ |
| Mission-Cover | ✅ | ✅ |

Gruppen-Sammeln im Light-Modus = teilbare Op-URL (`/ops/:id`) + optional SquadLink-Voice-Link.

### Berechtigungs-Helper (neu)

`canManageOp(op, userGuildRole, userId)`:
- `fleetoperator` der Op-Guild → **voll** (inkl. Org-Aktionen).
- `createdById === userId` **oder** Leader → **Light-Verwaltung** (Edit/Needs/Seats/Status
  open|lock|complete|cancel, Delete) — **aber keine** Org-/Discord-Aktionen.
- sonst → nein.

`canDoOrgAction(op, userGuildRole)` = `userGuildRole === "fleetoperator"` (für Discord-Event,
Distribution, Announce, Tier-Upgrade, Anlegen als org).

## Umzusetzende Änderungen

### Schema / Migration
- `Operation.tier String @default("org")` (+ Migration `ALTER TABLE … ADD COLUMN … DEFAULT 'org'`).
- Optional Phase 3: `Guild.allowLightOps Boolean @default(true)` (Kill-Switch pro Guild gegen Spam).

### Contracts (`packages/fleetplanner-contracts`)
- `OperationSummary`/`Detail`: `tier` + abgeleitete Flags (`canManage` existiert in Detail).
- `CreateOperationRequest`: optional `tier` (nur fleetoperator darf `org` setzen; sonst serverseitig
  auf `personal` erzwungen). Visibility-Enum für Light serverseitig auf `private|public` begrenzen.
- Neuer `ConvertOperationTierRequest` (`tier: "org" | "personal"`).

### API (`apps/fleetplanner`)
- **Create-Gate aufweichen** (`apiV1.ts:953`): statt `role !== "fleetoperator" → 403` nur noch
  **Mitgliedschaft** verlangen. crew → `tier=personal`, Visibility clampen, Org-Felder ignorieren.
  fleetoperator → darf `tier=org` + alle Visibilities.
- **Edit/Status/Delete** (`apiV1.ts:989/1037` + delete): `requireFleetOperator` → `canManageOp`.
  Org-spezifische Seiteneffekte bleiben hinter `canDoOrgAction` + `tier==="org"`.
- **Discord-Seiteneffekte** (`apiV1.ts:1046-1057`, edit-sync, `announce` 1894): zusätzlich
  `op.tier === "org"` gaten. Light-Op → nie `createScheduledEvent`/`distributeOperation`/announce.
- **Neuer Endpoint** `POST /api/v1/operations/:id/tier` — Upgrade `personal→org` (nur fleetoperator
  mit `canManageOp`); beim Upgrade einer bereits offenen Op das Discord-Event nacherzeugen.
  Downgrade `org→personal` optional (Discord-Event abbauen).
- `effectiveOpRole`/`canApproveUnits` bleiben; Edit-Pfad nutzt jetzt denselben creator-aware Check.

### SPA (`apps/fleetplanner-web`)
- **WizardPage**: nicht mehr auf fleetoperator-Guilds beschränken — jeder Member sieht „Neue
  Operation". Guild-Select = alle Memberships. Tier-Auswahl (Light/Org) nur sichtbar wenn im
  gewählten Guild fleetoperator; sonst implizit Light + Hinweis „ohne Discord, per Link teilen".
  Org-only Wizard-Teile (Announce/Discord) nur bei Org.
- **OpDetailPage / Operator-Konsole**: Light-Badge; Org-only Controls (Voice-Channel-Move,
  Announce, Distribution) ausblenden bei `tier=personal`; „Zur Org-Op hochstufen"-Button für
  fleetoperator. „Teilen"-Box (Op-URL kopieren) für Light-Ops prominent.
- **CalendarPage**: optionaler Filter Light/Org (analog Stream-Filter), kleines Badge.

### Discord
- Keine neuen Bot-Permissions. Light-Ops berühren den Bot nicht.

## Phasen

1. **Phase 1 (Kern):** `tier`-Feld + Create-Gate öffnen + `canManageOp` + Discord-Gating +
   Wizard für alle + Light-Badge. → jeder kann Light-Ops anlegen/verwalten/teilen.
2. **Phase 2 (Upgrade):** Tier-Convert-Endpoint + UI „hochstufen" (+ Discord-Event nacherzeugen).
3. **Phase 3 (Guard, optional):** Guild-Kill-Switch `allowLightOps`, evtl. Quota „max offene
   Light-Ops pro crew-Member", Aufräum-Policy für verwaiste Light-Ops.

## Entscheidungen (User, 2026-06-29 — gelockt)

1. **Light-Op-Sichtbarkeit:** ✅ **nur `private` + `public`**. `partners` bleibt Org-Ops vorbehalten
   (Partner-Cross-Post = Discord = org). Visibility serverseitig für `tier=personal` clampen.
2. **Wer darf Light anlegen:** ✅ **jeder Guild-Member, default an.** Kill-Switch `allowLightOps`
   pro Guild erst in **Phase 3** (nicht Phase 1).
3. **Tier-Umwandlung:** ✅ **nur Upgrade `personal→org`** (nur fleetoperator; Discord-Event wird
   beim Upgrade einer offenen Op nacherzeugt). **Kein Downgrade** org→personal.
4. **Spam/Quota:** Phase 3, erst beobachten (kein Limit in Phase 1).
5. **Listen-Sichtbarkeit:** `private` Light = nur Ersteller/Eingeladene + per Link; `public` Light =
   in der Guild-Liste.

**Implementierung:** zurückgestellt — nur Plan. Bauen auf späteren expliziten Befehl
(Start = Phase 1).

## Alternative (NICHT empfohlen) — Approach B: neuer Rang

Neuer per-Guild-Rang `operator` (Rang 2, zwischen crew/fleetoperator). Müsste anfassen:
`ROLE_RANK` (guilds.ts + middleware.ts), `mapDiscordRole` (neues Discord-Role-Mapping
`operatorRoleId`), `setMembershipRole`, alle `requireGuildRole`/`requireFleetOperator`-Stellen,
Rollen-Switch-UI. Höheres Risiko, und trifft den Wunsch („jeder Spieler") schlechter als das
Tier-Modell. Nur wählen, falls Light-Anlegen doch an eine vergebene Rolle gebunden sein soll.

## Out of scope

- Neue Discord-Rollen/Bots.
- Cross-Guild-Light-Ops.
- Monetarisierung/Limits jenseits eines einfachen Kill-Switches.
