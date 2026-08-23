# UI/UX-Redesign — manuelle Abnahme (Phase 6)

> **Wegwerfdokument.** Löschen, wenn die Abnahme durch ist — wie
> [`REDESIGN-STAND.md`](REDESIGN-STAND.md). Die Historie steht im
> [Mergelog](RDOC-SUITE-MERGELOG.md) (CLAUDE.md Regel 7).
>
> **Grundlage:** [`UI-UX-WORKFLOW-REDESIGN-CLAUDE-OPUS.md`](UI-UX-WORKFLOW-REDESIGN-CLAUDE-OPUS.md)
> §15 Phase 6, §16, §17 und §19.
>
> **Warum von Hand:** 219 SPA-Tests und 128 Playwright-Tests sagen, dass die Bedienwege
> funktionieren. Sie sagen nicht, ob jemand ohne Handbuch weiß, was als Nächstes dran ist.
>
> **Der eigentliche Test steht in Abschnitt 0 und findet nach dem Deploy statt.** Die Abschnitte
> darunter sind das lokale Werkzeug, falls du vorher etwas Konkretes nachsehen willst.

---

## 0. Das Schlussgatter — **nach dem Deploy**

Diese acht Fragen sind der eigentliche Abnahmetest (§19). Sie werden **an der Produktivinstanz**
beantwortet, nicht am lokalen Stack: der hat keine echten Daten, keine echte Guild und keine
Mitspieler, und ob jemand ohne Handbuch weiterkommt, lässt sich daran nicht beurteilen.

Es ist **kein Abhaken**. Es ist ein Durchlauf — Operation anlegen, verwalten, zurück in die
Teilnehmeransicht, rund zehn Minuten — mit einer einzigen Frage im Kopf: **stockt es irgendwo?**
Musstest du kurz suchen, zweimal hinsehen oder etwas ausprobieren, um sicher zu sein? Diese Stelle
ist der Befund. Notieren, wo.

Die Fragen sind Fehler, in Frageform. Was jede meint:

**1 · Wo bin ich?**
Du bist drei Klicks tief in einer Operation. Steht irgendwo, dass du in einer Operation bist und
nicht in den Servereinstellungen? *Vorher: die Konsole hing ohne Überschrift unter der Seite — man
sah nicht, wo das eine aufhört und das andere anfängt.*

**2 · Welche Operation, welcher Server?**
Drei Operationen in zwei Tabs offen, du bearbeitest Bedarfe. Steht der Name der Operation auf dem
Bildschirm? *Vorher nicht — der Titel stand im Hero, den hattest du längst weggescrollt.*

**3 · In welcher Rolle handle ich?**
Siehst du diese Seite gerade als Operator oder als normales Crew-Mitglied? Dieselbe Seite
funktioniert für beide anders.

**4 · Was ist der aktuelle Status?**
Entwurf oder offen? Weiß die Crew schon davon? Wer das nicht sieht, kündigt eine Operation an, die
noch niemand sehen kann.

**5 · Was ist die wichtigste offene Aufgabe?**
Du öffnest die Verwaltung. Sagt der Bildschirm, dass drei Einheiten auf deine Entscheidung warten?
*Vorher stand da der Füllgrad — eine Zahl, die niemanden blockiert.*

**6 · Was passiert, wenn ich den hervorgehobenen Knopf drücke?**
Wenn sechs Knöpfe gleich aussehen, ist keiner hervorgehoben. Und wenn „Löschen" aussieht wie
„Speichern", drückt es irgendwann jemand.

**7 · Wie komme ich zurück zur Teilnehmeransicht?**
Du bist im Arbeitsplatz. Gibt es einen sichtbaren Weg zurück zu dem, was die Crew sieht — oder musst
du die URL ändern und die Zurück-Taste probieren?

**8 · Wo finde ich jede bisherige Funktion?**
Du hast das Cover letzte Woche über einen eigenen Tab gemacht. Den Tab gibt es nicht mehr. Findest
du das Cover trotzdem?

> Wenn nichts stockt, ist das Redesign durch — dann können dieses Dokument und
> [`REDESIGN-STAND.md`](REDESIGN-STAND.md) gelöscht werden.

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

## 3. Was schon automatisch geprüft wird

`e2e/tests/22-role-matrix.spec.ts` (neun Tests) nimmt dir den mechanischen Teil ab und läuft bei
jedem `e2e`-Durchgang mit:

- die Rollenmatrix aus §16 — was jede der vier Rollen im Menü angeboten bekommt und was nicht;
- dass Crew nicht per `?mode=manage` in die Verwaltung kommt;
- dass Desktop und Drawer dieselben Ziele führen;
- die elf Alt-Links aus §16.

Die Haken unten zu diesen Punkten kannst du überspringen — sie sind mit **[auto]** markiert. Was
bleibt, ist das, was ein Spec nicht beurteilen kann.

---

## 4. Die zehn Szenarien aus §17

Jedes ist ein Durchlauf, kein Klick. Bei jedem Schritt zählt nicht nur, *ob* es geht, sondern ob es
ohne Raten geht.

### 1 — Gast, Mobile

- [ ] <http://localhost:8099/start> zeigt fünf Funktionskarten, nicht fünfzehn.
- [ ] „10 weitere Funktionen zeigen" klappt den Rest **an Ort und Stelle** auf.
- [x] **[auto]** Menü kennt kein „Neue Operation", keine Vorlagen, kein Konto, keine Serververwaltung.
- [ ] `/operationen` → eine öffentliche Operation öffnen; Briefing ist lesbar.
- [ ] Kein Verwaltungsmodus sichtbar, dafür ein verständlicher Anmelde-Hinweis.

### 2 — Crew, Mobile

- [ ] Operation öffnen: Kopfzeile nennt Titel, Server, Termin, Treffpunkt, Status, Belegung.
- [ ] Flexibel anmelden → Zustand wechselt sichtbar.
- [ ] Frage stellen → sie erscheint.
- [ ] Eigenes Schiff anbieten, eigenen Sitz nehmen, Angebot zurückziehen.
- [x] **[auto]** Kein „Verwalten"-Umschalter, auch nicht per `?mode=manage`.

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

- [x] **[auto]** `/admin` und `/admin/system` erreichbar.
- [x] **[auto]** „Administration" im Menü ist begrifflich getrennt von der „Verwaltung"
      *innerhalb* einer Operation. (Hieß bis 23.08. „Admin / System" — vom Spec gefunden.)

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

### Alte Links (§16) — **[auto]**

Vollständig im Spec abgedeckt. Nur nachsehen, wenn du einen Link kennst, der dort fehlt:

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
