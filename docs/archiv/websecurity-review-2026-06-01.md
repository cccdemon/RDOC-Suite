# WebSecurity Review 2 - Fleetplanner Livestand

**Datum:** 2026-06-01  
**Ziel:** `https://suite.raumdock.org/fleetplanner`  
**Art:** Passiver externer Check ohne Login, ohne destruktive Tests, ohne Lasttest  
**Reviewer:** Codex

## Kurzfazit

Der Fleetplanner-Livestand ist ueber HTTPS erreichbar, nutzt ein gueltiges Let's-Encrypt-Zertifikat und schuetzt Admin-Routen ohne Session durch Redirect auf `/fleetplanner/login`. Typische versehentlich veroeffentlichte Dateien wie `.env`, `.git/config`, `package.json`, `docker-compose.yml` und `prisma/schema.prisma` waren nicht abrufbar.

Die wichtigsten von aussen sichtbaren Probleme liegen aktuell in der HTTP/Browser-Hardening-Schicht:

| Prioritaet | Befund |
| --- | --- |
| Mittel | Wichtige Browser-Security-Header fehlen auf HTML-Antworten |
| Niedrig | HTTP Port 80 liefert `404` statt konsequent auf HTTPS umzuleiten |
| Info | Unauthentifizierter Check kann Cookie-Flags und eingeloggte Rollenlogik nicht bewerten |

## Gepruefte Oberflaeche

| URL / Pfad | Ergebnis |
| --- | --- |
| `https://suite.raumdock.org/fleetplanner` | `302 Found` nach `/fleetplanner/login` |
| `https://suite.raumdock.org/fleetplanner/login` | `200 OK`, `text/html; charset=utf-8` |
| `https://suite.raumdock.org/fleetplanner/admin` | `302 Found` nach `/fleetplanner/login` |
| `https://suite.raumdock.org/fleetplanner/admin/bridge` | `302 Found` nach `/fleetplanner/login` |
| `https://suite.raumdock.org/fleetplanner/.env` | `404` |
| `https://suite.raumdock.org/fleetplanner/.git/config` | `404` |
| `https://suite.raumdock.org/fleetplanner/package.json` | `404` |
| `https://suite.raumdock.org/fleetplanner/prisma/schema.prisma` | `404` |
| `https://suite.raumdock.org/fleetplanner/docker-compose.yml` | `404` |
| `https://suite.raumdock.org/fleetplanner/api/operations` | `404` ohne Session |

## TLS und Zertifikat

| Merkmal | Wert |
| --- | --- |
| Protokoll | TLS 1.3 |
| Zertifikat | `CN=suite.raumdock.org` |
| Issuer | Let's Encrypt `YE2` |
| Gueltig ab | 2026-05-30 01:02:28 |
| Gueltig bis | 2026-08-28 01:02:27 |

Bewertung: TLS wirkt fuer den geprueften Host gesund. Eine vollstaendige Cipher-/Protocol-Matrix wurde nicht gefahren, da der Review bewusst passiv und leichtgewichtig blieb.

## Befunde

### M1 - Fehlende Browser-Security-Header

**Prioritaet:** Mittel  
**Nachweis:** Die HTML-Antwort von `/fleetplanner/login` enthielt nur:

```http
HTTP/1.1 200 OK
Alt-Svc: h3=":9443"; ma=2592000
Content-Length: 37216
Content-Type: text/html; charset=utf-8
Via: 1.1 Caddy
```

Nicht sichtbar waren unter anderem:

| Header | Zweck |
| --- | --- |
| `Strict-Transport-Security` | Erzwingt HTTPS im Browser nach dem ersten sicheren Besuch |
| `Content-Security-Policy` | Reduziert XSS-Folgen und kontrolliert erlaubte Script-/Style-/Frame-Quellen |
| `X-Content-Type-Options: nosniff` | Verhindert MIME-Sniffing |
| `Referrer-Policy` | Reduziert ungewollte Referrer-Leaks |
| `Permissions-Policy` | Deaktiviert unbenoetigte Browser-APIs |
| `X-Frame-Options` oder CSP `frame-ancestors` | Reduziert Clickjacking-Risiko |

**Risiko:** Ohne diese Header verlassen sich Browser auf weniger restriktive Defaults. Besonders fehlende CSP/Frame-Policy/HSTS erhoehen die Auswirkungen von XSS, Clickjacking oder unsicheren Erstaufrufen.

**Empfohlene Massnahme:** Header zentral im Reverse Proxy oder in Fastify setzen. Beispiel fuer Caddy:

