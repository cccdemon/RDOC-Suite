# Org-Modul: Implementierungsplan

> **Status:** Planungsphase — offene Entscheidungen markiert mit `[OPEN]`  
> **Zielentwickler:** Opus (dieser Plan ist der Arbeitsauftrag)  
> **Repo:** `c:\Users\streamer\Documents\Projekte\RDOC-Suite` / `/opt/RDOC-Suite`  
> **Stack:** pnpm workspaces, Fastify, PostgreSQL, Prisma, EJS-ähnliches HTML-Template-System (`pages.ts`)

---

## Kontext & Motivation

Eine Discord-Guild ≠ eine SC-Organisation. Viele Spieler sind auf mehreren Discords unterwegs.  
Das bestehende `Guild`/`GuildMembership`-System ist Discord-gebunden und erzeugt Datendoppelung  
wenn dasselbe Schiff auf mehreren Servern eingetragen wird.

Das Org-Modul ist eine eigenständige Schicht, die SC-Organisationen (RSI-Orgs) als First-Class-Entities behandelt,  
unabhängig davon wie viele Discord-Server die Org betreibt.

Ein Discord-Server (`Guild`) kann optional einer Org zugeordnet werden — ist aber keine Voraussetzung.  
`UserShip` bleibt user-global: einmal eingetragen, sichtbar in jeder Org der der User angehört.

---

## Entschiedene Anforderungen

### Rollen

| Rolle | Bedeutung |
|---|---|
| `leader` | Org-Admin: Einstellungen, Member verwalten, Invites erstellen |
| `member` | Vollmitglied: Fleet sehen, Schiffe anfordern |
| `requester` | **Transient** — hat Mitgliedschaft beantragt, noch nicht genehmigt |

`requester` ist kein dauerhafter Zustand. Leader genehmigt → `member` oder lehnt ab → Datensatz gelöscht.

### Join-Flows

**A — Invite-Link (Leader-gesteuert):**
- Leader erstellt Token unter `/orgs/:orgId/invites`
- Schickt Link selbst (Discord DM, E-Mail, was auch immer — kein Bot-Pflicht)
- Empfänger öffnet `/orgs/join/:token` → Login required → bestätigt → sofort `member`
- Invite hat optionales `expiresAt` und optionales `maxUses` (Einzel-Invite oder Gruppen-Link)

**B — Self-Apply:**
- Org-Seite zeigt minimale öffentliche Preview (Name, RSI-Handle, Beschreibung)
- Login required für Apply
- `POST /orgs/:orgId/apply` → `OrgMembership { role: "requester" }`
- Leader sieht Pending-Liste, kann approve/reject

### Discord-Kontakt (kein Backend)

`UserIdentity.providerId` wo `provider = "discord"` = Discord-Snowflake.  
Fleet-Seite zeigt pro Member einen Link `https://discord.com/users/{snowflake}` → öffnet DM direkt.  
Nur anzeigen wenn Discord-Identity verknüpft.

### RSI-Handle

Kein API-Sync. RSI-Org-Handle ist Freitextfeld → wird als Link angezeigt:  
`https://robertsspaceindustries.com/orgs/{rsiHandle}`

---

## Datenmodell

### Neue Tabellen

```prisma
model Org {
  id          String   @id @default(cuid())
  name        String
  rsiHandle   String?  @unique   // z.B. "RDOC" — nur Anzeige + externer Link
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  memberships OrgMembership[]
  invites     OrgInvite[]
  guilds      Guild[]
}

model OrgMembership {
  id        String   @id @default(cuid())
  orgId     String
  userId    String
  role      String   @default("requester") // leader | member | requester
  joinedAt  DateTime @default(now())
  updatedAt DateTime @updatedAt

  org  Org  @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([orgId, userId])
  @@index([orgId])
  @@index([userId])
}

model OrgInvite {
  id        String    @id @default(cuid())
  orgId     String
  label     String?   // optionale Bezeichnung ("Batch für neues Mitglied X")
  token     String    @unique @default(cuid())
  role      String    @default("member")
  maxUses   Int?      // null = unbegrenzt
  useCount  Int       @default(0)
  createdBy String    // userId
  expiresAt DateTime?
  revokedAt DateTime?
  createdAt DateTime  @default(now())

  org Org @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId])
}
```

### Änderungen an bestehenden Tabellen

```prisma
// Guild — optionaler Org-Link (nullable, kein Breaking Change)
model Guild {
  // ... alle bestehenden Felder unverändert ...
  orgId String?
  org   Org?    @relation(fields: [orgId], references: [id], onDelete: SetNull)
}

// User — Relation ergänzen
model User {
  // ...
  orgMemberships OrgMembership[]
}
```

---

## Routes

```
GET  /orgs                               – eigene Orgs (Member + Requester) + Suche/öffentliche Orgs
GET  /orgs/new                           – Org anlegen (nur fleetoperator+, oder jeder? [OPEN])
POST /orgs                               – Org erstellen

GET  /orgs/:orgId                        – Org-Fleet-Seite (member+); Requester sieht nur "Pending"-Hinweis
GET  /orgs/:orgId/members                – Member-Verwaltung (leader only)
POST /orgs/:orgId/members/:uid/approve   – requester → member
POST /orgs/:orgId/members/:uid/promote   – member → leader
POST /orgs/:orgId/members/:uid/demote    – leader → member
POST /orgs/:orgId/members/:uid/remove    – rauswurf
POST /orgs/:orgId/apply                  – self-apply → requester (login required)
POST /orgs/:orgId/leave                  – selbst austreten (nicht letzter leader)

GET  /orgs/:orgId/invites                – Invite-Verwaltung (leader only)
POST /orgs/:orgId/invites                – Invite erstellen
POST /orgs/:orgId/invites/:id/revoke     – Invite ungültig setzen

GET  /orgs/join/:token                   – Join-Landing (public, login required)
POST /orgs/join/:token                   – Join bestätigen

GET  /orgs/:orgId/settings               – Org-Einstellungen: Name, RSI-Handle, Beschreibung, Guild-Link (leader)
POST /orgs/:orgId/settings               – Settings speichern
POST /orgs/:orgId/delete                 – Org löschen (leader only, confirm-Guard)
```

