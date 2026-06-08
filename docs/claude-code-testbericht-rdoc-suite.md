# Claude Code Testbericht: RDOC-Suite Logiktest

Datum: 2026-06-08

## Scope

Ziel war eine logische Codeanalyse, Pfadanalyse und Testerganzung fuer die RDOC-Suite mit maximal sinnvoller Unit-Test-Abdeckung. Der Voice-Part wurde exklusiv behandelt: keine Voice-/LiveKit-Implementierung wurde geaendert und die Fleetplanner-Coverage-Konfiguration schliesst `livekit.ts`, `*voice*.ts` und `*Voice*.ts` explizit aus.

## Geaenderte Dateien

- `apps/fleetplanner/src/__tests__/services/coverToken.test.ts`
- `apps/fleetplanner/src/__tests__/services/fleetImport.test.ts`
- `apps/fleetplanner/src/__tests__/services/primaryUnits.test.ts`
- `apps/fleetplanner/src/__tests__/web/render.test.ts`
- `apps/fleetplanner/vitest.config.ts`
- `apps/fleetplanner/package.json`
- `pnpm-lock.yaml`

Nicht von diesem Lauf erzeugt oder bearbeitet, aber bereits im Worktree sichtbar:

- `apps/monitoring/alerts.yml`
- `addOns/`
- `msi/`
- `nsis/`

## Codeanalyse

Die RDOC-Suite ist ein pnpm-Monorepo mit mehreren Workspaces. Der testbare Kern fuer diesen Lauf war `@rdoc-suite/fleetplanner`, weil dort bereits stabile Vitest-Tests und isolierbare Domainlogik vorhanden sind.

Relevante Nicht-Voice-Logik mit hoher Testwirkung:

- `services/coverToken.ts`: HMAC-basierte Capability-Tokens fuer Mission-Cover.
- `services/fleetImport.ts`: Import, Normalisierung, Fuzzy-Matching und Deduplizierung von User-Fleet-Daten.
- `services/primaryUnits.ts`: Entscheidung, welche Einheit fuer Nutzer mit mehreren Zuordnungen primaer ist.
- `web/render.ts`: XSS-sicherer HTML-/Markdown-Renderer.

Diese Module haben viele Entscheidungszweige, sind aber ohne echte Datenbank, Discord, LiveKit oder HTTP-Server testbar.

## Pfadanalyse

Gepruefte Kontrollpfade:

- Gueltiger Token: Payload wird signiert, `exp` gesetzt, Signatur verifiziert.
- Ungueltiger Token: falsches Secret, manipulierte Signatur, fehlender Trenner, abgelaufenes `exp`.
- Fleet-Import: ungueltiges JSON, Nicht-Array, exakter Namensmatch, Token-Subset-Match, Substring-Fallback, Unmatched-Deduplizierung, Nickname-Trimming, 80-Zeichen-Kappung, 1000-Entry-Limit.
- Primary Unit: leere Liste, Squad-vor-Ship-Regel, Captain/Seat-Gruppierung ohne Duplikate, gueltige explizite Auswahl, stale Auswahl mit Fallback, ungueltige Auswahl mit Fehler, Multi-Position-Ausgabe sortiert nach Username.
- Renderer: Escaping von Sonderzeichen, SafeHtml-Bypass nur fuer markierte Werte, Array-Rendering, Null/False-Suppression, Markdown-Headings, Bold, Italic, Code, HTTP-Link, Nicht-HTTP-Link, Script-Escaping.

## Zusammenspiel

Die neuen Tests pruefen bewusst Schnittstellen zwischen kleineren Bausteinen:

- `fleetImport` koppelt JSON-Eingaben, lokale Ship-Katalogdaten und `userShip`-Persistenz.
- `primaryUnits` koppelt akzeptierte Fleet-Units, Seats, Captains, explizite Primary-Choices und UI-Ausgabedaten.
- `render` schuetzt alle serverseitig gerenderten Seiten gegen ungefilterte HTML-Ausgabe.
- `coverToken` sichert die Verbindung zwischen Fleetplanner und Mission-Cover ueber signierte Capability-Tokens.

Damit decken die Tests nicht nur Einzelzeilen ab, sondern pruefen die fachlichen Uebergaenge zwischen Input, Entscheidung und Persistenz-/Ausgabe-Aufruf.

