# UI/UX-Redesign — manuelle Abnahme (Phase 6)

> **Wegwerfdokument.** Löschen, wenn die Abnahme durch ist — wie
> [`REDESIGN-STAND.md`](REDESIGN-STAND.md). Die Historie steht im
> [Mergelog](RDOC-SUITE-MERGELOG.md) (CLAUDE.md Regel 7).
>
> **Grundlage:** [`UI-UX-WORKFLOW-REDESIGN-CLAUDE-OPUS.md`](UI-UX-WORKFLOW-REDESIGN-CLAUDE-OPUS.md)
> §15 Phase 6, §16, §17 und §19.
>
> **Warum von Hand:** 219 SPA-Tests und 119 Playwright-Tests sagen, dass die Bedienwege
> funktionieren. Sie sagen nicht, ob jemand ohne Handbuch weiß, was als Nächstes dran ist. Das ist
> die Frage aus §19, und sie beantwortet nur ein Mensch.

---

## 1. Stack starten (Windows, Docker Desktop, PowerShell)

Das Testscript ist Bash. Ohne Git Bash geht es direkt:

```powershell
docker compose -f docker-compose.test.yml up -d --build
```

Vier Container: `discord-mock`, `fleetplanner-db-test`, `fleetplanner`, `fleetplanner-web`.
Migrationen laufen beim Start des Backends selbst. Warten, bis alle healthy sind:

```powershell
docker compose -f docker-compose.test.yml ps
```

| | |
|---|---|
| Oberfläche | <http://localhost:8099> |
| API direkt | <http://localhost:3299/api/v1/health> |
| Discord-Simulator | <http://localhost:4400> |

Wieder abräumen (Datenbank inklusive):

```powershell
docker compose -f docker-compose.test.yml down -v
```

Mit Git Bash geht stattdessen `bash scripts/test-stack.sh up` beziehungsweise `… down`.

---

## 2. Als eine bestimmte Rolle anmelden

Der lokale Stack hat den E2E-Login-Seam aktiv (`tests/stack/env.test`) — in Produktion existiert die
Route nicht, dort ist `E2E_TEST_LOGIN_SECRET` leer und die Endpunkte werden gar nicht registriert.

nginx reicht unbekannte Pfade ans Backend durch, der Login geht also **same-origin** aus der
Browserkonsole. Auf <http://localhost:8099> öffnen (F12 → Konsole) und einfügen:

```js
// Rolle hier wählen — siehe Tabelle darunter.
await fetch("/e2e/login", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-e2e-secret": "test-e2e-login-secret-local-stack-0123456789",
  },
  body: JSON.stringify({ username: "e2e-op", role: "crew", guildRole: "fleetoperator" }),
}).then((r) => r.json()).then(console.log);
location.reload();
```

| Rolle | `username` | `role` | `guildRole` |
|---|---|---|---|
| Crew | `e2e-crew` | `crew` | `crew` |
| Fleetoperator | `e2e-op` | `crew` | `fleetoperator` |
| Superadmin | `e2e-admin` | `superadmin` | `fleetoperator` |
| Crew ohne Operator-Server | `e2e-plain` | `crew` | `crew` |