---

## Fleet-Ansicht (`GET /orgs/:orgId`)

Zeigt alle `member`- und `leader`-Mitglieder der Org mit ihren `UserShip`-Einträgen.

**Layout-Ideen:**
- Member-Cards: Avatar, Username, Schiff-Badges (Name + Größe)
- Filterbar nach Ship-Size / Ship-Career
- Discord-DM-Link pro Member (wenn Discord-Identity vorhanden)
- Aggregat-Zeile: "X Mitglieder, Y Schiffe total, Z Unique"

---

## Offene Entscheidungen `[OPEN]`

### 1. Schiffe verleihen / Schiff-Anfragen

SC hat keine Spielschnittstelle für Leihe. Alles wäre soziale Koordination, kein Enforcement.

**Mögliche Ansätze:**
- **A — Nur Sichtbarkeit:** Kein Leihe-Feature. User sieht Schiffe → kontaktiert Owner per Discord-DM. Einfachstes Modell.
- **B — Anfrage-Tracking (soft):** `ShipRequest { id, orgId, requesterId, ownerId, shipId, message, status: pending|accepted|declined, createdAt }`. Kein Enforcement, rein als Koordinationshilfe. Owner akzeptiert/lehnt ab → Notiz im System.
- **C — Verfügbarkeits-Flag:** Owner markiert Schiff als "verfügbar für Leihe" (Flag auf `UserShip`). Fleet-Ansicht filtert danach.

→ **Entscheidung steht aus.** Welche Komplexität ist gewünscht?

### 2. Chat / Kommunikation innerhalb der Org

**Option A — Kein eigener Chat.** Discord-DM-Links reichen. Orgs haben ohnehin einen Discord.

**Option B — Org-Bulletin Board.** Einfache Text-Posts pro Org (kein Echtzeit, kein WebSocket). Leader/Member posten Ankündigungen. Kein Chat.

**Option C — Chaträume.** Echtzeit-Chat mit WebSocket. Aufwand deutlich höher. Ein Raum oder mehrere?

→ **Entscheidung steht aus.** Wie viel Kommunikation soll im Tool stattfinden vs. Discord?

### 3. Wer darf eine Org anlegen?

- Nur `fleetoperator` / `superadmin` (kontrolliert, verhindert Spam)?
- Jeder eingeloggte User (selbstverwaltet)?

### 4. Öffentlichkeit von Org-Seiten

- Org-Fleet (`/orgs/:orgId`) nur für Members sichtbar?
- Oder öffentlich einsehbar (auch nicht eingeloggt)?
- Oder: eingeloggt aber nicht Mitglied sieht Preview (Name, Beschreibung, Member-Anzahl) aber keine Schiff-Details?

### 5. Benachrichtigungen

Bei neuem Requester → soll der Leader eine Benachrichtigung bekommen?
- Discord-DM via Bot (bereits vorhanden)
- E-Mail (kein E-Mail-Stack vorhanden)
- Nur UI-Badge (simpelster Ansatz)

---

## Was unverändert bleibt

- `UserShip` bleibt user-global — kein Migration, kein Datenmüll
- `Guild` / `GuildMembership` — unberührt, weiterhin für Op-Planung + Bridge zuständig
- Bridge / Companion — kein Bezug zum Org-Modul
- Bestehende Fleetplanner-Ops — weiterhin Guild-gebunden, nicht Org-gebunden

---

## Implementierungs-Reihenfolge (wenn Entscheidungen gefallen)

1. Prisma-Migration: `Org`, `OrgMembership`, `OrgInvite` + `Guild.orgId`
2. Service-Layer: `services/orgs.ts` (CRUD, Join-Logik, Invite-Validierung)
3. Routes: `routes/orgs.ts` (alle oben gelisteten Endpunkte)
4. Pages: `web/pages.ts` — `orgListPage`, `orgDetailPage` (Fleet), `orgMembersPage`, `orgInvitesPage`, `orgJoinPage`, `orgSettingsPage`
5. Discord-DM-Links (HTML-only in Fleet-Ansicht)
6. `[OPEN]`-Features nach Entscheidung nachrüsten

---

## Technische Hinweise für Opus

- Routing-Pattern: analog zu `routes/web.ts` + `routes/api.ts` — Fastify-Plugin, `basePath()`-Helper für URL-Generierung
- CSRF: alle POST-Routes brauchen `_csrf`-Check (siehe bestehende Routes)
- Auth-Guard: `requireAuth(req, reply)` pattern aus bestehenden Routes übernehmen
- Guild-Kontext: `fp_guild` Cookie → aktive Guild; Org-Kontext analog über `fp_org` Cookie oder URL-Parameter
- Page-Funktionen: HTML-Template-System via `html` tagged template + `safe()` / `rawHtml()` aus `web/render.ts` — kein EJS, kein React
- Prisma-Client für Fleetplanner: `import { db } from "../db.js"` (PostgreSQL, nicht SQLite)
- Mergelog-Protokoll: **vor** Implementierungsbeginn einen `Queued`-Eintrag in `docs/RDOC-SUITE-MERGELOG.md` schreiben
