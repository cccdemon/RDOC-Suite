# FR — SPA Parity & Gap Recovery

**Status (2026-08-22): 19 von 20 Punkten umgesetzt, offen ist nur noch FR-D3.**

Das Dokument entstand 2026-06-13 als Audit der `fleetplanner-web`-SPA gegen die realen
`/api/v1`-Endpunkte: nach dem Visual-Redesign und der IA-Konsolidierung fehlten der SPA mehrere
Operator- und Crew-Funktionen, die das SSR schon konnte. Die ausführliche Fassung mit allen
zwanzig Einzel-FRs steht in der Git-Historie dieser Datei; die Umsetzung selbst ist im
[Mergelog](RDOC-SUITE-MERGELOG.md) protokolliert.

## Umgesetzt

| FR | Was | Bereich |
| --- | --- | --- |
| A1 | Briefing-/Tutorial-Links auf der Operation | Operator |
| A2 | Einheit umbenennen + Captain-Note | Operator |
| A3 | Crew zieht das eigene Schiff zurück | Crew |
| A4 | Sitz-Picker über alle Guild-Mitglieder, nicht nur Flex-Anmeldungen | Operator |
| A5 | „Ansicht als" Ich / Crew / Gast (reine Vorschau, keine Rechteänderung) | Operator |
| B1 | Sitz aktivieren/deaktivieren + umbenennen; inaktive Sitze zählen nicht als offen | Operator |
| B2 | Verbände (Formations) anlegen und Einheiten zuordnen | Operator |
| B3 | CQB-Team in ein Trägerschiff setzen | Operator |
| B4 | Fahrzeug in ein Trägerschiff setzen | Operator |
| B5 | CQB-Platzierung pro Soldat | Operator |
| B6 | Bedarf-Bindung + Jäger-Klasse an der Einheit | Operator |
| B7 | Frage stellen + Q&A-Thread an der Operation | Crew |
| B8 | Sprach-Präferenz + i18n-Fundament der SPA (de/en) | Konto |
| C1 | Mission-Cover direkt im Erstellungs-Assistenten | Operator |
| C2 | Ankündigungs-Kanal schon beim Erstellen wählen | Operator |
| D1 | Hangar zeigt den Custom-Namen aus dem CCU-Import | Konto |
| D2 | Nicht erkannte Import-Namen manuell zuordnen | Konto |
| E1 | Discord-„Interessiert" erscheint im Operator-Board | Operator |
| F1 | Vorlagen-Marktplatz ohne CSRF-Fehler | Operator |

## Offen

### FR-D3 · Schiffsdatenbank: Schiff auf die Quelle verlinken 🟡

**Was es macht:** Jedes Schiff in der Schiffsdatenbank ist klickbar und öffnet seine Quelle
(star-citizen.wiki bzw. Fleetyards) in einem neuen Tab, mit Externer-Link-Symbol.

**Stand im Code:** `ShipSummary` liefert `slug`, aber keine `webUrl`
([`packages/fleetplanner-contracts/src/index.ts`](../packages/fleetplanner-contracts/src/index.ts)).
[`ShipsPage.tsx`](../apps/fleetplanner-web/src/pages/ShipsPage.tsx) verlinkt nichts nach außen.

**Zwei Wege:** den Link in der SPA aus dem Slug bauen (billig, aber die SPA kennt dann die
Quell-URL-Form), oder `ShipSummary.webUrl` im Contract ergänzen und im Presenter füllen (sauberer,
weil nur der Sync weiß, woher ein Schiff stammt).

**Akzeptanz:** Klick öffnet die Quelle in einem neuen Tab, das Externer-Link-Symbol ist sichtbar,
Tastaturfokus bleibt erhalten.