Der Benutzername muss auf `e2e-` beginnen — der Seam kann prinzipiell keine echten Konten
übernehmen. Alle Testnutzer landen in der synthetischen Guild `100000000000000001`
(„E2E-Testserver").

**Zweiten Server dazunehmen** (für Szenario 7): denselben Aufruf noch einmal mit demselben
`username`, aber `"guildId": "100000000000000002"`. Das ersetzt die erste Mitgliedschaft nicht,
sondern legt eine zweite an — danach hat `e2e-op` beide Server und der Serverpicker hat etwas zu
wechseln. Nachgeprüft, das Ergebnis sind zwei Mitgliedschaften:

```
100000000000000001  E2E-Testserver    fleetoperator
100000000000000002  E2E-Testserver-2  fleetoperator
```

**Zurück zu Gast:** Abmelden über die Oberfläche, oder in der Konsole
`document.cookie = "fp_sid=; Max-Age=0; path=/"` und neu laden. Ein privates Fenster tut es auch.

**Mobile prüfen:** F12 → Geräteleiste (Strg+Umschalt+M) → 390 × 844. Die Breakpoints liegen bei
**760 px** (Zielgrößen, Sheets, Navigation) und **880 px** (Rail wird Drawer), beide sind also im
Blick.

---

## 3. Die zehn Szenarien aus §17

Jedes ist ein Durchlauf, kein Klick. Bei jedem Schritt zählt nicht nur, *ob* es geht, sondern ob es
ohne Raten geht.

### 1 — Gast, Mobile

- [ ] <http://localhost:8099/start> zeigt fünf Funktionskarten, nicht fünfzehn.
- [ ] „10 weitere Funktionen zeigen" klappt den Rest **an Ort und Stelle** auf.
- [ ] Menü kennt **kein** „Neue Operation", keine Vorlagen, kein Konto, keine Serververwaltung.
- [ ] `/operationen` → eine öffentliche Operation öffnen; Briefing ist lesbar.
- [ ] Kein Verwaltungsmodus sichtbar, dafür ein verständlicher Anmelde-Hinweis.

### 2 — Crew, Mobile

- [ ] Operation öffnen: Kopfzeile nennt Titel, Server, Termin, Treffpunkt, Status, Belegung.
- [ ] Flexibel anmelden → Zustand wechselt sichtbar.
- [ ] Frage stellen → sie erscheint.
- [ ] Eigenes Schiff anbieten, eigenen Sitz nehmen, Angebot zurückziehen.
- [ ] **Kein** „Verwalten"-Umschalter. `?mode=manage` an die URL hängen ändert daran nichts.

### 3 — Operator, Desktop: anlegen

- [ ] „Neue Operation" → Pflichtfeld leer lassen → „Weiter" blockiert und fokussiert das Feld.
- [ ] Bedarf setzen, Partner wählen, Entwurf erstellen.
- [ ] Erfolgszustand zeigt **vier benannte Wege**: Flotte planen, Cover & Dokumente, In Discord
      ankündigen, Operation ansehen.
- [ ] Jeder führt an den Ort, den er nennt.
- [ ] „Oder gleich hier erledigen" klappt Cover, Dokumente und Ankündigung im Wizard auf.

### 4 — Operator, Desktop: Board

- [ ] Verwalten öffnet auf **Offene Arbeit**; jede Zeile nennt Zahl *und* Sache.
- [ ] Eine Zeile anklicken führt in den Tab, der sie auflöst.
- [ ] Offene Einheit annehmen; flexiblen Nutzer per Klick zuweisen; per Drag verschieben.
- [ ] Netzwerk in den Devtools auf offline stellen, eine Zuweisung versuchen → Fehler ist sichtbar
      und der Zustand springt zurück, statt hängen zu bleiben.

### 5 — Operator, Tablet (≈ 900 px)

- [ ] Kommunikation → Fragen beantworten.
- [ ] Kommandanten ernennen und entfernen.
- [ ] Voice aktivieren, Empfänger zuweisen, Link kopieren.

### 6 — Operator: Serie und Vorlage

- [ ] Verwaltung → „Als Vorlage veröffentlichen" ist eine eigene Karte mit einer Hauptaktion.
- [ ] „Wiederkehrende Serie" ebenso; „Serie stoppen" ist sichtbar die leisere Aktion.
- [ ] Gefahrenbereich: Abschließen und Absagen stehen **außerhalb** der roten Box.
- [ ] Löschen verlangt den Namen der Operation; ein Teil davon reicht nicht.

### 7 — Multi-Guild

- [ ] Zweiten Testserver minten (`guildId: "100000000000000002"`).
- [ ] Server A wählen → Einstellungen, Partnerschaften, Diagnose tragen alle `?guild=`.
- [ ] Server B per Deep Link öffnen → er wird aktiv.
- [ ] `?guild=999999999999999999` → landet stabil auf einem erlaubten Server und sagt, dass der Link
      nicht galt. **Kein Flackern zwischen zwei Servern.**

### 8 — Superadmin

- [ ] `/admin` und `/admin/system` erreichbar.
- [ ] „Administration" im Menü ist begrifflich getrennt von der „Verwaltung" *innerhalb* einer
      Operation.

### 9 — Tastatur, ohne Maus

- [ ] Drawer: Tab hinein, Escape schließt, Fokus kehrt auf den Öffner zurück.
- [ ] Ansehen/Verwalten mit Tastatur erreichbar und schaltbar.
- [ ] Bereichsleiste und Tabreihe: Pfeiltasten, Pos1, Ende.
- [ ] Sitzzuweisung ohne Drag: auswählen, Platz wählen, Enter; Escape bricht ab.
- [ ] Löschbestätigung vollständig per Tastatur.
- [ ] Fokus ist überall sichtbar und springt nach einer Mutation nicht an den Seitenanfang.

### 10 — Browserverlauf

- [ ] Filter der Übersicht → Zurück stellt den vorherigen Filter her.
- [ ] Ansehen ↔ Verwalten → Zurück wechselt den Modus zurück.
- [ ] Tab wechseln → Zurück landet auf dem vorherigen Tab, **nicht** in der Teilnehmeransicht.
- [ ] Neu laden hält Modus und Tab.

### Alte Links (§16)

Alle müssen weiterhin auf ihrem Inhalt landen — mit `<id>` einer echten Operation:

- [ ] `/ops/<id>/manage` → Board im Verwaltungsmodus
- [ ] `/ops/<id>/edit` → Eckdaten
- [ ] `/ops/<id>/cover` → Briefing & Medien, Cover sichtbar
- [ ] `/ops/<id>?op=qa` → Fragen (liegt jetzt unter Kommunikation)
- [ ] `/ops/<id>?op=cover` → Briefing & Medien
- [ ] `/calendar` → `/operationen?view=kalender`
- [ ] `/profile`, `/account`, `/feedback` → die passenden Konto-Tabs

### Mobile-Spezifika (§11)

- [ ] Bei 390 px scrollen Bereichsleiste und Tabreihe **seitwärts**, je eine Zeile, mit sichtbar
      angeschnittener Kante — keine gestapelte Knopfwand.
- [ ] Vorlagenpicker und Changelog-Hinweis sitzen am unteren Rand, nur oben gerundet, mit eigenem
      Scroll.
- [ ] Keine Tabelle zwingt die Seite zum Seitwärtsscrollen; Tabellen scrollen in ihrem eigenen
      Rahmen, die erste Spalte bleibt stehen.
- [ ] Buttons sind bequem mit dem Daumen zu treffen.
- [ ] Windows-Einstellungen → Animationen aus → nichts in der Oberfläche animiert mehr.

---

## 4. Schlussgatter (§19)

Das Redesign ist erst fertig, wenn ein Nutzer diese acht Fragen in **jedem** Kernablauf ohne Raten
beantworten kann. Grüne Tests reichen dafür ausdrücklich nicht.

- [ ] Wo bin ich?
- [ ] Welche Operation und welchen Discord-Server bearbeite ich?
- [ ] In welcher Rolle handle ich?
- [ ] Was ist der aktuelle Status?
- [ ] Was ist die wichtigste offene Aufgabe?
- [ ] Was passiert, wenn ich die hervorgehobene Aktion ausführe?
- [ ] Wie komme ich zurück zur Teilnehmeransicht?
- [ ] Wo finde ich jede bisherige Funktion?

---

## 5. Wenn etwas nicht stimmt

Notieren mit: Rolle, Fenstergröße, URL, was du erwartet hast, was passiert ist. Die URL ist wichtig —
Modus und Tab stehen darin, ein Fall ist damit reproduzierbar.

Bekannte, bewusste Zustände — kein Fehler:

- **Partnerverteilung ist nur Anzeige.** `partnerTargetGuildIds` ist in der API create-only; die
  Auswahl fällt beim Anlegen. Ein editierbarer Picker wäre ein Bedienelement, das nichts tut.
- **Dokumente sind auf der Teilnehmerseite nur lesbar.** Hochladen und Löschen liegen in
  Verwalten › Briefing & Medien — derselbe Editor an zwei Orten war die Ausgangslage.
- **`19-cover` überspringt sich** ohne den Cover-Renderer. Mit Git Bash:
  `bash scripts/test-stack.sh up --with-cover` (zieht ein ~800 MB Chromium-Image).
