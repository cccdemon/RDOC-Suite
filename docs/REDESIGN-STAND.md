# UI/UX-Redesign — Stand zum Wiedereinstieg

> **Wegwerfdokument.** Es hilft nur beim Fortsetzen nach einem Neustart. Sobald das Redesign durch
> ist: löschen. Die Historie steht im [Mergelog](RDOC-SUITE-MERGELOG.md), die inhaltliche Wahrheit in
> der [Matrix](UI-UX-REDESIGN-MATRIX.md) (CLAUDE.md Regel 7).
>
> **Stand:** 2026-08-23, nach Phase 5.

---

## 1. Wo wir stehen

Umgesetzt wird [`UI-UX-WORKFLOW-REDESIGN-CLAUDE-OPUS.md`](UI-UX-WORKFLOW-REDESIGN-CLAUDE-OPUS.md),
Phasenmodell aus dessen §15.

| Phase | Stand |
|---|---|
| 0 — Inventar und Sicherungsnetz | **fertig** (`bcd4006`), ausser 0.5 Baseline-Screenshots — bewusst weggelassen |
| 0.4 — Tests für die umziehenden Bedienelemente | **fertig** (`545c5df`), 25 Tests |
| 1 — Gates und Kontextfehler | **fertig ohne Codeänderung** — alle fünf §2.3-Risiken waren schon behoben und getestet |
| 2 — OperationShell, Ansehen gegen Verwalten | **fertig** (`8f9f48a`) |
| 3 — Verwaltungs-IA | **fertig** — Briefing & Medien, Freigabe & Verteilung, Offene Arbeit, Gefahrenbereich |
| 4 — Workflow und visuelle Hierarchie | **fertig** — Wizard, Kontrast, Aktionsrang, Kartentypen, Monospace |
| 5 — Responsive und Accessibility | **fertig** |
| 6 — Verifikation | **offen, als Nächstes** |

---

## 2. Git

Die gesamte Redesign-Arbeit liegt auf **`feat/stream-event`**; `master` wird jeweils per
Fast-Forward nachgezogen und über den gh-Credential-Helper gepusht (CLAUDE.md Regel 4):

```bash
git branch -f master feat/stream-event
git -c credential.helper="!gh auth git-credential" push https://github.com/cccdemon/RDOC-Suite.git master
```

Aktuellen Stand mit `git log --oneline -12` lesen — Hashes hier zu pflegen veraltet mit jedem
Commit. Die Commits tragen die Phase im Text.

**Noch nicht erledigt:** der eigene Redesign-Branch. Der auto-mode-Classifier hat `git checkout -b`
blockiert, deshalb sitzt alles auf `feat/stream-event`:

```bash
git checkout -b feat/ui-ux-redesign
```

Nicht deployt. Deploy machst du normalerweise selbst (CLAUDE.md Regel 3).

---

## 3. Entscheidungen, die schon gefallen sind

Vom User am 22.08. bestätigt — nicht neu aufmachen:

| Frage | Entscheidung |
|---|---|
| Reihenfolge der Arbeitsbereiche | **Flotte zuerst** behalten (tägliche Arbeit schlägt Lebenszyklus), nicht die Handoff-Reihenfolge „Planung zuerst" |
| „Freigabe & Verteilung" in der Verwaltung | **ja, zusätzlich** — der Wizard behält Ankündigung und Partnerwahl |
| `deleteOperation` aus `EckdatenForm` | **ja**, in einen Gefahrenbereich mit Namensbestätigung |
| Phase 2 bauen | ja — erledigt |

---

## 4. Was Phase 2 gebaut hat

Neue Dateien:

- [`src/operationMode.ts`](../apps/fleetplanner-web/src/operationMode.ts) — Modusauflösung aus der
  URL. Eigenes Modul, weil jeder alte Deep Link daran hängt.
- [`src/components/OperationShell.tsx`](../apps/fleetplanner-web/src/components/OperationShell.tsx) —
  Breadcrumb, Objektkopf, Moduswechsel.
