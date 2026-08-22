# RDOC-Suite Roadmap

Was noch aussteht — mit Priorität (1 höchste … 5 niedrigste), Abhängigkeiten und dem Doc, das die
Details trägt. Vergangenes steht im [CHANGELOG](../CHANGELOG.md), die Wahrheit über den Ist-Zustand
im [Mergelog](RDOC-SUITE-MERGELOG.md) und im Code.

> Konvention: ein Feature pro Datei, `docs/FR-P<n>-<feature>.md`, mit Dependency-Block. Neue Features
> kommen hier in die Tabelle. Umgesetzte FR-Docs wandern nach [`archiv/`](archiv/), abgelehnte werden
> gelöscht — die Begründung bleibt hier stehen.

Stand: 2026-08-22.

## Offen

| Prio | Feature | Doc | Hängt ab von | Stand |
|---|---|---|---|---|
| P2 | Fleetplanner Light — Org-Operator vs. Operator-Light, Op-Tier `personal`/`org` mit Upgrade | [FR-P2-fleetplanner-light.md](FR-P2-fleetplanner-light.md) | Rollen-/Mandantenmodell + Op-Ownership (`createdById`, `leaders`) + Discord-Event-Flow | Plan, kein Code (Approach A = Op-Tier statt neuer Rolle) |
| P2 | Org-Modul — SC-Orgs als eigene Entitäten (`Org`, `OrgMembership`, `OrgInvite`) | [orgmodule-implementationplan.md](orgmodule-implementationplan.md) | Guild-/Membership-Modell | Plan, kein Code |
| P3 | Member Last-Seen + Inaktivitäts-Warnung nach 6 Monaten | [FR-P3-inactivity-alert.md](FR-P3-inactivity-alert.md) | **Gateway-Bot + `GUILD_MEMBERS`-Intent** — der Bot ist heute REST-only | Plan, kein Code |
| P3 | Volle Mehrsprachigkeit | [archiv/FR-P3-language-switch.md](archiv/FR-P3-language-switch.md) | `User.locale` (existiert) | Teilweise: Backend/SSR kennt de/en/en-US/fr/es, die SPA nur de/en |
| P3 | Composition Board — Schritte 3–5 (Auto-Match, Leader-Assign-Rest) | [archiv/composition-rebuild-plan.md](archiv/composition-rebuild-plan.md) | Composition-/FleetUnit-Modell | Schritte 1+2 im Code, Rebuild 2026-06-15 zurückgestellt |
| P3 | Schiffsdatenbank verlinkt auf die Quelle (FR-D3) | [FR-SPA-PARITY-RESTORE.md](FR-SPA-PARITY-RESTORE.md) | `ShipSummary` (existiert) | Letzter offener Punkt der SPA-Parität |
| P3 | Kapitäns-DM bei „Einheit angenommen" wieder anschließen | — | `sendAcceptedCaptainVoiceDm`, `/api/v1/…/units/:unitId/accept` | Die DM hängt an keinem Endpunkt mehr (der alte SSR-Layer trug sie); Text ist außerdem noch Voice-Ära. Entweder anschließen und neu texten — oder die Zusage aus der Doku nehmen |
| P4 | Interest-Sync räumt tote `discordEventId` auf | — | `eventInterest` | Queued im Mergelog (2026-08-22): gelöschte Discord-Events werden endlos gepollt (404 `10070`) |
| P4 | Vier Altfunktionen ohne v1-Zwilling neu bauen — falls gewünscht | — | `/api/v1` | Ressourcenlinks umsortieren, CQB-Auto-Bundle, Squad auflösen, Primäreinheit setzen. Kamen nur über den 2026-08-22 gelöschten Form-POST-Layer und waren seit dem SPA-Umstieg für niemanden erreichbar |
| P5 | Bot-Invite auf Least Privilege kürzen (`MANAGE_CHANNELS`, `CONNECT`, `MOVE_MEMBERS`, `MANAGE_ROLES` raus) | — | `BOT_PERMISSIONS` in `routes/guilds.ts` | Bewusste Entscheidung nötig: ändert die Installations-URL |

## Abgelehnt oder verworfen — nicht ohne Ansage wiederbeleben

| Feature | Entscheidung | Grund |
|---|---|---|
| Federation Voice (Homeoffice-Party, Multi-Event) | ✗ abgelehnt | Voice liegt bei Subraum; der Fleetplanner überträgt kein Audio |
| Item-Database (Loot/Verteilung) | ✗ verworfen 2026-06-24 | blockiert — es gibt keine Items-API |
| Fleet-Needs-Redesign + geführter Anmelde-Wizard | ✗ verworfen 2026-06-24 | der bestehende Bedarf-Flow bleibt |
| Roadmap-Tab + Discord-Feedback-Auto-Ingest | ✗ verworfen 2026-06-24 | Feedback läuft über Tickets |
| Spieler-Verfügbarkeiten im Profil + Operator-Heatmap | ✗ abgelehnt 2026-06-29 | zu viel Pflegeaufwand für den Nutzen |

## Zuletzt fertig geworden

Nur als Orientierung, welche großen Brocken weg sind — die vollständige Historie steht im Mergelog.

| Feature | Fertig |
|---|---|
| UI-/IA-Überarbeitung nach dem Audit (Serverkontext, URL-Tabs, Kartentypen, Drag-and-drop-Alternativen, Wizard-Validierung) | 2026-08-22 |
| Testsuite auf lokalem Docker-Stack + Discord-Simulator (Backend-Unit, SPA-Unit, DB, E2E, Smoke) | 2026-08-10 … 2026-08-22 |
| Stream-Markierung + Filter | 2026-06-29 |
| Umfragen (Guild/Partner/Public) | 2026-06-24 |
| Security-Review-Findings (Header-Schicht, Session-Token-Hash, E2E-Seam, trustProxy, Docker non-root) | 2026-06-24 |
| Org-Flotte, Mission-Cover-Service, Template-Marktplatz, Event-Distribution, Interest-Sync, Recurring Events | 2026-06 |

## Bugs und Feedback

Die laufende Liste steht in [FLEETPLANNER-BACKLOG.md](FLEETPLANNER-BACKLOG.md).
