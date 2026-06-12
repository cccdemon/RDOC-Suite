# Template Marketplace — share & discover event blueprints

**FeatureRequest — Priority 4** (scale 1 highest … 5 lowest)
**Status:** Plan, **NOT yet implemented** — *„komplexere Feature-Idee"* (User). Captured 2026-06-11.
**Requested by:** Operator-Wunsch — *"Man kann sein Event als Template anbieten. Operator können beim
Anlegen eines Events in einem Template-Marktplatz nach passenden Vorlagen suchen, oder sich für neue
Events (eigene Sandbox, z.B. Piraterie) inspirieren lassen."*

## Dependencies
- **Hängt an:**
  - `Operation` + dessen Komposition (`CompositionGroup`, `CompositionRequirement`, `FleetUnit`,
    `OpPrimaryUnit`) — das, was als Blueprint serialisiert wird.
  - **Bestehender Serializer:** `OperationRecurrence.templateJson` serialisiert bereits ein „op
    blueprint (title, opType, system, location, visibility, …)". **Wiederverwenden/erweitern**, nicht
    neu erfinden. ⚠️ **Namenskollision:** „template" meint dort den Recurrence-Seed, hier den
    teilbaren Marktplatz-Eintrag — im Code sauber trennen (`recurrenceTemplate` vs `marketplaceTemplate`).
  - [FR-P3-mission-resource-links.md](FR-P3-mission-resource-links.md) — Resource-Links gehören in den
    Blueprint, damit komplexe-Missions-Templates die Tutorials gleich mitbringen (Kern der Idee).
