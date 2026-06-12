# FR — SPA Parity & Gap Recovery (Priority Feature Requests)

**Status:** Plan, kein Code. Erstellt 2026-06-13 nach Audit der `fleetplanner-web`-SPA gegen
`docs/api/fleetplanner-route-inventory.md`, die echten `/api/v1`-Endpunkte (`apps/fleetplanner/src/routes/apiV1.ts`),
`apps/fleetplanner-web/src/api/client.ts` und die `docs/archiv/FR-P*`-Specs.

**Kontext:** Nach dem Visual-Redesign + der IA-Konsolidierung (20→10 Screens) sind mehrere SSR-Operator-/
Crew-Funktionen nicht in die SPA gewandert bzw. wurden im Route-Inventar als „Operator-API Folge-Phase"
nie nach `/api/v1` gebaut. Dieses Dokument plant die Wiederherstellung als priorisierte FRs.

**Voice/CC: vollständig ausgeklammert.**

**Legende Status:** 🟢 Backend `/api/v1` vorhanden, nur Frontend fehlt · 🔴 Backend fehlt auch · 🟡 teilweise.
**Priorität:** **P1** essenziell (Kern-Flow kaputt/blockiert) · **P2** wichtig (Operator-Tiefe) · **P3** Ausbau.
**⚠️** = Kreuzabhängigkeit oder Design-Widerspruch (unten gesammelt).

---

## P1 — Essenziell

### FR-A1 · Briefing- & Tutorial-Links (Operator)  🟢
**Was es macht:** Der Operator hinterlegt an einer Operation kuratierte Links (YouTube-Tutorial,
RSI-Community-Hub, Google-Doc, Bild). Teilnehmer sehen sie auf der Op-Detail-Seite als Karte
„Briefing / Tutorials" mit Icon je Typ (`kind` aus URL abgeleitet). Operator kann hinzufügen,
entfernen, umsortieren.
**Backend:** ✅ `POST /api/v1/operations/:id/resource-links`, `DELETE|PATCH …/resource-links/:linkId`
(Service `resourceLinks.ts`, Modell `OperationResourceLink`). Op-Detail zeigt sie bereits read-only.
**fleetplanner-web:** ❌ Kein Client (`addResourceLink`/`removeResourceLink` fehlen), keine Operator-UI.
**Bauen in:** `client.ts` (3 Fns) + neuer Abschnitt „Tutorials & Ressourcen" in `OperatorConsole`
(Eckdaten- oder eigener Bereich). Validierung server-seitig vorhanden (nur http/https).
**Akzeptanz:** Operator fügt Link mit URL+Titel hinzu → erscheint beim Spieler; entfernen/umsortieren geht.
**Spec:** `docs/archiv/FR-P3-mission-resource-links.md`.

### FR-A3 · Crew zieht eigenes Schiff zurück  🟢
**Was es macht:** Ein Crew-Mitglied, das ein Schiff angeboten hat (Captain der Einheit), kann es selbst
wieder aus der Operation zurückziehen — ohne Operator. Button auf der eigenen Einheit im Spieler-Board.
**Backend:** ✅ `DELETE /api/v1/operations/:id/units/:unitId` — Gate `deleteUnit(unitId, userId, role)`
erlaubt den eigenen Captain.
**fleetplanner-web:** ❌ Kein `withdrawUnit`-Client/Button. *(Aktuell uncommitted auf Disk vorgebaut.)*
**Bauen in:** `client.ts` `withdrawUnit` + Button in `OpDetailPage` (Einheit wenn `captain.id === me.id`).
**Akzeptanz:** Eigene Einheit zeigt „Zurückziehen" → entfernt Einheit + gibt Sitze frei.

### FR-A4 · Sitz-Picker: beliebiges Guild-Mitglied zuweisen  🟢
**Was es macht:** Operator weist einem offenen Sitz **jedes** Guild-Mitglied zu (nicht nur Leute mit
Flex-Anmeldung) — z.B. jemand, der telefonisch zugesagt hat. Sitz-Picker bekommt eine Mitglieder-Suche.
**Backend:** ✅ `assignSeat` (PUT seats/:seatId/assignment) nimmt jede `userId`; `getGuildSettings`
liefert die Mitgliederliste.
**fleetplanner-web:** ❌ Picker listet nur `crewRequests` (Flex-Anmeldungen).
**Bauen in:** `OperatorPanel` Picker erweitern (Mitglieder-Fetch + Suchfeld, wie schon im CommandersPanel).
**Akzeptanz:** Offener Sitz → Picker zeigt Flex-Anmeldungen **und** suchbare Guild-Mitglieder → Zuweisung.

