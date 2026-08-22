# RDOC Fleetplanner — Feature Backlog

Kleinteiliges: Ideen, halbfertige Fäden und Feedback aus dem Discord. Große Features stehen in
[ROADMAP.md](ROADMAP.md), Erledigtes im [Mergelog](RDOC-SUITE-MERGELOG.md).

Stand 2026-08-22 — gegen den Code geprüft.

Legende: `[ ]` offen · `[~]` teilweise · `[x]` erledigt

---

## #1 — Hangar-Import `[x]`

Piloten importieren ihre Schiffe, statt jedes einzeln zu suchen. Umgesetzt über zwei Wege:

- **CCU-Game-JSON** (`POST /api/v1/hangar/import`) — Datei/Text einfügen, unerkannte Namen lassen
  sich hinterher manuell zuordnen.
- **Fleetyards-Profil** (`POST /api/v1/hangar/import/fleetyards`) — öffentlicher Hangar eines
  Fleetyards-Nutzers.

Der Rest von `UserShip` (eigenes Schiff anbieten, Captain-Sitz vorbelegen, Operator-Override bei der
Sitzvergabe) liegt in `POST /api/v1/operations/:id/units` bzw.
`PUT …/seats/:seatId/assignment`.

Eine RSI-Hangar-API gibt es weiterhin nicht — Scraping bleibt bewusst außen vor.

## #2 — Discord-DM bei angenommener Einheit `[ ]` — **feuert derzeit nicht**

`sendAcceptedCaptainVoiceDm` steht in `services/discord.ts`, hängt aber an **keinem Endpunkt**: die
Funktion wurde vom alten Form-POST-Layer aufgerufen, und `/api/v1/operations/:id/units/:unitId/accept`
schickt keine Nachricht. Seit dem SPA-Umstieg bekommt also niemand die DM. Aufgefallen beim
Dead-Code-Durchgang am 2026-08-22; die Funktion blieb deshalb bewusst stehen.

Zwei Entscheidungen hängen daran:
1. **Anschließen oder streichen?** Anschließen heißt: im Accept-Handler aufrufen (best effort, ein
   Discord-Fehler darf die Annahme nicht kippen).
2. **Text.** Der Wortlaut ist Voice-Ära ("captain voice rights", "Download voice client") und passt
   nicht mehr zu Subraum.

**Weiterhin offen:** Die DM erreicht nur Nutzer mit verknüpfter Discord-Identität. Wer sich über
GitHub/Google angemeldet und Discord nie verknüpft hat, bekommt nichts — eine In-App-Benachrichtigung
als Fallback fehlt.

## #3 — Erinnerungs-DM vor dem Start `[x]`

`reminderScheduler` läuft minütlich, Vorlauf pro Guild über `reminderOffsetMin` (Default 15),
`reminderSentAt` verhindert Doppelversand.

## #4 — Voice `[x]` (anders gelöst als ursprünglich geplant)

Der ursprüngliche Plan — sechs „Funkrelais"-Bots, automatisch erzeugte Crew-Voice-Kanäle, eine
`GlobalVoice`-Discord-Rolle mit Auto-Entzug — ist **hinfällig**. Der komplette Voice-Stack wurde
2026-06 entfernt: kein `GuildVoiceBot`-Modell, keine `EphemeralChannel`, kein
`globalVoiceRoleId`, kein `voiceChannelCategoryId` im Schema. Der Bot bewegt niemanden mehr durch
Kanäle (`MOVE_MEMBERS`/`CONNECT`/`MANAGE_CHANNELS` werden zwar noch angefordert, aber nicht benutzt —
siehe Roadmap).

Was heute existiert: Operationskommandanten bekommen einen signierten `squadlink://connect`-Deep-Link
in den Command-Raum (`services/squadLink.ts`, `GET /api/v1/operations/:id/squadlink`,
`GET|PUT …/voice/recipients`). Das Audio läuft in **Subraum** (subraum.cc), einer eigenen App —
der Fleetplanner überträgt keinen Ton.

## #5 — Teilnehmer-Export `[x]`

`GET /ops/:id/participants.csv` — eine Zeile je besetztem Sitz einer angenommenen Einheit, mit
Schiff/Squad, Sitzlabel, Sitztyp und Op-Metadaten. Zugriff: jedes Mitglied der Operation
(`effectiveOpRole != null`), sonst 404. Kein Snapshot in der DB, der Export wird bei Abruf erzeugt.

**Offen `[ ]`:** JSON-Variante für maschinelle Konsumenten; darauf aufbauend eine Anwesenheits-/
DKP-Auswertung. Beides ist bewusst noch nicht gebaut.

## Guild-Setup — was pro Server einstellbar ist

| Feld | Zweck | Pflicht |
|---|---|---|
| `admiralRoleId` | Discord-Rolle → `fleetoperator` (Sync beim Login) | optional |
| `eventChannelId` | Kanal/Ziel für Discord-Scheduled-Events | optional |
| `reminderOffsetMin` | Minuten Vorlauf für die Erinnerungs-DM | optional (Default 15) |
| `discordInviteUrl` | Einladungslink, den die Op-Panels anzeigen | optional |
| `timezone` | Zeitzone für Anzeige und Kalender | optional |

Einstellbar unter „Server → Einstellungen" (`PATCH /api/v1/guilds/:id/settings`). Ein
`captainRoleId` gibt es nicht — „Captain" ist die Rolle in einer Operation, kein Servertitel.

## Bugs und Feedback

Aktuelle Liste; die alten Einträge sind erledigt und stehen im Changelog.

- `[ ]` **Interest-Sync poll gelöschte Discord-Events endlos** — alle fünf Minuten 404 `10070` im
  Log, weil nichts die tote `discordEventId` aufräumt. Queued im Mergelog (2026-08-22).
- `[ ]` **Schiffsdatenbank verlinkt die Quelle nicht** (FR-D3, siehe
  [FR-SPA-PARITY-RESTORE.md](FR-SPA-PARITY-RESTORE.md)).
- `[x]` **Stream-Markierung + Filter** (exrelax) — 2026-06-29.
- `[x]` **Screenshots am Bug-Report** (HEADWiG) — `/feedback` nimmt bis zu 4 Bilder (≤8 MB).
- `[x]` **Login-Hinweis statt 404** auf einem Op-Link ohne Session (exrelax).
- `[x]` **„Pilot" statt „Captain"** bei nicht-kapitalen Schiffen (Mimosenherkules) — `unitLeadTitle`.
- `[x]` **Partner-Token-Kopierknopf + Kalenderpfeil** (Hevcon42).
- `[✗]` **Verfügbarkeiten im Profil + Operator-Heatmap** (exrelax) — abgelehnt 2026-06-29.