- **Blockiert:** nichts.
- **Verwandt:** [FR-P3-org-fleet.md](FR-P3-org-fleet.md) (gleiches Muster „guild-scoped vs public"),
  Partnerships/Visibility (`GuildPartnership`, Op.visibility private|partners|public — gleiches
  Sichtbarkeitsmodell wiederverwenden).
- **Quer:** mergelog-first; per-guild Tenant-Scoping; Zod an der Boundary; SSR.
- **Architektur-Vorbehalt:** UI-Plan unten = aktueller SSR-Stand. Falls
  [FR-P3-frontend-split.md](FR-P3-frontend-split.md) (API-first + FE-Container) vorher umgesetzt wird,
  Marktplatz-Browser als FE-Route gegen JSON-API statt server-gerendert bauen.

## Goal
Ein **Template-Marktplatz**: Operatoren veröffentlichen einen Event-Blueprint (Komposition + Settings +
Tutorial-Links) als Vorlage. Beim Anlegen eines Events durchsucht ein Operator den Marktplatz nach
passenden Vorlagen (z.B. „TSG", „Xenothreat") und legt sein Event in einem Klick vor-konfiguriert an —
oder lässt sich für eigene Sandbox-Events (z.B. Piraterie) inspirieren.

## Was ist ein Template (Blueprint)?
Serialisierter, **instanzfreier** Op-Zustand — KEINE Teilnehmer, KEINE Zeit, KEINE Discord-/Voice-IDs:
- Op-Settings: `title`, `description`, `opType`, `meetingSystem`, `meetingLocation`, min/max.
- Komposition: Groups + Requirements + FleetUnits + Primary-Units (Slots, kein Person-Mapping).
- Resource-Links (FR-P3): Tutorials/One-Pager.
- **Stripped:** `scheduledAt`, `status`, alle `*Id` Foreign-/Discord-/LiveKit-Refs, Signups, EventInterest.

Apply = `instantiateFromTemplate(blueprint, { guildId, scheduledAt, createdById })` → neue Op im Draft.

## Data — neue Modelle
```prisma
model OperationTemplate {
  id            String   @id @default(cuid())
  ownerGuildId  String   // wer hat es erstellt (tenant)
  createdById   String
  name          String   // "Xenothreat — Full Squadron"
  summary       String   @default("")
  opType        String   // gespiegelt für Filter/Suche
  visibility    String   @default("guild") // guild | partners | public  (gleiches Modell wie Op)
  blueprintJson String   // der instanzfreie Blueprint (s.o.)
  sourceOpId    String?  // optional: aus welcher Op erzeugt
  usageCount    Int      @default(0) // wie oft instanziiert (Sortierung "beliebt")
  published     Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  ownerGuild Guild @relation(fields: [ownerGuildId], references: [id], onDelete: Cascade)
  createdBy  User  @relation(fields: [createdById], references: [id])

  @@index([visibility, opType])
  @@index([ownerGuildId])
}
```
(Optional Phase 2: `OperationTemplateRating` für Sterne/Feedback.)

## Sichtbarkeit (Tenant-Modell wiederverwenden)
- **guild:** nur eigene Guild.
- **partners:** Guild + alle via `GuildPartnership` verbundenen (gleiche Logik wie Event-Distribution).
- **public:** ganzer Marktplatz.
Default beim Veröffentlichen = `guild`; Hochstufen explizit. Kein Auto-Public.

## UI
- **Veröffentlichen:** Button „Als Template anbieten" auf einer Op (Manage) → Name/Summary/Sichtbarkeit
  → erstellt `OperationTemplate` aus aktuellem Op-Blueprint.
- **Marktplatz-Browser:** neue Seite (guild-context) — Suche (Name/Tag), Filter `opType`, Sortierung
  (beliebt/neu), Sichtbarkeits-Scope. Karten mit Name, Summary, opType-Icon, usageCount, Owner-Org.
- **Im Event-Anlegen-Flow:** Schritt „Vorlage wählen" — Marktplatz inline; „Diese Vorlage nutzen" →
  vorbefülltes Draft-Event (User setzt nur noch Datum/Location).
- i18n de+en, SSR, CSS in `render.ts`.

## Security / scope
- **Tenant-Leak vermeiden:** beim Veröffentlichen Blueprint **scrubben** — keine Guild-internen IDs,
  keine Member-Namen, keine Discord-/Voice-Refs (nur Slots/Settings/Links). Scrub zentral + getestet.
- Sichtbarkeit serverseitig erzwingen (nicht Client). `partners` = live partnerships, dynamisch geprüft.
- Resource-Link-URLs beim Apply re-validieren (Zod, http/https) — Template könnte alt/fremd sein.
- Apply erzeugt immer ein **Draft** im Ziel-Guild-Scope; nie auto-open, nie auto-Discord-Event.

## Build order (phased — groß)
1. **Blueprint-Engine:** `services/opBlueprint.ts` — `serialize(op)` (scrub) + `instantiate(blueprint,
   ctx)`. Teilt Code mit `OperationRecurrence.templateJson` → dort refaktorisieren, beide nutzen denselben Serializer.
2. **Modell + lokales Speichern:** `OperationTemplate` + Migration + „Als Template anbieten" (visibility=guild),
   Apply im Anlege-Flow. **Erst rein guild-lokal** — schon nützlich ohne Marktplatz.
3. **Marktplatz-Browser** + Suche/Filter + partners/public-Sichtbarkeit.
4. (Optional) Ratings/usageCount-Ranking, kuratierte „Featured"-Templates (TSG, Xenothreat …) als Seed.

## Decisions (offen — beim Implementieren mit User klären)
1. **Default-Sichtbarkeit beim Veröffentlichen** — Vorschlag `guild`, Public nur explizit.
2. **Wer darf public veröffentlichen?** Jeder Operator vs. nur Admin/kuratiert (Spam/Qualität).
3. **Versionierung** — Template-Updates: neue Version vs. in-place? Vorschlag MVP: in-place, kein Verlauf.
4. **Seed-Templates** — offizielle Vorlagen für die genannten Missionen (TSG, Vanduul Tech Smugglers,
   Xenothreat, Siege of Orison) vorbefüllen? Hoher Startwert, aber Pflegeaufwand.

---
*Design doc only. Implement on explicit instruction, mergelog-first. Großes/phasiges Feature — Phase 1-2
(Blueprint-Engine + guild-lokale Templates) liefern schon den Hauptnutzen; Marktplatz (Phase 3+) ist die
schwere Schale. Baut auf [FR-P3-mission-resource-links.md](FR-P3-mission-resource-links.md) und dem
vorhandenen `OperationRecurrence.templateJson`-Serializer auf.*
