# UI/UX-Redesign — Route- und Funktions-Erhaltungsmatrix

> **Zweck:** Sicherungsnetz für [`UI-UX-WORKFLOW-REDESIGN-CLAUDE-OPUS.md`](UI-UX-WORKFLOW-REDESIGN-CLAUDE-OPUS.md)
> §8 und §15 Phase 0. Aus dem Code erzeugt, nicht aus der Spezifikation abgeschrieben.
> **Stand:** 2026-08-22, `apps/fleetplanner-web`.
> **Regel:** Keine Zeile darf am Ende ohne neuen Ort dastehen. Wer eine Funktion verschiebt, pflegt
> hier die Spalte „Soll-Ort" und den Test nach.

Erzeugungsbasis: 122 exportierte Funktionen aus [`api/client.ts`](../apps/fleetplanner-web/src/api/client.ts),
315 `data-testid` aus `components/` und `pages/`, 231 `data-testid` aus `e2e/tests/`, 7 SPA-Unit-Suites.

---

## 1. Phase-1-Befund: die fünf Funktionsrisiken aus §2.3 sind bereits behoben

Der Handoff nennt fünf Punkte, die *vor* dem Umbau zu korrigieren seien. Alle fünf sind im Code
bereits erledigt — nachgeprüft, nicht angenommen:

