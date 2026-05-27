import type { FastifyInstance } from "fastify";
import JSZip from "jszip";
import { getEnv } from "../config/env.js";
import { logger } from "../services/logger.js";
import {
  consumeDownloadToken,
  peekDownloadToken,
} from "../services/companionDownloads.js";
import {
  fetchCompanionAssetBody,
  fetchLatestCompanionRelease,
} from "../services/githubReleases.js";

/**
 * Public companion-EXE download endpoint.
 *
 *   GET /download/companion/:token
 *
 * The token is the auth — no admin session required. One token =
 * one successful stream; the token row's usedAt is set before the
 * GitHub asset fetch starts so a second click immediately 410s.
 *
 * The asset itself comes from the latest release in GITHUB_REPO,
 * filtered by COMPANION_ASSET_PATTERN. Bridge does not cache the
 * file; each consume re-fetches from GitHub (the file is tens of
 * MB at most + tokens are single-use so this is fine).
 */
export async function registerDownloadRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { token: string }; Querystring: { go?: string } }>(
    "/download/companion/:token",
    async (request, reply) => {
      // Two-step UX: without ?go=1, render a landing page with the
      // SmartScreen-Hinweis + a "Download starten" button. Click goes
      // to the same URL with ?go=1 which actually consumes the token
      // + streams the ZIP. This way recipients can read the warning
      // BEFORE accidentally burning their single-use link.
      if (request.query.go !== "1") {
        const peeked = await peekDownloadToken(request.params.token);
        if (!peeked.ok) {
          const status = peeked.reason === "expired" || peeked.reason === "already_used" ? 410 : 404;
          reply.code(status).type("text/html").send(renderTokenError(peeked.reason));
          return;
        }
        reply.type("text/html").send(renderLandingPage(request.params.token, peeked.label, peeked.expiresAt));
        return;
      }

      // Best-effort downloader fingerprint for the audit row. Not used
      // for auth; just so an admin can tell which token went to whom.
      const ua = String(request.headers["user-agent"] ?? "").slice(0, 200);
      const usedFrom = ua || null;

      const consumed = await consumeDownloadToken({
        rawToken: request.params.token,
        usedFrom: usedFrom ?? undefined,
      });
      if (!consumed.ok) {
        const status = consumed.reason === "expired" || consumed.reason === "already_used" ? 410 : 404;
        reply.code(status).type("text/html").send(renderTokenError(consumed.reason));
        return;
      }

      const release = await fetchLatestCompanionRelease();
      if (!release || !release.asset) {
        logger.warn(
          { tokenId: consumed.id, hasRelease: !!release },
          "download: GitHub release / asset not available — token already consumed though",
        );
        reply
          .code(502)
          .type("text/html")
          .send(
            renderGenericError(
              "Bridge konnte das aktuelle Companion-Release nicht von GitHub holen. " +
                "Der Download-Link wurde trotzdem verbraucht (Sicherheitsmaßnahme); " +
                "lass dir vom Admin einen neuen geben.",
            ),
          );
        return;
      }

      const fetched = await fetchCompanionAssetBody(release.asset);
      if (!fetched) {
        reply
          .code(502)
          .type("text/html")
          .send(
            renderGenericError(
              "Bridge konnte die EXE nicht von GitHub abrufen. Bitte beim Admin melden.",
            ),
          );
        return;
      }

      // Wrap the EXE in a ZIP. Many email gateways / Discord webhooks
      // block raw .exe; .zip slips through. Compression set to STORE
      // (level 0) — an already-compressed binary won't shrink and we
      // save ~600ms of CPU on each download.
      const zip = new JSZip();
      zip.file(release.asset.name, fetched.body, { compression: "STORE" });
      const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
      const zipName = release.asset.name.replace(/\.exe$/i, "") + ".zip";

      logger.info(
        {
          tokenId: consumed.id,
          asset: release.asset.name,
          exeSizeMB: (fetched.size / 1048576).toFixed(2),
          zipSizeMB: (zipBuf.byteLength / 1048576).toFixed(2),
        },
        "download: companion ZIP streaming to client",
      );

      reply
        .header("content-type", "application/zip")
        .header("content-length", String(zipBuf.byteLength))
        .header(
          "content-disposition",
          `attachment; filename="${zipName}"`,
        )
        .header("cache-control", "no-store")
        .send(zipBuf);
    },
  );
}