- [`src/components/opStatus.ts`](../apps/fleetplanner-web/src/components/opStatus.ts) —
  Statusvokabular an einer Stelle.

Regeln der Modusauflösung, die beim Weiterbauen gelten:

- `?mode=view` / `?mode=manage` sind explizit.
- Ein `?op=`, `?sub=` oder `?section=` in der URL bedeutet **Verwaltung** — so landet jeder
  Konsolen-Tablink und der `/ops/:id/manage`-Redirect im richtigen Modus.
- Ohne alles: Ansehen.
- `manage` nur bei `canManage`. Oberfläche, nicht Autorisierung — der Server prüft ohnehin.
- Zurück ins Ansehen fällt der Tab mit aus der URL, sonst ist ein kopierter Link ein Konsolenlink.

**Falle, die schon einmal zugeschnappt ist:** `OperatorConsole.setTab` darf `mode` **nicht** aus der
URL löschen. Sie räumte dort früher `sub`, `section` und `mode` weg; sobald `mode` etwas bedeutet,
wirft das den Operator beim ersten Tabklick aus der Verwaltung. Regressionstest steht in
`nav.test.tsx` („stays in the workspace when the operator changes tab").


### 4.1 Was Phase 3 gebaut hat

Neue Komponenten, alle unter `apps/fleetplanner-web/src/components/`:

- `OpenWorkPanel.tsx` — Standardziel der Verwaltung. Die Zählung ist die reine Funktion `openWork`
  und ohne DOM testbar.
- `ReleasePanel.tsx` — Statuserklärung, Ankündigung, Partner-Reichweite.
- `AnnouncePanel.tsx` — aus dem Wizard extrahiert, jetzt an beiden Orten dieselbe Komponente.
- `DangerPanel.tsx` — Abschließen/Absagen getrennt vom Löschen; Löschen verlangt den Namen.

Zwei Dinge, die beim Weiterbauen zählen:

- **`partnerTargetGuildIds` ist create-only.** Es gibt keinen PATCH-Pfad. Die Partnerverteilung wird
  deshalb angezeigt und nicht angeboten. Wer sie editierbar machen will, braucht zuerst Contract,
  Service und Route — das ist Backend-Arbeit und war nicht im Scope.
- **Deutsche Anführungszeichen in JS-Stringliteralen** brauchen `„…“`. Ein `„…"` beendet den String;
  das hat im `ReleasePanel` einmal zugeschlagen und produziert kryptische `TS1005`-Kaskaden.


### 4.2 Was Phase 4a gebaut hat

- `styles.css` — die Tokens `--dim`, `--dim2`, `--dim3` sind literale Hexwerte mit dem gemessenen
  Verhältnis als Kommentar. Vorher `color-mix` zum Hintergrund hin, und damit unter AA.
- `src/test/contrast.test.ts` liest die Stylesheet-Datei und rechnet nach. Der dazu nötige
  `node:fs`-Zugriff hängt an `src/test/node-shim.d.ts`, das genau zwei Signaturen deklariert —
  `@types/node` würde dem Browser-Paket eine viel zu breite Typfläche geben.
- `WizardPage` — vier benannte Wege aus dem Erfolgszustand; alle alten Testids erhalten.


### 4.3 Was Phase 4b geändert hat

- `ui.tsx` ist die Quelle: `btnPrimary` gefüllt, `btnGhost` leise, beide plus `inp` in
  `var(--body)`. Eine Datei, 26 Buttons und 40 Felder.
- Die Panels aus Phase 2 und 3 deklarieren ihren `data-card`-Typ. `cards.test.tsx` prüft die
  Vokabel gegen das, was `styles.css` tatsächlich stylt.
- „Vorlage & Serie" ist zwei Karten mit je einer Hauptaktion.

**Nachtrag zur Zahl:** „rund 350 Fundstellen" war der rohe `MONO`-Token-Count. Nachgezählt sind es
30 Stellen, an denen Monospace wirklich falsch stand; der Rest sind Versalien-Eyebrows, Zähler und
Zeiten. Erledigt in Phase 5a.

---

## 5. Was noch offen ist

Nur noch **Phase 6 — Verifikation** (§15 Phase 6, §17). Das ist Handarbeit am laufenden Stack:

- Rollenmatrix Gast / Crew / Operator / Superadmin, je Desktop und Mobile.
- Die zehn Abnahmeszenarien aus §17 — vom Gast auf dem Telefon bis zum Multi-Guild-Deep-Link mit
  ungültiger Guild-ID.

Eine Testsuite nimmt das nicht ab: 219 SPA-Tests und 119 Playwright-Tests sagen, dass die Bedienwege
funktionieren, nicht dass ein Operator ohne Handbuch weiß, was als Nächstes dran ist. Genau das ist
die Frage aus §19.

### Fallen, die schon zugeschnappt sind

- **`OperatorConsole.setTab` darf `mode` nicht aus der URL löschen** — sonst fliegt der Operator beim
  ersten Tabklick aus der Verwaltung. Regressionstest in `nav.test.tsx`.
- **Ein Inline-`minHeight` schlägt jede Media Query.** Deshalb liegt die Höhe interaktiver Flächen im
  Stylesheet und nicht im Style-Objekt; `stylesheet.test.ts` hält das fest.
- **Deutsche Anführungszeichen in JS-Stringliteralen** brauchen `„…“`. Ein `„…"` beendet den String
  und produziert eine `TS1005`-Kaskade.
- **`partnerTargetGuildIds` ist create-only** — die Partnerverteilung wird angezeigt, nicht angeboten.
- **Eine CSS-Regel, die inline gesetzte Werte treffen soll, trifft sie nicht.** Die verworfene
  `:has()`-Regel für Icon-Button-Breiten wäre an genau den Buttons vorbeigegangen, für die sie
  gedacht war.

## 6. Verifikation — was zuletzt grün war

Alles am 23.08. nach dem letzten Phase-5b-Commit gelaufen:

Unter Windows über Git Bash (`bash scripts/test-stack.sh …`) oder direkt mit
`docker compose -f docker-compose.test.yml …`.

```bash
./scripts/test-stack.sh unit          # Backend  591 Tests, 40 Dateien
./scripts/test-stack.sh unit:web      # SPA      219 Tests, 9 Dateien
./scripts/test-stack.sh up            # Stack hoch (web :8099, api :3299, mock :4400)
./scripts/test-stack.sh e2e           # Playwright 119 passed, 3 skipped
./scripts/test-stack.sh smoke         # grün
./scripts/test-stack.sh down
docker compose -f docker-compose.test.yml build fleetplanner-web   # tsc --noEmit + vite build
```

Die 3 übersprungenen E2E sind `19-cover` — die brauchen `./scripts/test-stack.sh up --with-cover`
(zieht ein ~800 MB Chromium-Image).

---

## 7. Bewusste Zwischenstände — keine Auslassungen

- **Dokumente sind in Phase 3 umgezogen** und liegen jetzt in Verwalten › Briefing & Medien; auf der
  Teilnehmerseite sind sie nur noch lesbar. Streams und `SquadLinkPanel` bleiben in der
  Teilnehmeransicht — dort gehören sie fachlich hin.
- **Baseline-Screenshots (§15 Phase 0.5) fehlen.** Sie sichern nichts, was die 25 Bedienweg-Tests
  nicht besser sichern, und kosten einen vollen E2E-Lauf.
- **Fünf Tests in `app.test.tsx` zeigen jetzt auf `?op=fleet`** statt auf die nackte Operations-URL.
  Sie prüfen die Operator-Oberfläche, und die liegt seit Phase 2 im Verwaltungsmodus. Der Alias-Weg
  ist damit mitgetestet.