| §2.3-Punkt | Stand im Code | Beleg |
|---|---|---|
| `PRIMARY_ACTION` braucht `needsManagedGuild` | erledigt | [`nav.ts:51-57`](../apps/fleetplanner-web/src/nav.ts#L51-L57) |
| `/templates` Operator-only | erledigt | [`nav.ts:67`](../apps/fleetplanner-web/src/nav.ts#L67) |
| ungültiges `?guild=` oszilliert | erledigt — der `urlGuildKnown`-Guard prüft die Mitgliedschaft *vor* der Übernahme, ein abgelehnter Deep Link wird als `unknownGuildId` gemerkt und die URL kanonisch ersetzt | [`serverContext.tsx:89-125`](../apps/fleetplanner-web/src/serverContext.tsx#L89-L125) |
| absolute `/fleetplanner/ops/...`-Links im `OperatorPanel` | erledigt — es sind Router-`Link`s; der alte Zustand steht nur noch im Kommentar | [`OperatorPanel.tsx:648-655`](../apps/fleetplanner-web/src/components/OperatorPanel.tsx#L648-L655) |
| ungemockte Requests als Dauerrauschen | erledigt — `onUnhandledRequest: "error"` plus explizite Defaults für die Hintergrund-Fetches | [`test/setup.ts:14`](../apps/fleetplanner-web/src/test/setup.ts#L14), [`test/handlers.ts:36-49`](../apps/fleetplanner-web/src/test/handlers.ts#L36-L49) |

Tests dafür stehen in [`test/nav.test.tsx`](../apps/fleetplanner-web/src/test/nav.test.tsx):
„renders above the groups for an operator, and not at all otherwise" (Z. 86),
„templates live under Operationen" (Z. 263),
„falls back to a real membership and canonicalises the URL" (Z. 362),
„still honours a deep link into a guild the viewer IS in" (Z. 385).

**Phase 1 ist damit ohne Codeänderung abgeschlossen.**

---

## 2. Route-zu-Navigation-Matrix

Quelle: [`App.tsx:100-166`](../apps/fleetplanner-web/src/App.tsx#L100-L166) und
[`nav.ts`](../apps/fleetplanner-web/src/nav.ts). `bestMatch` bestimmt den aktiven Menüpunkt über den
längsten besessenen Pfad; `match`-Präfixe zählen als besessen.

### 2.1 Echte Seiten

| Route | Komponente | Aktiver Menüpunkt | Gate im Menü |
|---|---|---|---|
| `/` | `StartPage` bzw. Redirect auf `/operationen` | — | angemeldet → Redirect |
| `/start` | `StartPage` | Startseite | — |
| `/operationen` | `OperationenPage` | Operationen | — |
| `/ops/new` | `WizardPage` | Operationen (via `match`) | `PRIMARY_ACTION`, `needsManagedGuild` |
| `/ops/:id` | `OpDetailPage` + `OperatorConsole` bei `canManage` | Operationen (via `match`) | — |
| `/ships` | `ShipsPage` | Schiffsdatenbank | — |
| `/polls`, `/polls/new`, `/polls/:id` | Poll-Seiten | Umfragen | — |
| `/templates` | `TemplatesPage` | Vorlagen | `auth` + `needsManagedGuild` |
| `/guilds` | `ServerListPage` | Serverübersicht | `auth` |
| `/guilds/fleet` | `OrgFleetPage` | Org-Flotte | `auth`, `server`, `needsGuild` |
| `/guilds/settings` | `GuildSettingsPage` | Server-Einstellungen | `auth`, `server`, `needsManagedGuild` |
| `/guilds/partnerships` | `PartnershipsPage` | Partnerschaften | wie oben |
| `/guilds/diagnostics` | `DiagnosticsPage` | Diagnose | wie oben |
| `/konto`, `/konto/:tab` | `KontoPage` | Konto | `auth` |
| `/admin`, `/admin/system` | `AdminPage`, `SystemPage` | Admin-Konsole / System | `gate: superadmin` |
| `/handbuch`, `/handbuch/:section` | `HandbuchPage` | Handbuch | — |
| `/sc-tools` | `ScToolsPage` | SC-Tools | — |
| `/rechtliches`, `/rechtliches/:section` | `RechtlichesPage` | — (Footer) | — |
| `/api-docs` | `ApiDocsPage` | — (`DEVELOPER_LINKS`) | — |
| `/login` | `LoginPage` | — | — |
| `*` | `ErrorState` 404 | — | — |

### 2.2 Legacy-Redirects — alle erhalten Query und Hash

`KeepQuery` mergt `extra` zuerst; ein mitgeschickter Parameter gewinnt also weiterhin.

| Alt | Neu | Mechanik |
|---|---|---|
| `/calendar` | `/operationen?view=kalender` | `KeepQuery` |
| `/ops/:id/edit` | `/ops/:id?op=eckdaten` | `EditRedirect` → `KeepQuery` |
| `/ops/:id/manage` | `/ops/:id?op=<tab>` (Default `fleet`), `flash` bleibt | `ManageRedirect` |
| `/ops/:id/cover` | `/ops/:id?op=cover` | `CoverRedirect` → `KeepQuery` |
| `/profile` | `/konto/profil` | `KeepQuery` |
| `/account` | `/konto/logins` | `KeepQuery` |
| `/feedback` | `/konto/feedback` | `KeepQuery` |
| `/handbuch/sc-tools` | `/sc-tools` | `KeepQuery` |
| `/was-ist`, `/what-is` | `/handbuch/was-ist-das` | `KeepQuery` |
| `/how-to` | `/handbuch/anleitung` | `KeepQuery` |
| `/roadmap` | `/handbuch/roadmap` | `KeepQuery` |
| `/changelog` | `/handbuch/changelog` | `KeepQuery` |
| `/why-unsigned` | `/handbuch/unsigniert` | `KeepQuery` |
| `/license` | `/rechtliches/lizenz` | `KeepQuery` |
| `/impressum` | `/rechtliches/impressum` | `KeepQuery` |
| `/privacy` | `/rechtliches/datenschutz` | `KeepQuery` |

### 2.3 Tab-Aliase innerhalb `/ops/:id`

[`OperatorConsole.tsx:75-86`](../apps/fleetplanner-web/src/components/OperatorConsole.tsx#L75-L86):
kanonisch ist `?op=<leaf>`. Zusätzlich akzeptiert werden `?sub=`, `?section=`, der Sonderfall
`?op=overview` → `eckdaten` und ein **Gruppenname** in `?op=`, der den ersten Tab dieser Gruppe
öffnet. Das in §6.3 vorgeschlagene `?mode=manage&section=…&sub=…` löst darüber bereits auf.

---

## 3. Verwaltungs-IA: Ist gegen Soll

Der Handoff beschreibt in §7 eine Struktur, die im Code **teilweise schon existiert**. Der Delta ist
die eigentliche Arbeit der Phasen 2–4.

### 3.1 Was bereits da ist

- Vier Arbeitsbereiche statt neun gleichrangiger Tabs
  ([`OperatorConsole.tsx:54-59`](../apps/fleetplanner-web/src/components/OperatorConsole.tsx#L54-L59)).
- Nur *eine* `role="tablist"`; die Bereiche sind eine `role="toolbar"` mit `aria-pressed` — genau
  das, was §6.3 („nicht zwei verschachtelte Tablists") verlangt.
- Roving Tabindex, Pfeiltasten, Home/End auf beiden Ebenen (`arrowIndex`, Z. 149).
- Badges mit `aria-label`, die die Bedeutung nennen („3 offene Fragen") statt der nackten Zahl
  (Z. 265-282) — inklusive Sammelbadge für einen zugeklappten Bereich.
- Statuskopf mit Status-Segmenten, Voice-Schnellschalter und vier KPI-Kacheln über allen Tabs.
- Autosave über `FieldSaveProvider` / `SaveDot` / `GlobalSaveBadge`.
- Vorschau-Umschalter der Teilnehmeransicht (`viewas-bar` in `OpDetailPage`) und `Breadcrumbs`.
- Bedarfe sind bereits ein eigener Tab und nicht mehr am Board angehängt.

### 3.2 Was fehlt — Arbeitsvorrat der Phasen 2–4

| Soll (Handoff) | Ist | Zu tun |
|---|---|---|
| ~~Objektkopf plus Modi „Ansehen" / „Verwalten"~~ | **erledigt 2026-08-22 (Phase 2)** — `OperationShell` + `operationMode.ts`; Modus in der URL, alle Alt-Links loesen weiter auf | — |
| Bereich „Besatzung & Flotte" | heisst „Flotte" und steht an erster Stelle | Benennung und Reihenfolge nach §7 |
| Unteransicht „Offene Arbeit" | existiert nicht | `OpenWorkDashboard` als Standardziel für Operatoren |
| „Fragen" unter Kommunikation | `qa` sitzt unter **Planung** | Tab verschieben, Alias `?op=qa` erhalten |
| „Briefing & Medien" | `cover` ist ein eigener Tab, `ResourceLinksPanel` hängt an Eckdaten, `DocumentsPanel` sitzt in der **Teilnehmeransicht** | drei Träger in eine Unteransicht zusammenziehen |
| „Freigabe & Verteilung" | existiert nicht; Status nur im Kopf, `announceOperation` und Partnerverteilung nur im **Wizard** | neue Unteransicht; die Wizard-Funktionen zusätzlich hier anbieten |
| „Verwaltung" mit Gefahrenbereich | Tab „Vorlage & Serie"; `deleteOperation` sitzt in `EckdatenForm` | Löschen und Absagen in einen abgesetzten Gefahrenbereich, Bestätigung mit Operationsname |

---

## 4. Funktions-Erhaltungsmatrix

Alle 122 Exporte aus `api/client.ts` mit heutigem Träger, Soll-Ort nach §7 und SPA-Unit-Abdeckung.
**Kein Export ist ungenutzt** — `getSession` ruft `App.tsx` auf, alle übrigen eine Seite oder
Komponente.

Die Spalte „Unit-Test" misst nur die SPA-Unit-Suites unter `src/test/`. Die E2E-Abdeckung steht in
Abschnitt 5: ein Playwright-Spec nennt die API-Pfade nie im Quelltext und ist hier deshalb nicht
messbar.

| Funktion | Endpoint | Heutiger Träger | Soll-Ort | Unit-Test |
|---|---|---|---|---|
| `getSession` | `GET /session` | App | unveraendert (ausserhalb Operations-Scope) | ja |
| `logout` | `POST {AUTH_BASE}/auth/logout` | Sidebar | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `getContent` | `GET /content/:slug` | DocPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `getOpCover` | `GET /operations/:id/cover` | CoverPanel | Verwalten › Planung › Briefing & Medien | ja |
| `generateOpCover` | `POST /operations/:id/cover/generate` | CoverPanel | Verwalten › Planung › Briefing & Medien | **fehlt** |
| `deleteOpCover` | `DELETE /operations/:id/cover` | CoverPanel | Verwalten › Planung › Briefing & Medien | ja |
| `coverEditLink` | `POST /operations/:id/cover/edit-link` | CoverPanel | Verwalten › Planung › Briefing & Medien | **fehlt** |
| `setProfileLocale` | `PATCH /profile` | PreferencesPanel | unveraendert (ausserhalb Operations-Scope) | ja |
| `setProfileShareHangar` | `PATCH /profile` | PreferencesPanel | unveraendert (ausserhalb Operations-Scope) | ja |
| `getAccount` | `GET /account` | AccountPage | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `getRoadmap` | `GET /roadmap` | RoadmapPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `getPublicOrgs` | `GET /public/orgs` | StartPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `claimSeat` | `POST /operations/:id/seats/:id/claim` | OpDetailPage | Ansehen | ja |
| `unclaimSeat` | `DELETE /operations/:id/seats/:id/claim` | OpDetailPage | Ansehen | ja |
| `cqbSignup` | `POST /operations/:id/cqb/signup` | OpDetailPage | Ansehen | ja |
| `cqbWithdraw` | `DELETE /operations/:id/cqb/signup` | OpDetailPage | Ansehen | ja |
| `assignCqbSoldier` | `POST /operations/:id/cqb/:id/assign` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | **fehlt** |
| `removeCqbSoldier` | `DELETE /operations/:id/cqb/:id` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `addCqbTeamMember` | `POST /operations/:id/cqb-teams/:id/members` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | **fehlt** |
| `autoFillFighters` | `POST /operations/:id/fighter-squads/auto-fill` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `setUnitLateArrival` | `PATCH /operations/:id/units/:id/late-arrival` | OpDetailPage | Ansehen | **fehlt** |
| `setSeatLateArrival` | `PATCH /operations/:id/seats/:id/late-arrival` | OpDetailPage | Ansehen | **fehlt** |
| `setCqbLateArrival` | `PATCH /operations/:id/cqb/:id/late-arrival` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | **fehlt** |
| `assignCqbTeamCarrier` | `PUT /operations/:id/cqb-teams/:id/carrier` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | **fehlt** |
| `createFormation` | `POST /operations/:id/formations` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `deleteFormation` | `DELETE /operations/:id/formations/:id` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `renameFormation` | `PATCH /operations/:id/formations/:id` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `renameCqbTeam` | `PATCH /operations/:id/cqb-teams/:id` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `autoBundleCqb` | `POST /operations/:id/cqb/auto-bundle` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `dissolveCqbTeam` | `DELETE /operations/:id/cqb-teams/:id` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `setPrimaryUnit` | `PUT /operations/:id/primary-unit` | OpDetailPage | Ansehen | ja |
| `clearPrimaryUnit` | `DELETE ?userId=:id` | OpDetailPage | Ansehen | ja |
| `assignUnitFormation` | `PUT /operations/:id/units/:id/formation` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | **fehlt** |
| `assignUnitCarrier` | `PUT /operations/:id/units/:id/carrier` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | **fehlt** |
| `setGroupParent` | `PUT /operations/:id/groups/:id/parent` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | **fehlt** |
| `setMemberSlot` | `PUT /operations/:id/member-slot` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | **fehlt** |
| `setHangarShare` | `PUT /operations/:id/hangar-share` | OpDetailPage | Ansehen | ja |
| `getOperatorView` | `GET /operations/:id/operator` | OperatorConsole,OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `decideUnit` | `POST /operations/:id/units/:id/:id` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `patchUnit` | `PATCH /operations/:id/units/:id` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `assignSeat` | `PUT /operations/:id/seats/:id/assignment` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `unassignSeat` | `DELETE /operations/:id/seats/:id/assignment` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `patchSeat` | `PATCH /operations/:id/seats/:id` | OpDetailPage,OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `answerQuestion` | `POST /operations/:id/questions/:id/answer` | OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `askQuestion` | `POST /operations/:id/questions` | OpDetailPage | Ansehen | ja |
| `withdrawUnit` | `DELETE /operations/:id/units/:id` | OpDetailPage,OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `addResourceLink` | `POST /operations/:id/resource-links` | ResourceLinksPanel,WizardPage | Verwalten › Planung › Briefing & Medien + Wizard | ja |
| `removeResourceLink` | `DELETE /operations/:id/resource-links/:id` | ResourceLinksPanel | Verwalten › Planung › Briefing & Medien | ja |
| `reorderResourceLinks` | `PUT /operations/:id/resource-links/order` | ResourceLinksPanel | Verwalten › Planung › Briefing & Medien | ja |
| `opDocumentUrl` | `? :id/operations/:id/documents/:id` | DocumentsPanel | Verwalten › Planung › Briefing & Medien | ja |
| `uploadOpDocument` | `GET /operations/:id/documents` | DocumentsPanel | Verwalten › Planung › Briefing & Medien | ja |
| `deleteOpDocument` | `DELETE /operations/:id/documents/:id` | DocumentsPanel | Verwalten › Planung › Briefing & Medien | ja |
| `addStream` | `POST /operations/:id/streams` | OpDetailPage | Ansehen | ja |
| `removeStream` | `DELETE /operations/:id/streams/:id` | OpDetailPage | Ansehen | ja |
| `addLeader` | `POST /operations/:id/leaders` | CommandersPanel,OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `removeLeader` | `DELETE /operations/:id/leaders/:id` | CommandersPanel,OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | **fehlt** |
| `getHangar` | `GET /hangar` | OfferShip,ProfilePage,ShipsPage | Ansehen › Teilnahmeoptionen | ja |
| `searchShips` | `GET /ships/search?q=:id` | OfferShip,ProfilePage,ShipsPage | Ansehen › Teilnahmeoptionen | ja |
| `searchLocations` | `GET /locations/search?:id` | EckdatenForm | Verwalten › Planung › Eckdaten | ja |
| `addHangarShip` | `POST /hangar` | ProfilePage,ShipsPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `removeHangarShip` | `DELETE /hangar/:id` | ProfilePage | unveraendert (ausserhalb Operations-Scope) | ja |
| `importFleet` | `POST /hangar/import` | ProfilePage | unveraendert (ausserhalb Operations-Scope) | ja |
| `importFleetFromFleetyards` | `POST /hangar/import/fleetyards` | ProfilePage | unveraendert (ausserhalb Operations-Scope) | ja |
| `sendFeedback` | `POST :id/feedback` | FeedbackPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `listTemplates` | `GET ?guildId=:id${q ?` | TemplatesPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `applyTemplate` | `POST /templates/:id/apply` | TemplatesPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `registerUnit` | `POST /operations/:id/units` | OfferShip | Ansehen › Teilnahmeoptionen | ja |
| `editOperation` | `PATCH /operations/:id` | EckdatenForm,OperatorConsole | Verwalten › Planung › Eckdaten | ja |
| `getSquadLink` | `? ?` | SquadLinkPanel,VoicePanel | Verwalten › Kommunikation › Voice & Teilnehmer | ja |
| `setOperationStatus` | `POST /operations/:id/status` | OperatorConsole | Verwalten › Freigabe bzw. Verwaltung | ja |
| `getVoiceRecipients` | `GET /operations/:id/voice/recipients` | VoicePanel | Verwalten › Kommunikation › Voice & Teilnehmer | ja |
| `setVoiceRecipients` | `PUT /operations/:id/voice/recipients` | VoicePanel | Verwalten › Kommunikation › Voice & Teilnehmer | ja |
| `deleteOperation` | `DELETE /operations/:id` | EckdatenForm | Verwalten › Planung › Eckdaten | ja |
| `publishTemplate` | `POST /operations/:id/publish-template` | OperatorConsole | Verwalten › Freigabe bzw. Verwaltung | ja |
| `createRecurrence` | `POST /operations/:id/recurrence` | OperatorConsole,WizardPage | Verwalten › Freigabe bzw. Verwaltung | ja |
| `stopRecurrence` | `POST /operations/:id/recurrence/stop` | OperatorConsole | Verwalten › Freigabe bzw. Verwaltung | ja |
| `getNeeds` | `GET /operations/:id/needs` | NeedsEditor,OpDetailPage | Verwalten › Besatzung & Flotte › Bedarfe | ja |
| `addShipNeeds` | `POST /operations/:id/needs/ships` | NeedsEditor,WizardPage | Verwalten › Besatzung & Flotte › Bedarfe + Wizard | ja |
| `renameNeed` | `PATCH /operations/:id/needs/:id` | NeedsEditor | Verwalten › Besatzung & Flotte › Bedarfe | ja |
| `removeNeed` | `DELETE /operations/:id/needs/:id` | NeedsEditor,OperatorPanel | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `setFighterSquads` | `PUT /operations/:id/needs/fighters` | NeedsEditor,OperatorPanel,WizardPage | Verwalten › Besatzung & Flotte (Board/CQB/Verbände; qa → Kommunikation) | ja |
| `setCqbTeams` | `PUT /operations/:id/needs/cqb` | NeedsEditor,WizardPage | Verwalten › Besatzung & Flotte › Bedarfe + Wizard | **fehlt** |
| `getAdminGuilds` | `GET /admin/guilds` | AdminPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `banGuild` | `POST /admin/guilds/:id/ban` | AdminPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `unbanGuild` | `POST /admin/guilds/:id/unban` | AdminPage | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `getAdminSettings` | `GET /admin/settings` | AdminPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `setMaintenanceMode` | `POST /admin/maintenance` | AdminPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `setFeedbackChannel` | `PUT /admin/settings/feedback` | AdminPage | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `syncCatalog` | `POST /admin/:id/sync` | AdminPage,SystemPage | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `getSystemHealth` | `GET /admin/system/health` | SystemPage | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `getSystemEvents` | `GET /admin/system/events${q ?` | SystemPage | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `setCatalogConfig` | `PUT /admin/:id/config` | AdminPage | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `getAdminUsers` | `GET /admin/users` | AdminPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `setUserRole` | `PUT /admin/users/:id/role` | AdminPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `toggleUserActive` | `POST /admin/users/:id/active` | AdminPage | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `getDiagnostics` | `GET /guilds/:id/diagnostics` | DiagnosticsPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `getUnseenChangelog` | `GET /changelog/unseen` | ChangelogPopup | unveraendert (ausserhalb Operations-Scope) | ja |
| `ackChangelog` | `POST /changelog/ack` | ChangelogPopup | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `getPartnerships` | `GET /guilds/:id/partnerships` | PartnershipsPage,WizardPage | Partnerschaften + Wizard › Freigabe (geteilt) | ja |
| `mintPartnerInvite` | `POST /guilds/:id/partnerships/invite` | PartnershipsPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `acceptPartnerToken` | `POST /guilds/:id/partnerships/accept` | PartnershipsPage | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `setPartnerAutoShare` | `PUT /guilds/:id/partnerships/:id/auto-share` | PartnershipsPage | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `revokePartnership` | `POST /guilds/:id/partnerships/:id/revoke` | PartnershipsPage | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `decideSharedEvent` | `POST /guilds/:id/partnerships/events/:id/:id` | PartnershipsPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `getGuildSettings` | `GET /guilds/:id/settings` | CommandersPanel,GuildSettingsPage | Kommandanten + Server-Einstellungen (geteilt) | ja |
| `getOrgFleet` | `GET /guilds/:id/fleet` | OrgFleetPage | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `listPolls` | `GET /polls` | PollsPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `getPoll` | `GET /polls/:id` | PollDetailPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `createPoll` | `POST /polls` | PollCreatePage | unveraendert (ausserhalb Operations-Scope) | ja |
| `votePoll` | `POST /polls/:id/vote` | PollDetailPage | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `withdrawPollVote` | `DELETE /polls/:id/vote` | PollDetailPage | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `addPollOption` | `POST /polls/:id/options` | PollDetailPage | unveraendert (ausserhalb Operations-Scope) | **fehlt** |
| `closePoll` | `PATCH /polls/:id` | PollDetailPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `updatePoll` | `PATCH /polls/:id` | PollDetailPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `deletePoll` | `DELETE /polls/:id` | PollDetailPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `getGuildChannels` | `GET /guilds/:id/channels` | WizardPage | Wizard › Freigabe & Verteilung | ja |
| `announceOperation` | `POST /operations/:id/announce` | WizardPage | Wizard › Freigabe & Verteilung | **fehlt** |
| `updateGuildSettings` | `PATCH /guilds/:id/settings` | GuildSettingsPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `setMemberRole` | `PUT /guilds/:id/members/:id/role` | GuildSettingsPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `listOperations` | `GET /operations?includePast=` | CalendarPage | unveraendert (ausserhalb Operations-Scope) | ja |
| `getOperation` | `GET /operations/:id` | OpDetailPage | Ansehen | ja |
| `createOperation` | `POST /operations` | WizardPage | Wizard (Erstellen) | ja |

---

## 5. Testabdeckung je Träger

Gemessen über `data-testid`: wie viele der Testids einer Komponente ein Playwright-Spec unter
`e2e/tests/` tatsächlich ansteuert. Das ist die belastbare Zahl — die API-Pfade tauchen in einem
Spec nie auf.

| Träger | e2e-abgedeckte Testids | Risiko beim Umbau |
|---|---|---|
| `AccountPage` | 1/4 | **hoch** |
| `AdminPage` | 6/8 | mittel |
| `ApiDocsPage` | 1/1 | niedrig |
| `CalendarPage` | 12/22 | mittel |
| `ChangelogPopup` | 0/2 | **hoch** |
| `CommandersPanel` | 2/2 | niedrig |
| `CoverPanel` | 9/9 | niedrig |
| `DiagnosticsPage` | 4/6 | mittel |
| `DocumentsPanel` | 0/3 | **hoch** |
| `EckdatenForm` | 9/11 | niedrig |
| `FeedbackPage` | 4/8 | mittel |
| `GuildSettingsPage` | 10/13 | mittel |
| `HandbuchPage` | 1/2 | mittel |
| `KontoPage` | 1/1 | niedrig |
| `LoginPage` | 0/1 | **hoch** |
| `NeedsEditor` | 7/11 | mittel |
| `OfferShip` | 5/8 | mittel |
| `OpDetailPage` | 12/34 | **hoch** |
| `OperatorConsole` | 12/14 | niedrig |
| `OperatorPanel` | 6/20 | **hoch** |
| `OrgFleetPage` | 4/7 | mittel |
| `PartnershipsPage` | 7/11 | mittel |
| `PollCreatePage` | 1/1 | niedrig |
| `PollDetailPage` | 6/6 | niedrig |
| `PollsPage` | 2/2 | niedrig |
| `PreferencesPanel` | 2/2 | niedrig |
| `ProfilePage` | 8/14 | mittel |
| `RechtlichesPage` | 1/1 | niedrig |
| `ResourceLinksPanel` | 4/5 | niedrig |
| `RoadmapPage` | 0/1 | **hoch** |
| `ServerListPage` | 3/5 | mittel |
| `ShipsPage` | 3/4 | mittel |
| `Sidebar` | 7/9 | mittel |
| `SquadLinkPanel` | 0/4 | **hoch** |
| `StartPage` | 3/8 | **hoch** |
| `SystemPage` | 7/8 | niedrig |
| `TemplatesPage` | 3/5 | mittel |
| `VoicePanel` | 1/3 | **hoch** |
| `WizardPage` | 24/37 | mittel |
| `fieldSave` | 1/1 | niedrig |
| `ui` | 0/1 | **hoch** |

### 5.1 Bedienelemente in den Trägern, die das Redesign anfasst

Ursprünglicher Befund: 40 Bedienelemente in den umzuziehenden Trägern waren weder von einem
Playwright-Spec noch von einer SPA-Unit-Suite angesteuert. Am 22.08. hat
[`test/preserved-controls.test.tsx`](../apps/fleetplanner-web/src/test/preserved-controls.test.tsx)
(25 Tests) die handlungsfähigen davon geschlossen. Diese Tests halten den **Bedienweg** fest —
welches Element angefasst wird und welcher Request daraus wird — nicht das Layout, damit sie den
Umzug überleben, den sie absichern.

Geschlossen:

- **Streams in `OpDetailPage`** — Formular öffnen, Plattform/URL/Label senden, leere URL blockiert,
  eigenen Stream löschen, fremden Stream nicht löschen können.
- **`DocumentsPanel`** — vollständig: leerer Zustand, Nur-Lese-Sicht, PDF-Upload, Nicht-PDF wird im
  Browser abgewiesen, Löschen, Fünf-Dateien-Grenze.
- **`SquadLinkPanel`** — vollständig: Voice aus, Server nicht konfiguriert, Operation nicht
  gestartet, Deep-Link plus Kopieren plus Store-Link.
- **`OperatorPanel` Verbände** — anlegen per Button und per Enter, namenlos blockiert, umbenennen
  beim Fokusverlust, löschen.
- **`OperatorPanel` CQB und Jäger** — Auto-Bündeln mit der gewählten Squad-Größe, deaktiviert wenn
  alle eingeteilt sind, Jäger-Auto-Fill.
- **Teilnahmezustand in `OpDetailPage`** — „bereits angemeldet", Haupteinheit-Auswahl bei mehreren
  Einheiten, keine Auswahl bei einer, leere Bahn zeigt „KEIN BEDARF".
- **`VoicePanel`** — nichts auszuteilen solange Voice aus ist, der kopierte Link ist der vom Server
  und nicht der maskierte Platzhalter, einzelne Freigabe und „alle zuweisen", Rollback wenn der
  Server die Empfängerliste ablehnt.
- **`NeedsEditor`** — CQB-Anzahl und -Größe reisen gemeinsam, Speichern bleibt inert ohne Änderung,
  ein abgelehnter Speichervorgang sagt warum, Bedarf umbenennen und entfernen.

Nebenbefund: der CQB-Test hat ein falsches Testfixture aufgedeckt (`signupId` statt `id`), das die
React-Key-Warnung ausgelöst hat. Ursache war ein `as never`-Cast, der die Vertragsabweichung vor dem
Compiler versteckt hat. Die Fixtures dieser Suite sind jetzt cast-frei und damit typgeprüft.

Weiterhin offen — bewusst, nicht vergessen:

| Element | Warum noch offen |
|---|---|
| `mission-log`, `mission-log-toggle` | Ansichtszustand ohne Mutation; das Redesign fasst ihn nicht an |
| `calendar-export`, `op-series`, `op-series-badge`, `verband-chip`, `op-stream-badge` | Anzeigeelemente ohne eigenen Bedienweg |
| `cqb-block`, `fighter-block`, `formation-block`, `pending-block`, `op-streams`, `interest-panel` | Container, deren Inhalt jetzt getestet ist |
| `changelog-popup`, `changelog-ok`, `operator-loading`, `op-pick-search`, `leader-add-toggle` | ausserhalb der Operations-IA bzw. reine Suchfelder |

---

## 6. Was Phase 0 offen lässt

### 6.1 Testschulden — Stand nach Phase 0.4

Abgearbeitet. Die fünf Posten der ursprünglichen Liste sind seit `545c5df` abgedeckt, `VoicePanel`
und `NeedsEditor` seit dem Vorlauf zu Phase 3. Was in Abschnitt 5.1 noch offen steht, sind Container
und reine Anzeigeelemente; für jedes nennt die Tabelle dort den Grund.

Damit ist kein Bedienelement mehr ungesichert, das das Redesign an einen anderen Ort bringt.

### 6.2 Produktentscheidungen, die der Handoff voraussetzt

Diese Punkte sind **keine** Funktionserhaltung, sondern neue Arbeit. Sie brauchen eine Zusage,
bevor sie gebaut werden:

- **„Freigabe & Verteilung" als Verwaltungs-Unteransicht** (§7.1). `announceOperation`,
  `getGuildChannels` und die Partnerverteilung existieren heute **nur im Wizard**. Der Handoff
  verlangt sie zusätzlich in der Verwaltung. Das ist neue Oberfläche über bestehender API — keine
  API-Änderung, aber auch keine reine Umsortierung.
- **„Offene Arbeit" als Dashboard** (§7.2). Die Daten liegen alle in `getOperatorView`; die Ansicht
  selbst ist neu.
- **Reihenfolge der Arbeitsbereiche.** Der Code beginnt mit „Flotte", der Handoff mit „Planung".
  Für den Erstellungsfluss ist „Planung zuerst" richtig, für die tägliche Arbeit an einer laufenden
  Operation „Flotte zuerst". Eine Entscheidung, keine Ableitung.
- **`deleteOperation` aus `EckdatenForm` herauslösen.** Heute steht das Löschen im selben Formular
  wie Titel und Startzeit. Der Handoff will einen abgesetzten Gefahrenbereich mit Namensbestätigung.
