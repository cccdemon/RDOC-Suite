# Polls / Umfragen — guild-, partner- & öffentlich-scoped Abstimmungen

**FeatureRequest — Priority 3** (scale 1 highest … 5 lowest)
**Status:** **Plan, kein Code.** Erstellt 2026-06-15.
**Requested by:** User — *"Ein Modul welches Umfragen zulässt. Nicht Discord, sondern für einen
Discord oder die Partner oder Open, ähnlich den Operationen. Standardfeatures: Mehrfachauswahl etc."*

## Dependencies
- **Hängt an:** dem **Operations-Sichtbarkeitsmodell** — `visibility: private | partners | public`
  (`Operation.visibility`) + `GuildPartnership`-Föderation. Polls erben dieselbe Tenant-/Partner-
  Logik (eigene Guild, alle aktiven Partner-Guilds, oder öffentlich). Nutzt `GuildMembership`
  (Mitglieder), `User`/`UserIdentity` (Wähler-Identität), Session-Auth + CSRF wie `/api/v1`.
- **Blockiert:** nichts.
- **Verwandt:** [archiv/FR-P3-roadmap-tab.md](archiv/FR-P3-roadmap-tab.md) (öffentliche, schreibgeschützte
  Listen-Seite als UI-Muster), [archiv/opus-tennant-architecture.md](archiv/opus-tennant-architecture.md)
  (Visibility-/Partnership-Design). **Bewusst NICHT** Discord-native Polls — eigenes Modul im Fleetplanner.
- **Quer:** Mergelog-first; Discord-IDs als String; Zod an der Boundary; per-Guild Tenant-Scoping;
  Fleetplanner ist API-only → Backend `/api/v1`, UI in der `fleetplanner-web` SPA.

## Goal
Ein eigenständiges **Umfragen-Modul** im Fleetplanner: ein Nutzer erstellt eine Umfrage mit Optionen,
legt Sichtbarkeit (eigener Discord / Partner / öffentlich), Modus (Einfach-/Mehrfachauswahl) und
optional eine Laufzeit fest; berechtigte Nutzer stimmen ab; Ergebnisse werden (live oder nach Schluss)
angezeigt. Analog zu Operationen — gleiche Sichtbarkeits-Reichweite, gleiches Look & Feel —, aber ein
leichtes, eigenständiges Datenmodell ohne Bezug zu Flotten/Schiffen.

## Sichtbarkeit (reuse Operations-Modell)
| Scope | Bedeutung | Wer sieht / stimmt ab |
|---|---|---|
| `private` | „Nur dein Server" | Mitglieder der Host-Guild (`GuildMembership`) |
| `partners` | Host-Guild **und** alle aktiven `GuildPartnership`-Partner | Mitglieder beider Seiten |
| `public` | „Open" | jeder eingeloggte Nutzer (öffentliche Liste, analog `/roadmap`) |

Wer abstimmen darf, leitet sich exakt aus derselben Reichweiten-Prüfung ab, die Operationen schon nutzen
(eine gemeinsame Helper-Funktion `pollAudience(poll, viewer)` statt Logik-Duplikat).

## Datenmodell (neu — Fleetplanner-Prisma, Postgres)
```prisma
model Poll {
  id            String   @id @default(cuid())
  guildId       String                         // Host-Guild (auch bei public: Herkunft)
  creatorUserId String
  title         String
  description   String?                         // Markdown, optional
  visibility    String   @default("private")    // private | partners | public  (wie Operation)
  mode          String   @default("single")     // single | multiple
  maxChoices    Int?                             // nur mode=multiple; null = unbegrenzt
  status        String   @default("open")        // draft | open | closed
  anonymous     Boolean  @default(false)         // true = Wähler nicht in Ergebnis-Detail
  resultsVisible String  @default("always")      // always | after_close | after_vote
  allowAddOptions Boolean @default(false)        // Wähler dürfen eigene Option vorschlagen
  opensAt       DateTime?                         // null = sofort
  closesAt      DateTime?                         // null = manuell schließen
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  guild   Guild        @relation(fields: [guildId], references: [id], onDelete: Cascade)
  creator User         @relation(fields: [creatorUserId], references: [id], onDelete: Cascade)
  options PollOption[]
  votes   PollVote[]

  @@index([guildId, status])
  @@index([visibility, status])
}

model PollOption {
  id      String @id @default(cuid())
  pollId  String
  label   String
  order   Int    @default(0)
  addedByUserId String?                          // gesetzt wenn via allowAddOptions

  poll  Poll       @relation(fields: [pollId], references: [id], onDelete: Cascade)
  votes PollVote[]
  @@index([pollId, order])
}

model PollVote {
  id        String   @id @default(cuid())
  pollId    String
  optionId  String
  userId    String
  createdAt DateTime @default(now())

  poll   Poll       @relation(fields: [pollId], references: [id], onDelete: Cascade)
  option PollOption @relation(fields: [optionId], references: [id], onDelete: Cascade)
  user   User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([optionId, userId])                   // 1 Stimme je Option je Nutzer
  @@index([pollId, userId])                       // schnelle „hat dieser Nutzer schon?"-Prüfung
}
```
- **Einfachauswahl:** Server erzwingt max. 1 `PollVote` je `(pollId, userId)` über alle Optionen.
- **Mehrfachauswahl:** mehrere Votes erlaubt, begrenzt durch `maxChoices`.
- Eine Migration `polls_init`; sonst additiv, kein Eingriff in bestehende Tabellen.

