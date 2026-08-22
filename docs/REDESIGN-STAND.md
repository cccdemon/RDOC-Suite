# UI/UX-Redesign — Stand zum Wiedereinstieg

> **Wegwerfdokument.** Es hilft nur beim Fortsetzen nach einem Neustart. Sobald das Redesign durch
> ist: löschen. Die Historie steht im [Mergelog](RDOC-SUITE-MERGELOG.md), die inhaltliche Wahrheit in
> der [Matrix](UI-UX-REDESIGN-MATRIX.md) (CLAUDE.md Regel 7).
>
> **Stand:** 2026-08-22, Ende der Sitzung.

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
| 3 — Verwaltungs-IA | **offen, als Nächstes** |
| 4 — Workflow und visuelle Hierarchie | offen |
| 5 — Responsive und Accessibility | offen |
| 6 — Verifikation | offen |

---

## 2. Git

- Aktueller Branch: **`feat/stream-event`** — die gesamte Redesign-Arbeit liegt hier.
- `master` zeigt auf denselben Commit `8f9f48a`.
- **Auf GitHub gepusht.** `origin/master` = `8f9f48a`, verifiziert.
- Worktree sauber.

Die drei Commits dieser Sitzung:

```
8f9f48a  feat(fleetplanner-web): split an operation into a view and a workspace
545c5df  test: pin the controls the redesign is about to move
bcd4006  docs: build the safety net before touching the redesign
```

**Noch nicht erledigt:** der eigene Redesign-Branch. Der auto-mode-Classifier hat
`git checkout -b` blockiert, deshalb sitzt alles auf `feat/stream-event`:

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

---

## 5. Phase 3 — der nächste Schritt

Ziel: Handoff §7. Die Konsole hat heute vier Arbeitsbereiche
([`OperatorConsole.tsx`](../apps/fleetplanner-web/src/components/OperatorConsole.tsx), `TAB_GROUPS`),
aber nicht die Unteransichten, die §7 verlangt.

Arbeitsvorrat, mit den gefallenen Entscheidungen eingearbeitet:

1. **Planung › Briefing & Medien** — `CoverPanel` (heute eigener Tab `cover`),
   `ResourceLinksPanel` (heute an Eckdaten angehängt) und `DocumentsPanel` (heute in der
   **Teilnehmeransicht**) in eine Unteransicht ziehen. Der Dokumenten-Umzug ist der riskanteste
   Einzelschritt — Tests dafür existieren seit `545c5df`.
2. **Planung › Freigabe & Verteilung** — neu. Status mit verständlicher Folgenerklärung,
   `announceOperation`, `getGuildChannels`, Partnerverteilung. Alle vier existieren, aber nur im
   Wizard. Keine API-Änderung.
3. **Kommunikation › Fragen** — `qa` sitzt heute unter *Planung*, gehört nach §7.3 zu Kommunikation.
   Alias `?op=qa` muss weiter auflösen.
4. **Besatzung & Flotte › Offene Arbeit** — neues Dashboard, Standardziel für Operatoren. Die Daten
   liegen komplett in `getOperatorView`.
5. **Verwaltung › Gefahrenbereich** — `deleteOperation` aus `EckdatenForm` herauslösen, Absagen
   danebenstellen, Löschen mit Namensbestätigung. `DangerZone` existiert bereits in
   [`components/ui.tsx`](../apps/fleetplanner-web/src/components/ui.tsx).
6. Bereichsname „Flotte" → „Besatzung & Flotte", **Reihenfolge bleibt**.

Vor Phase 3 fällig (Matrix §6.1): die zwei letzten Testlücken — `VoicePanel`
(`voice-copy`, `voice-assign-all`) und `NeedsEditor` (`needs-notice`, `cqb-size`).

---

## 6. Verifikation — was zuletzt grün war

Alles am 22.08. nach `8f9f48a` gelaufen:

```bash
./scripts/test-stack.sh unit          # Backend  591 Tests, 40 Dateien
./scripts/test-stack.sh unit:web      # SPA      169 Tests, 7 Dateien
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

- **`DocumentsPanel`, Streams und `SquadLinkPanel` liegen weiter in der Teilnehmeransicht.** Ein
  Operator erreicht sie über „Operation ansehen" statt nebenbei. Ein Klick weiter, nicht verloren;
  Phase 3 Punkt 1 räumt das auf.
- **Baseline-Screenshots (§15 Phase 0.5) fehlen.** Sie sichern nichts, was die 25 Bedienweg-Tests
  nicht besser sichern, und kosten einen vollen E2E-Lauf.
- **Fünf Tests in `app.test.tsx` zeigen jetzt auf `?op=fleet`** statt auf die nackte Operations-URL.
  Sie prüfen die Operator-Oberfläche, und die liegt seit Phase 2 im Verwaltungsmodus. Der Alias-Weg
  ist damit mitgetestet.