### FR-B7 · Spieler kann eine Frage stellen  🔴 ⚠️
**Was es macht:** Ein Teilnehmer stellt dem Operator eine Frage zur Operation (z.B. „Welcher Treffpunkt
genau?"). Operator beantwortet sie (Antwort-Flow existiert schon). **Ohne Stellen-Funktion ist der ganze
Q&A-Zweig tot** — OperatorPanel zeigt + beantwortet Fragen, aber niemand kann im SPA fragen.
**Backend:** 🔴 `/api/v1` hat nur `POST …/questions/:qid/answer` (Operator antwortet). SSR hatte
`POST /ops/:id/questions` (stellen) — **kein `/api/v1`-Ersatz gebaut**.
**fleetplanner-web:** ❌ kein `askQuestion`-Client, kein Frage-Feld auf op-detail.
**Bauen in:** API-Endpoint `POST /api/v1/operations/:id/questions` (Service existiert SSR-seitig) +
`client.ts` + Frage-Eingabe in `OpDetailPage`.
**Akzeptanz:** Eingeloggter Teilnehmer stellt Frage → erscheint im Operator-Q&A → Antwort sichtbar.

### FR-C1 · Mission-Cover im Erstellungs-Assistenten  🟢
**Was es macht:** Beim Op-Erstellen kann der Operator direkt ein Missions-Cover generieren/öffnen
(der Cover-Editor existiert bereits in der Operator-Konsole/Admin). SSR-Wizard hatte den `openCover`-Schritt.
**Backend:** ✅ Cover-Endpoints (`…/cover/generate|edit-link|delete`).
**fleetplanner-web:** ❌ Wizard hat keinen Cover-Schritt; Cover nur nachträglich über die Konsole erreichbar.
**Bauen in:** `WizardPage` Schritt/Aktion „Cover" (nach Create, da Cover eine Op-ID braucht — wie SSR).
**Akzeptanz:** Nach Erstellung optional „Cover erstellen" direkt aus dem Wizard.

### FR-C2 · Share-Channel beim Erstellen  🟡 ⚠️
**Was es macht:** Beim Erstellen wählt der Operator, in **welchem Discord-Channel** das Event/die
Ankündigung gepostet wird (SSR-Wizard „Share"-Step mit Channel-Select). Hängt an der Discord-Event-
Erstellung (Event entsteht bei Status `open`).
**Backend:** 🟡 prüfen: liefert ein Endpoint die wählbaren Channels der Guild? Event-Erstellung in
`services/discord.ts`. Ggf. `GET /api/v1/guilds/:id/channels` + Channel-Param an Create/Status-open.
**fleetplanner-web:** ❌ kein Channel-Select im Wizard.
**Bauen in:** API (Channel-Liste + Persistenz der Wahl) + Wizard-Schritt „Teilen".
**Akzeptanz:** Operator wählt Ziel-Channel → Event landet dort.

### FR-F1 · Bugfix: Vorlagen-Marktplatz „Invalid CSRF Token"  🐞
**Was es macht:** `applyTemplate` schlägt mit 403 „Invalid CSRF Token" fehl. Vorlage-Anwenden ist kaputt.
**Vermutung:** csrf-Retry in `mutate()` greift nicht / Picker-Overlay nutzt veralteten `session`-Prop.
**Bauen in:** Debug `client.ts mutate`/`applyTemplate` + TemplatesPage csrf-Quelle.
**Akzeptanz:** Vorlage anwenden erstellt die Op ohne CSRF-Fehler.

---

## P2 — Wichtig (Operator-Tiefe)

### FR-A2 · Einheit/Squad umbenennen + Captain-Note  🟢
**Was es macht:** Operator (oder Captain) benennt eine Squad-Einheit um bzw. setzt eine Captain-Notiz
(„Treffe mich an Gate 3"). Schiffe selbst tragen den Schiffsnamen (nicht umbenennbar — by design).
**Backend:** ✅ `PATCH /api/v1/operations/:id/units/:unitId` (Felder `squadName`, `captainNote`).
**fleetplanner-web:** ❌ kein `patchUnit`-Client/UI.
**Bauen in:** `client.ts` + Inline-Edit im OperatorPanel-Board (squadName) / Notiz-Feld.
**Akzeptanz:** Squad-Name + Notiz editierbar, persistiert.

### FR-A5 · „View as: Guest / Crew / Myself"  (kein Backend)
**Was es macht:** Operator schaltet die Vorschau-Perspektive um, um zu sehen, wie die Op-Seite für einen
Gast, ein Crew-Mitglied bzw. ihn selbst aussieht (Operator-Konsole + Join-Controls werden entsprechend
ein-/ausgeblendet). Reine UI-Vorschau, ändert keine Rechte.
**fleetplanner-web:** ❌. **Bauen in:** `OpDetailPage` `viewAs`-State; bei `guest`/`crew` Operator-Konsole
unterdrücken + Join-Controls anpassen.
**Akzeptanz:** Umschalter zeigt die drei Sichten ohne Reload.

### FR-B1 · Sitze aktivieren/deaktivieren + umbenennen  🔴 ⚠️
**Was es macht:** Operator schaltet einzelne Sitze einer Einheit scharf/inaktiv (z.B. „nur 6 von 9 Plätzen
besetzen") und vergibt eigene Sitz-Labels (statt „Gunner 3"). ⚠️ **Widerspricht** dem datengetriebenen
Seat-Modell (Sitze = aus Schiffs-Crewdaten generiert, read-only).
**Backend:** 🔴 kein `/api/v1`; SSR hatte `units/:unitId/seats`. Braucht Schema-Erweiterung
(`SeatAssignment.active`/`customLabel`) + Endpoint.
**Bauen in:** API (Schema + Routen) + OperatorPanel Sitz-Zeile (Toggle + Inline-Rename).
**Akzeptanz:** Sitz deaktivieren (zählt nicht mehr als offen) + umbenennen.

### FR-B5 · CQB per-Soldat-Platzierung  🔴
**Was es macht:** Operator teilt einzelne FPS-Spieler konkreten CQB-Teams zu / verschiebt sie (über die
reine Team-Anzahl/Größe hinaus). SSR hatte `cqb place/bundle/squads`.
**Backend:** 🔴 `/api/v1` nur `needs/cqb` (Anzahl/Größe) + `cqb/signup`. Platzierung fehlt.
**Bauen in:** API + OperatorPanel CQB-Block.
**Akzeptanz:** Operator zieht Soldaten in/zwischen Teams.

### FR-D1 · Hangar: Nickname/Custom-Name (CCU-Import) anzeigen  🟡
**Was es macht:** Importierte Schiffe behalten ihren benutzerdefinierten Namen aus dem CCU-Game-Export
(„Mein Polaris ‚Nachtwache'"). Hangar zeigt Nickname zusätzlich zum Typ.
**Backend:** 🟡 Import speichert ggf. Nickname; `ShipSummary`/Hangar-Response hat **kein** nickname-Feld.
**Bauen in:** API (Feld im Hangar-Presenter) + `ProfilePage`-Zeile.
**Akzeptanz:** Hangar zeigt Custom-Name wenn vorhanden.

### FR-D2 · Hangar: unmatched Schiffe manuell zuordnen  🟡
**Was es macht:** Wenn der Flotten-Import nicht alle Schiffe erkennt (`unmatched`-Liste), kann der Nutzer
diese manuell einem Katalog-Schiff zuordnen — statt sie zu verlieren.
**Backend:** 🟡 `addHangarShip` vorhanden; Import liefert `unmatched`.
**Bauen in:** `ProfilePage` Zuordnungs-UI (pro unmatched: Suche → Add). Kein neuer Endpoint nötig.
**Akzeptanz:** Unmatched-Schiff → manuell zugeordnet → im Hangar.

### FR-D3 · Schiffsdatenbank: Schiffe verlinken (externe Quelle)  🟡
**Was es macht:** Jedes Schiff in der Schiffsdatenbank ist klickbar und öffnet die Quelle (star-citizen.wiki
bzw. Fleetyards) in neuem Tab, mit externem-Link-Symbol.
**Backend:** 🟡 `ShipSummary.slug` da, keine `webUrl`.
**Bauen in:** web (Link aus slug konstruieren) **oder** API `ShipSummary.webUrl` ergänzen.
**Akzeptanz:** Klick öffnet Quelle, externer-Link-Icon sichtbar.

### FR-E1 · Event-Interest-Teilnehmer im Board  🟡 ⚠️ (Discord-RSVP, kein Voice)
**Was es macht:** Wer auf dem Discord-Event „Interested" klickt, erscheint im Operator-Board als
unzugewiesener Teilnehmer („muss zugewiesen werden"), inkl. Metrik „dem System unbekannte Nutzer".
Operator kann ihm einen Sitz geben.
**Backend:** 🟡 `EventInterest`-Poll + Shadow-Claim **implementiert**; `getOperatorView`-Payload liefert
sie evtl. nicht → SPA zeigt sie nicht.
**Bauen in:** API (`/operator`-Payload um interest erweitern) + OperatorPanel-Sektion.
**Akzeptanz:** Discord-Interested-Nutzer sichtbar + zuweisbar; Metrik angezeigt.
**Spec:** `docs/archiv/FR-P2-discord-event-interest.md`.

---

## P3 — Ausbau (Operator-Roster-Tiefe)

> ⚠️ **Zusammenhängender Block** — Route-Inventar Z.60 + `FR-P1-fleet-need-structured.md` Schritt 7:
> explizit als „Operator-API Folge-Phase" **nie nach `/api/v1` migriert**. Untereinander abhängig
> (gemeinsames Unit-/Group-/Carrier-Modell + Fleetyards-Größendaten).

### FR-B2 · Verbände / Formations  🔴
**Was es macht:** Operator gruppiert per Drag&Drop akzeptierte Schiffe zu einem Verband („Task Force
Alpha"). Reines Operator-Konstrukt (kein Spieler-Join). Schiff in max. einem Verband.
**Backend:** 🔴 `Formation`/`formationId` + Routen. **web:** ❌ D&D im OperatorPanel.

### FR-B3 · FPS-Team → Schiff einbetten  🔴
**Was es macht:** Operator steckt ein CQB-Team in ein Trägerschiff (alles außer Fighter) → Anzeige „rides
in <Schiff>". `CompositionGroup.carrierUnitId`.
**Backend:** 🔴 Route + Fighter-Ausschluss-Validierung. **web:** ❌ D&D.

### FR-B4 · Fahrzeug → Schiff mit Fit-Check  🔴
**Was es macht:** Fahrzeug in ein Schiff verladen, mit Größen-/Bay-Prüfung (Fleetyards) — Drop schlägt
fehl wenn es nicht passt. Heute nur Carrier-Zuweisung bei Anlage, ohne echte Fit-Prüfung.
**Backend:** 🔴 Fit-Check-Service + Route. **web:** ❌.

### FR-B6 · Composition-Groups / primary-unit / requirements  🔴
**Was es macht:** Feinsteuerung der Zusammenstellung (Gruppen, Primär-/Trägereinheit, Requirement-Mgmt
über die 3 Needs-Typen hinaus). SSR `groups/*`, `primary-unit`, `requirements/*`. ⚠️ teilweise von
`needs/:reqId` (rename/delete) abgedeckt — vor Bau abgrenzen.
**Backend:** 🔴. **web:** ❌.

### FR-B8 · Profil: Sprache + Op-Detail-Stil  🔴 ⚠️
**Was es macht:** Nutzer wählt UI-Sprache (de/en) + bevorzugten Op-Detail-Stil (classic/board1/board2).
⚠️ **Widerspruch:** Der Visual-Redesign-Handoff *verlangt* diese Profil-Tabs, aber das **Backend hatte
nie einen `/api/v1/profile`-Endpoint** (Route-Inventar: „Folge-Phase", nie gebaut). Entscheidung nötig:
neu bauen (API `GET/PATCH /api/v1/profile` + web) **oder** aus dem Design streichen.
**Backend:** 🔴. **web:** ❌.

---

## ⚠️ Kreuzabhängigkeiten & Widersprüche (gesammelt)

1. **Q&A halb-funktional** (FR-B7): Antworten ohne Fragen-Stellen = toter Zweig.
2. **Profil-Prefs** (FR-B8): Design verlangt Feature, Backend hat's nie → Design vs. Realität.
3. **Sitz-Editing** (FR-B1): widerspricht read-only Seat-Modell → bewusste Schema-Erweiterung.
4. **Roster-Tiefe-Block** (FR-B2–B6): „Folge-Phase nie migriert", untereinander gekoppelt (gemeinsames
   Unit/Group/Carrier-Modell + Fleetyards-Größen).
5. **Share-Channel** (FR-C2): an Discord-Event-Erstellung gekoppelt (Event erst bei `open`).
6. **Event-Interest** (FR-E1): nur sichtbar, wenn `/operator`-Payload die Interest-Daten liefert.

---

## Empfohlene Reihenfolge (Vorschlag)
1. **P1-Frontend-only zuerst** (FR-A1, A3, A4, C1) + Bug FR-F1 — kleinster Aufwand, größter Effekt.
2. **P1-Backend** (FR-B7 Ask, FR-C2 Channel) — je ein API-Endpoint + web.
3. **P2** (A2, A5, D1–D3, E1, B1, B5).
4. **P3 Roster-Block** (B2–B6) als eigenes Projekt; B8 erst nach Design-Entscheid.

*Doc only. Umsetzung pro FR auf Anweisung, mergelog-first.*
