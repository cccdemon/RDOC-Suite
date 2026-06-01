# Fleetplanner — Sicherheitsbericht

**Stand:** 2026-06-01 | **Reviewer:** Claude Sonnet 4.6 (statische Analyse)
**Scope:** `apps/fleetplanner/src/` | **Stack:** Fastify 5 + Prisma 6 + SQLite + Discord/GitHub/Google OAuth

---

## Zusammenfassung

| Priorität      | Anzahl |
| -------------- | ------ |
| 🔴 Kritisch    | 0      |
| 🟡 Mittel      | 3      |
| 🟢 Niedrig     | 4      |

Keine SQL-Injection-Vektoren. Keine XSS-Vektoren. CSRF-Schutz vorhanden.
Gesamtbild: solide Basis — drei mittlere Lücken sollten behoben werden.

---

## 🔴 Kritisch — keine gefunden

---

## 🟡 Mittel

### M1 — Kein Rate Limiting auf Auth-Endpunkten

**Datei:** `src/app.ts` / `package.json`

`@fastify/rate-limit` fehlt komplett in den Dependencies. OAuth-Callback-, Login- und
Token-Endpunkte sind ohne Gegenwehr unbegrenzt treffbar.

**Risiko:** Brute-Force auf `/auth/discord/callback`, `/auth/companion/callback`,
`/api/ops/:id/voice-token`; DoS durch Massen-Requests.

**Fix:**

```bash
pnpm add @fastify/rate-limit
```

```typescript
// app.ts — nach Plugin-Registrierung
await app.register(import("@fastify/rate-limit"), {
  max: 60,
  timeWindow: "1 minute",
  keyGenerator: (req) => req.ip,
});
// Auth-Routen enger drosseln:
app.register(authRoutes, { rateLimit: { max: 10, timeWindow: "1 minute" } });
```

---

### M2 — Discord-Bot-Tokens im Diagnostics-Objekt

**Datei:** `src/services/discordDiagnostics.ts:226,238`

`DISCORD_RDOCRTC_BOT_TOKEN` und `DISCORD_FLEETPLANNER_BOT_TOKEN` werden in das
Diagnostics-Objekt geschrieben. Falls dieses Objekt in einer HTTP-Antwort oder einem
Log landet → Token-Leak.

**Fix:** Statt vollem Token nur Länge/Prefix ausgeben:

```typescript
rdocrtcBotToken: env.DISCORD_RDOCRTC_BOT_TOKEN
  ? `set (len=${env.DISCORD_RDOCRTC_BOT_TOKEN.length})`
  : "unset",
fleetplannerBotToken: env.DISCORD_FLEETPLANNER_BOT_TOKEN
  ? `set (len=${env.DISCORD_FLEETPLANNER_BOT_TOKEN.length})`
  : "unset",
```

---

### M3 — Fehlender Guild-Membership-Check im voice-token-Endpunkt

**Datei:** `src/routes/api.ts:1008`

Fleetoperators dürfen `?unitId=<UUID>` frei übergeben. Zeile 1031 prüft `operationId` +
`status:"accepted"`, aber **nicht**, ob der Caller zur Guild der Operation gehört.
Ein Fleetoperator einer anderen Guild kann — sofern er eine `operationId` kennt oder errät —
einen LiveKit-Token für eine fremde Unit erhalten.

**Fix:** Guild-Zugehörigkeit vor Token-Ausstellung prüfen:

```typescript
// Nach op-lookup, vor unit-lookup:
const membership = await prisma.guildMembership.findFirst({
  where: { guildId: op.guildId, userId },
});
if (!membership) return reply.code(403).send({ error: "Not a member of this guild" });
```

---

## 🟢 Niedrig / Info

### L1 — Session-Expiry-Check: `<` statt `<=`

**Datei:** `src/auth/session.ts:24`

Exakt-Gleichheit bei `expiresAt === now` → Session fälschlicherweise abgelehnt.
Minimales Risiko, aber inkonsistent mit OAuth-State-Checks im selben Codebase.