## Testresultate

Ausgefuehrte Kommandos:

```powershell
pnpm --filter @rdoc-suite/fleetplanner test
pnpm --filter @rdoc-suite/shared test
pnpm --filter @rdoc-suite/bridge test
pnpm --filter @rdoc-suite/fleetplanner exec vitest run --coverage
pnpm -r --if-present test
```

Ergebnisse:

- Fleetplanner: `25 passed`, `275 passed`.
- Shared: `1 passed`, `13 passed`.
- Bridge: `8 passed`, `1 failed`; insgesamt `87 passed`, `9 failed`.
- Workspace gesamt: blockiert durch `apps/mission-cover`, weil `vitest` dort nicht gefunden wird.

## Coverage

Coverage wurde fuer Fleetplanner eingerichtet mit `@vitest/coverage-v8` und `json-summary`-Report.

Gesamt-Coverage fuer streng eingeschlossenen Nicht-Voice-Quellcode:

- Statements: `12.09%`
- Branches: `9.56%`
- Functions: `11.55%`
- Lines: `11.59%`

Diese Gesamtzahl ist niedrig, weil grosse Fastify-Routen und serverseitige Page-Renderer aktuell noch keine Injection-/Page-Tests haben und daher mit `0%` eingehen.

Hohe Abdeckung in den neu oder bereits fokussiert getesteten Logikmodulen:

- `services/fleetImport.ts`: Lines `97.61%`, Branches `96.15%`
- `services/primaryUnits.ts`: Lines `95.55%`, Branches `75.67%`
- `services/coverToken.ts`: Lines `88.88%`, Branches `100%`
- `web/render.ts`: Lines `88.46%`, Functions `90.9%`
- `services/participants.ts`: Lines `100%`
- `services/seats.ts`: Lines `90.47%`
- `services/secrets.ts`: Lines `94.73%`

Coverage-Datei:

- `apps/fleetplanner/coverage/coverage-summary.json`

## Blocker und Befunde

1. Workspace-Testlauf bricht bei `apps/mission-cover` ab.

   Fehlerbild: `vitest` wird nicht gefunden. Vermutlich fehlt dort eine lokale Dev-Dependency oder die Workspace-Aufloesung ist unvollstaendig.

2. Bridge-WebSocket-Tests schlagen bestehend fehl.

   Fehlerbild: mehrere Tests erwarten `bridge:joined`, erhalten aber `error`; weitere Tests laufen in `ws message timeout`. Betroffen ist `apps/bridge/src/__tests__/ws.test.ts`.

3. Coverage war initial nicht ausfuehrbar.

   Fehlerbild: `Cannot find dependency '@vitest/coverage-v8'`. Behoben fuer Fleetplanner durch Dev-Dependency in `apps/fleetplanner/package.json`.

4. Voice-Part bleibt ausgenommen.

   Tests und Coverage-Konfiguration schliessen Voice-/LiveKit-Dateien im Fleetplanner aus. Bestehende Bridge-WS-Tests koennen fachlich Voice-nahe sein, wurden aber nicht veraendert.

## Empfehlung fuer naechste Claude-Code-Runde

Prioritaet 1: `apps/mission-cover` testbar machen, damit `pnpm -r --if-present test` nicht frueh abbricht.

Prioritaet 2: Bridge-WS-Fehler isolieren. Direkt beim ersten Server-Reply sollte der konkrete `error`-Payload geloggt werden, danach Ursache pruefen: Token-Verifikation, Test-Setup-Env, LiveKit-Credential-Erzeugung oder Gate-Logik.

Prioritaet 3: Fleetplanner-Injection-Tests fuer `app.ts` und die wichtigsten Routen ergaenzen. Das ist der groesste Hebel fuer echte Gesamt-Coverage.

Prioritaet 4: Page-Renderer gezielt testen oder aus Coverage herausnehmen, falls `pages.ts` als serverseitige Template-Schicht nicht als Unit-Coverage-Ziel gelten soll.

Prioritaet 5: Weitere Nicht-Voice-Service-Tests fuer `eventDistribution`, `eventInterest`, `coverService`, `locations`, `shipSync`, `discordDiagnostics` und `cqb` ergaenzen.