```caddyfile
header {
  Strict-Transport-Security "max-age=31536000; includeSubDomains"
  X-Content-Type-Options "nosniff"
  Referrer-Policy "strict-origin-when-cross-origin"
  Permissions-Policy "camera=(), microphone=(), geolocation=()"
  X-Frame-Options "DENY"
}
```

Fuer CSP zuerst mit `Content-Security-Policy-Report-Only` starten und die echten Asset-Anforderungen messen. Da die Login-Seite Inline-Styles enthaelt, ist eine sofort harte CSP ohne Anpassung wahrscheinlich nicht kompatibel. Zielbild:

```http
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self'; script-src 'self'
```

Falls Inline-Styles kurzfristig bleiben muessen, `style-src 'self' 'unsafe-inline'` nur als Uebergang verwenden und danach auf Nonces oder externe Stylesheets umbauen.

### L1 - HTTP leitet nicht auf HTTPS um

**Prioritaet:** Niedrig  
**Nachweis:**

```http
HTTP/1.1 404 Not Found
Server: nginx
Content-Type: text/html
Content-Length: 146
```

Aufruf: `http://suite.raumdock.org/fleetplanner`

**Risiko:** Die HTTP-Variante liefert zwar keinen Fleetplanner-Inhalt aus, aber Nutzer und alte Links werden nicht automatisch auf die sichere Variante gebracht. In Kombination mit fehlendem HSTS gibt es keinen sauberen Browser-Upgrade-Pfad.

**Empfohlene Massnahme:** Port 80 fuer `suite.raumdock.org` immer auf HTTPS umleiten:

```nginx
server {
  listen 80;
  server_name suite.raumdock.org;
  return 301 https://$host$request_uri;
}
```

Danach HSTS aktivieren. `includeSubDomains` und `preload` erst setzen, wenn alle Subdomains dauerhaft HTTPS-faehig sind.

### I1 - Cookie-Flags nicht bewertbar ohne Login

**Prioritaet:** Info  
**Nachweis:** Die geprueften unauthentifizierten Antworten setzten keinen `Set-Cookie`-Header.

**Bewertung:** Dadurch konnten `Secure`, `HttpOnly` und `SameSite` fuer Session-Cookies im Livebetrieb nicht von aussen verifiziert werden.

**Sollzustand:**

```http
Set-Cookie: ...; Secure; HttpOnly; SameSite=Lax
```

Fuer OAuth-Flows ist `SameSite=Lax` meist praktikabel. Wenn eingebettete Cross-Site-Flows noetig sind, muss `SameSite=None; Secure` bewusst begruendet werden.

## Positive Ergebnisse

| Bereich | Ergebnis |
| --- | --- |
| TLS | Gueltiges Zertifikat, TLS 1.3 |
| Auth-Gating | `/fleetplanner`, `/admin`, `/admin/bridge` leiten ohne Session auf Login |
| Sensitive Dateien | `.env`, `.git/config`, `package.json`, `docker-compose.yml`, Prisma-Schema nicht abrufbar |
| API ohne Session | Der gepruefte API-Pfad `/fleetplanner/api/operations` war nicht oeffentlich nutzbar |
| Server-Banner HTTPS | Kein direkter App-Stack-Banner, nur `Via: 1.1 Caddy` |

## Priorisierte Massnahmenliste

1. Security-Header zentral fuer alle Fleetplanner-HTML- und API-Antworten setzen.
2. HTTP Port 80 fuer `suite.raumdock.org` per `301` auf HTTPS umleiten.
3. CSP zunaechst als Report-Only ausrollen, Inline-Styles abbauen und danach enforce aktivieren.
4. Nach Login Session-Cookie-Flags verifizieren: `Secure`, `HttpOnly`, `SameSite`.
5. Einen kleinen Regression-Test oder Monitoring-Check fuer Header und Redirects ergaenzen.

## Grenzen des Reviews

Dieser Review war bewusst passiv und unauthentifiziert. Nicht geprueft wurden:

| Nicht geprueft | Grund |
| --- | --- |
| Rollen- und Mandantenlogik nach Login | Keine Live-Credentials im Scope |
| CSRF im eingeloggten Zustand | Keine Session im Scope |
| Rate Limiting unter Last | Kein Lasttest ohne explizite Freigabe |
| Aktive Schwachstellenscans | Nicht notwendig fuer den angefragten extern sichtbaren Kurzcheck |
| Dependency-CVEs der deployten Artefakte | Von aussen nicht verlaesslich bestimmbar |