function renderLandingPage(token: string, label: string, expiresAt: Date): string {
  const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const expText = expiresAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RDOC Squad Link — Download</title>
<style>
  * { box-sizing: border-box; }
  html, body { background: #04060a; color: #c8dce8; font-family: 'Segoe UI', system-ui, sans-serif; margin: 0; padding: 0; min-height: 100vh; }
  body { display: flex; align-items: center; justify-content: center; padding: 24px; }
  main { max-width: 560px; background: #080e14; border: 1px solid rgba(0,212,255,0.28); padding: 32px 36px; position: relative; }
  main::before { content: ''; position: absolute; top: 0; right: 0; width: 10px; height: 10px;
    border-top: 1px solid rgba(0,212,255,0.5); border-right: 1px solid rgba(0,212,255,0.5); }
  .brand { font-family: ui-monospace, Consolas, monospace; font-size: 12px; letter-spacing: 4px; color: #00d4ff; margin-bottom: 6px; }
  .brand em { color: #f0a500; font-style: normal; }
  h1 { font-family: ui-monospace, monospace; font-size: 20px; letter-spacing: 2px; color: #ffffff;
    text-transform: uppercase; margin: 8px 0 24px; }
  p { line-height: 1.55; font-size: 14px; margin: 12px 0; }
  .meta { background: #0c1520; border: 1px solid rgba(0,212,255,0.18); padding: 12px 14px;
    font-family: ui-monospace, monospace; font-size: 12px; margin: 18px 0; }
  .meta .lbl { color: rgba(200,220,232,0.5); font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; }
  .meta .val { color: #f0a500; }
  .smart { background: rgba(240,165,0,0.06); border-left: 3px solid #f0a500; padding: 14px 16px; font-size: 13px; margin: 24px 0; }
  .smart h2 { font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: 2px; color: #f0a500;
    text-transform: uppercase; margin: 0 0 10px; }
  .smart ol { margin: 8px 0 0 20px; padding: 0; }
  .smart li { margin: 6px 0; }
  .smart code { background: #0c1520; padding: 2px 6px; color: #00d4ff; font-size: 12px; }
  .btn { display: block; width: 100%; text-align: center; background: transparent; border: 1px solid #00ff88;
    color: #00ff88; font-family: ui-monospace, monospace; font-size: 13px; letter-spacing: 3px;
    padding: 14px; text-transform: uppercase; text-decoration: none; cursor: pointer;
    transition: background 0.12s; margin-top: 8px; }
  .btn:hover { background: rgba(0,255,136,0.08); }
  .foot { font-family: ui-monospace, monospace; font-size: 9px; color: rgba(200,220,232,0.4);
    letter-spacing: 2px; margin-top: 28px; text-align: center; }
</style>
</head>
<body>
<main>
  <div class="brand">RDOC <em>// SQUAD LINK</em></div>
  <h1>Companion-Download</h1>
  <p>Du bist im Begriff, die Companion-App von RDOC Squad Link herunterzuladen.</p>

  <div class="meta">
    <div><span class="lbl">Für</span> <span class="val">${esc(label)}</span></div>
    <div style="margin-top:6px;"><span class="lbl">Gültig bis</span> ${esc(expText)}</div>
    <div style="margin-top:6px;"><span class="lbl">Nutzungen</span> einmalig</div>
  </div>

  <div class="smart">
    <h2>⚠ Browser & Windows warnen — so klickst du durch</h2>
    <p style="margin-top:4px;">Da die EXE nicht code-signiert ist (privat verteiltes Tool),
       warnen Edge/Chrome <em>UND</em> Windows. Beide einmalig wegklicken:</p>

    <p style="margin: 14px 0 4px; font-family: ui-monospace, monospace; font-size: 11px; color: #f0a500; letter-spacing: 1.5px;">1) BEIM DOWNLOAD (Browser-Warnung)</p>
    <ol style="margin-top: 4px;">
      <li>Browser sagt „Verdächtiger Download blockiert" o. ä.</li>
      <li>In den Browser-Downloads (Strg+J) den blockierten Eintrag suchen</li>
      <li><strong>„Beibehalten"</strong> bzw. <strong>„Trotzdem behalten"</strong> klicken (in Edge ggf. „…" → „Beibehalten")</li>
    </ol>

    <p style="margin: 18px 0 4px; font-family: ui-monospace, monospace; font-size: 11px; color: #f0a500; letter-spacing: 1.5px;">2) BEIM AUSFÜHREN (Windows SmartScreen)</p>
    <ol style="margin-top: 4px;">
      <li>ZIP entpacken (Rechtsklick → „Alle extrahieren")</li>
      <li>Doppelklick auf <code>rdoc-squad-link.exe</code></li>
      <li>SmartScreen-Dialog: Link <strong>„Weitere Informationen"</strong> klicken</li>
      <li>Dann erscheint Button <strong>„Trotzdem ausführen"</strong></li>
    </ol>

    <p style="margin-bottom:0; margin-top: 14px;">Beim zweiten Start ist alles ruhig.</p>
  </div>

  <a class="btn" href="${esc(getEnv().PUBLIC_BASE_PATH)}/download/companion/${esc(token)}?go=1">
    DOWNLOAD STARTEN
  </a>

  <div class="foot">OUR BUSINESS IS CHAOS ITSELF // o7</div>
</main>
</body>
</html>`;
}

function renderTokenError(
  reason: "invalid_token" | "expired" | "already_used",
): string {
  const headline =
    reason === "expired"
      ? "Link abgelaufen"
      : reason === "already_used"
        ? "Link bereits verwendet"
        : "Link ungültig";
  const body =
    reason === "already_used"
      ? "Dieser Download-Link war einmalig und wurde bereits benutzt. Bitte bei deinem Admin um einen neuen."
      : reason === "expired"
        ? "Dieser Download-Link ist abgelaufen. Bitte bei deinem Admin um einen neuen."
        : "Dieser Download-Link ist nicht bekannt. Bitte beim Admin melden.";
  return shellHtml(headline, body);
}

function renderGenericError(msg: string): string {
  return shellHtml("Download fehlgeschlagen", msg);
}

function shellHtml(headline: string, body: string): string {
  const esc = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>${esc(headline)} — RDOC Squad Link</title>
<style>
  html, body { background: #04060a; color: #c8dce8; font-family: system-ui, sans-serif; margin: 0; padding: 40px; }
  main { max-width: 560px; margin: 0 auto; }
  h1 { color: #ff4444; font-size: 18px; margin: 0 0 12px; letter-spacing: 2px; text-transform: uppercase; font-family: ui-monospace, monospace; }
  p { color: #c8dce8; line-height: 1.5; }
  .brand { color: #00d4ff; font-size: 11px; letter-spacing: 3px; margin-bottom: 24px; font-family: ui-monospace, monospace; }
  .brand em { color: #f0a500; font-style: normal; }
</style>
</head>
<body>
<main>
  <div class="brand">RDOC <em>// SQUAD LINK</em></div>
  <h1>${esc(headline)}</h1>
  <p>${esc(body)}</p>
</main>
</body>
</html>`;
}
