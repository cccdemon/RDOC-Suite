# Mission Resource Links — tutorial/guide links on an operation

**FeatureRequest — Priority 3** (scale 1 highest … 5 lowest)
**Status:** Plan, **NOT yet implemented**. Captured 2026-06-11.
**Requested by:** Operator-Wunsch — *"SC hat immer mehr komplexe Missionen (TSG, Vanduul Tech
Smugglers, bald Xenothreat & Siege of Orison). Community macht tolle Tutorials. Operator soll Links zu
z.B. YouTube-Video oder RSI-Community-Hub-One-Pager an einer Mission hinterlegen können. Außerdem:
Templates für solche komplexeren Missionen, in denen die Links schon drinstehen."*

## Dependencies
- **Hängt an:** nichts hartes. Hängt nur an `Operation` (existiert) + der Op-Detail-/Manage-UI.
- **Blockiert:** nichts.
- **Verwandt / ist Vorstufe von:** [FR-P4-template-marketplace.md](FR-P4-template-marketplace.md). Die
  „Templates mit vorab hinterlegten Links" aus der zweiten Idee-Bullet sind die **leichte, lokale**
  Variante des Marktplatzes — diese FR liefert das Datenfeld, der Marktplatz teilt es später org-übergreifend.
- **Quer:** mergelog-first; Zod an der Boundary; per-guild Tenant-Scoping; SSR (kein Client-Framework).
- **Architektur-Vorbehalt:** UI-Plan unten = aktueller SSR-Stand (`render.ts`/`pages.ts`). Falls
  [FR-P3-frontend-split.md](FR-P3-frontend-split.md) (API-first + FE-Container) vorher umgesetzt wird,
  stattdessen JSON-Endpoint + FE-Komponente bauen.

## Goal
Ein Operator kann an einer Operation **kuratierte Ressourcen-Links** hinterlegen (YouTube-Tutorial,
RSI-Community-Hub-One-Pager, Google-Doc, Bild). Teilnehmer sehen sie auf der Op-Detail-/Mission-Board-
Seite als „Briefing / Tutorials". Verständnis komplexer Missionen (TSG, Vanduul Tech Smugglers,
Xenothreat, Siege of Orison) sinkt → bessere Vorbereitung, weniger Erklär-Aufwand im Voice.

## Data — neues Modell
Kein passendes Feld vorhanden. Eigene Tabelle (n Links pro Op, geordnet):

```prisma
model OperationResourceLink {
  id           String   @id @default(cuid())
  operationId  String
  url          String   // validiert; nur http/https
  title        String   // Anzeigename ("TSG Full Guide")
  kind         String   @default("link") // link | youtube | rsi_hub | gdoc | image — treibt Icon/Embed
  sortOrder    Int      @default(0)
  addedById    String
  createdAt    DateTime @default(now())

  operation Operation @relation(fields: [operationId], references: [id], onDelete: Cascade)
  addedBy   User      @relation(fields: [addedById], references: [id])

  @@index([operationId])
}
```
`Operation` bekommt `resourceLinks OperationResourceLink[]` + additive Migration.
`kind` wird aus der URL **abgeleitet** (youtube.com/youtu.be → youtube, robertsspaceindustries.com →
rsi_hub, docs.google.com → gdoc, .png/.jpg → image, sonst link) — Operator kann override.

## UI
- **Manage-Backend (Operator):** Sektion „Tutorials & Ressourcen" — Liste mit Add-Form (URL + optional
  Titel), Reorder (sortOrder), Remove. URL-Validierung server-seitig (Zod url(), nur http/https,
  Hostname-Allowlist optional als Anti-Phishing).
- **Op-Detail / Mission Board (Spieler):** Karte „Briefing / Tutorials" mit Link-Liste, Icon je `kind`.
  - YouTube: Thumbnail + Titel (kein Auto-Embed/iframe im MVP — externer Link, `rel="noopener
    noreferrer"`, `target="_blank"`).
  - RSI-Hub/GDoc/Link: Favicon-/Icon-Pille + Titel.
- i18n de+en (bestehendes i18n-System), CSS in `render.ts`.

## Security / scope
- **Nur http/https**, kein `javascript:`/`data:` (XSS). Zod an der Route-Boundary.
- Links sind **per-Op**, Sichtbarkeit = Sichtbarkeit der Op (private/partners/public erbt).
- Nur Operator/Leader der Op dürfen Links add/remove (gleiche Guard wie übrige Manage-Aktionen).
- Anzeige escaped Titel/URL (kein roher HTML-Inject); externe Links klar als extern markiert.

## Build order
1. Schema `OperationResourceLink` + Migration + `services/resourceLinks.ts` (add/remove/reorder/list,
   `kind`-Ableitung, Zod-Validierung).
2. Manage-UI-Sektion (add/remove/reorder) + Routen.
3. Op-Detail/Mission-Board-Karte „Briefing / Tutorials" + i18n + CSS.
4. (Optional) YouTube-Thumbnail via `https://img.youtube.com/vi/<id>/hqdefault.jpg` (kein API-Key,
   nur Bild — kein iframe).

## Decisions (offen — beim Implementieren mit User klären)
1. **Auto-Embed vs. nur Link?** MVP-Vorschlag: nur Link + Thumbnail, **kein iframe** (CSP/Privacy).
2. **Hostname-Allowlist?** Optional, um nur „seriöse" Quellen (youtube, RSI, docs.google) zuzulassen
   vs. beliebige URLs. Vorschlag: beliebig erlauben, aber escapen + als extern markieren.
3. **Max. Anzahl Links pro Op** (Anti-Clutter) — Vorschlag: 10.

---
*Design doc only. Implement on explicit instruction, mergelog-first. Leichtes Feature — ein Modell, eine
Migration, eine UI-Sektion. Ist gleichzeitig das Datenfundament für [FR-P4-template-marketplace.md](FR-P4-template-marketplace.md).*