## API (`/api/v1`, Fleetplanner-Backend)
| Methode | Pfad | Zweck | Gate |
|---|---|---|---|
| `GET` | `/api/v1/polls` | Liste sichtbarer Umfragen (Scope-gefiltert; `?status=`) | optionalAuth (public sichtbar) |
| `POST` | `/api/v1/polls` | Umfrage anlegen (title, options[], mode, visibility, …) | eingeloggt + Guild-Mitglied |
| `GET` | `/api/v1/polls/:id` | Detail inkl. Optionen + Ergebnis (gemäß `resultsVisible`) + eigener Stimme | Audience-Gate |
| `PATCH` | `/api/v1/polls/:id` | Meta/Status ändern, schließen | Creator / Fleetoperator |
| `DELETE` | `/api/v1/polls/:id` | löschen | Creator / Fleetoperator |
| `POST` | `/api/v1/polls/:id/vote` | abstimmen `{optionIds: string[]}` (validiert gegen mode/maxChoices) | Audience-Gate |
| `DELETE` | `/api/v1/polls/:id/vote` | eigene Stimme(n) zurückziehen (solange `open`) | Audience-Gate |
| `POST` | `/api/v1/polls/:id/options` | eigene Option vorschlagen | nur wenn `allowAddOptions` |

- Reads ohne CSRF (`optionalAuth`/401), Mutationen mit `requireSessionJson` (CSRF) — exakt das Muster,
  das FR-SPA-PARITY für `/templates` korrigiert hat.
- Contract-Typen (`PollSummary`, `PollDetail`, `PollResult`, `CreatePollRequest`, `VoteRequest`) in
  `@rdoc-suite/fleetplanner-contracts`; OpenAPI-Pfade ergänzen (Fleetplanner-Regel: keine Doku-Lücke).

## UI (fleetplanner-web SPA)
- Nav-Eintrag **„Umfragen"**; Route `/polls` (Liste, Scope-/Status-Filter) + `/polls/:id` (Detail/Abstimmen)
  + `/polls/new` (Erstellen). i18n (`poll.*`, de+en) von Beginn an — neue Features nutzen `t()`.
- **Erstellen:** Titel, Markdown-Beschreibung, Optionen (dynamische Liste, mind. 2), Modus-Umschalter
  (Einfach/Mehrfach + `maxChoices`), Sichtbarkeit (3-Options-Liste „Privat = Nur dein Server / Partner /
  Öffentlich" — wortgleich zur Op-`SICHTBARKEIT`), optional Open-/Close-Datum, Anonym-Toggle,
  Ergebnis-Sichtbarkeit, „Eigene Optionen erlauben".
- **Abstimmen:** Radio (single) bzw. Checkboxen (multiple, bis `maxChoices`); nach Abgabe Balken-Ergebnis
  (Prozent + absolute Stimmen) gemäß `resultsVisible`; eigene Auswahl markiert, Rückziehen solange offen.
- **Ergebnis:** horizontale Balken je Option; bei `anonymous=false` optional ausklappbare Wähler-Liste.

## Standard-Features (Abdeckung)
- ✅ Einfachauswahl (single) · ✅ **Mehrfachauswahl** (`maxChoices`) · ✅ Open-/Close-Zeitpunkt (Auto-Close)
  · ✅ manuelles Schließen · ✅ Stimme zurückziehen · ✅ anonyme vs. offene Abstimmung
  · ✅ Ergebnis-Sichtbarkeit (immer / nach Schluss / nach eigener Stimme) · ✅ Wähler-vorgeschlagene Optionen (opt-in).

## Offene Entscheidungen
1. **Ergebnis-Anonymität:** reicht `anonymous` (Wähler-Identitäten verbergen), oder zusätzlich eine
   „Stimmenzahl erst nach Schluss"-Variante? → über `resultsVisible` abgedeckt; ggf. kombinierbar prüfen.
2. **Discord-Bekanntmachung:** soll eine `public`/`partners`-Umfrage optional in einen Kanal gepostet
   werden (Reuse `POST /operations/:id/announce` / `sendDiscordChannelMessage`)? — als Phase 2 möglich.
3. **Berechtigung „erstellen":** jeder Guild-Member oder nur Fleetoperator? Vorschlag: jeder Member darf
   `private` anlegen, `partners`/`public` nur Fleetoperator (analog Event-Distribution-Reichweite).
4. **Quoren / Pflichtbegründung / gewichtete Stimmen** — bewusst out-of-scope für MVP.

## Build-Order (Vorschlag)
1. Schema + Migration `polls_init` + Contracts.
2. Backend `services/polls.ts` (Audience-Gate, Vote-Validierung) + `/api/v1/polls*` Routen + OpenAPI + inject-Tests.
3. SPA: Liste + Detail/Abstimmen + Erstellen, i18n de+en.
4. (Phase 2) Discord-Announce + Wähler-Optionen-Moderation.