**Fix:** `expiresAt <= new Date()` → Session abgelaufen.

---

### L2 — SESSION_SECRET als Encryption-Key-Fallback

**Datei:** `src/services/secrets.ts:13`

Wenn `VOICEBOT_ENCRYPTION_KEY` nicht gesetzt → Fallback auf `SESSION_SECRET`.
Session-Secret-Rotation (z.B. nach Compromise) bricht dann alle gespeicherten
Bot-Tokens still.

**Status:** Im Code und in CLAUDE.md dokumentiert. Kein akuter Bug, operatives Risiko.

**Empfehlung:** `VOICEBOT_ENCRYPTION_KEY` in `.env.example` als **required** markieren.

---

### L3 — Companion-Session-Token-Format inkonsistent

**Datei:** `src/auth/companionSession.ts:19`

`randomHex(32)` (256-bit) statt `crypto.randomUUID()` (128-bit) — technisch sicherer,
aber inkonsistent mit restlichem Code. Kein Sicherheitsproblem.

---

### L4 — Fehlende Entropy-Validierung für SESSION_SECRET

**Datei:** `src/config/env.ts:8`

`z.string().min(32)` prüft nur Länge, nicht Entropie. Ein String wie
`"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"` würde die Validierung bestehen.

**Empfehlung:** Docs-Hinweis auf `openssl rand -hex 32` für Secret-Generierung;
optional Zod-Refine mit Entropie-Schätzung.

---

## Keine Befunde in folgenden Kategorien

| Kategorie       | Ergebnis |
| --------------- | -------- |
| SQL Injection   | ✅ Keine — Prisma ORM, ausschließlich parametrisierte Queries; kein `$queryRaw`/`$executeRaw` mit String-Interpolation |
| XSS             | ✅ Keine — Template-Engine escaped User-Input standardmäßig; kein `{{{unescaped}}}` Pattern |
| CSRF            | ✅ Vorhanden — State-ändernde Routen prüfen `_csrf`-Field |
| Discord OAuth   | ✅ Korrekt — State-Parameter nach Verwendung invalidiert; Redirect-Validierung vorhanden |
| Path Traversal  | ✅ Keine — kein Filesystem-Zugriff mit User-Input |
| IDOR (allg.)    | ✅ Ownership-Checks vorhanden — Ausnahme: M3 oben |

---

## Encryption-Bewertung (`secrets.ts`)

| Maßnahme              | Status |
| --------------------- | ------ |
| AES-256-GCM           | ✅     |
| Random Salt pro Encrypt | ✅   |
| Random IV pro Encrypt | ✅     |
| scrypt Key Derivation | ✅     |
| GCM Auth-Tag geprüft  | ✅     |

Encryption-Implementierung ist korrekt und sicher.

---

## Dependencies — keine bekannten CVEs

| Package              | Version  | Status        |
| -------------------- | -------- | ------------- |
| fastify              | ^5.2.1   | ✅ kein CVE   |
| @prisma/client       | ^6.19.3  | ✅ kein CVE   |
| livekit-server-sdk   | ^2.13.0  | ✅ kein CVE   |
| zod                  | ^3.24.1  | ✅ kein CVE   |
| @fastify/cookie      | ^11.0.1  | ✅ kein CVE   |
| @fastify/formbody    | ^8.0.1   | ✅ kein CVE   |

---

## Priorisierte Maßnahmenliste

1. **M1 — Rate Limiting** hinzufügen — einfach, hoher Schutzwert
2. **M2 — Diagnostics-Token-Leak** fixen — 2-Zeilen-Änderung
3. **M3 — Guild-Check** bei fleetoperator voice-token — prüfen ob anderswo bereits gecheckt
4. **L1 — Session-Expiry-Operator** — Trivia-Fix, `<` → `<=`
5. **L2 — `.env.example`** — `VOICEBOT_ENCRYPTION_KEY` als required markieren
