import type { FastifyInstance, FastifyReply } from "fastify";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normShipName } from "../services/fleetyards.js";
// API-only backend: this router serves ONLY data/file endpoints — mission
// images and per-op .ics/.csv exports. All UI (incl. info/legal pages) lives in
// the fleetplanner-web SPA. Do not add HTML/JS routes here.
import { optionalAuth } from "../auth/middleware.js";
import { effectiveOpRole } from "../services/guilds.js";
import { getEnv } from "../config/env.js";
import { prisma } from "../db.js";
import { buildOpIcs } from "../lib/calendar.js";
import { getOperation } from "../services/operations.js";
import { getMissionParticipants, participantsToCsv } from "../services/participants.js";
import { getDocContent } from "../api/docContent.js";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../public");

// ── SEO helpers (shared by the crawler-only meta routes below). ────────────
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// JSON-LD must not break out of the <script> — escape "<" to <.
function jsonLdScript(obj: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
}

// Indexable crawler HTML doc (unlike the unfurl cards: NO meta-refresh). Carries
// a real <head> + body text so search engines index the public URL without
// running the SPA's JS. nginx routes only crawler user-agents here.
function seoDoc(o: {
  title: string;
  description: string;
  canonical: string;
  body: string;
  image?: string;
  jsonLd?: string;
  noindex?: boolean;
  lang?: string;
}): string {
  const fullTitle = o.title.includes("RDOC Fleetplanner") ? o.title : `${o.title} — RDOC Fleetplanner`;
  return (
    `<!doctype html><html lang="${o.lang ?? "de"}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(fullTitle)}</title>` +
    `<meta name="description" content="${esc(o.description)}">` +
    `<meta name="robots" content="${o.noindex ? "noindex, nofollow" : "index, follow"}">` +
    `<link rel="canonical" href="${esc(o.canonical)}">` +
    `<meta property="og:type" content="website">` +
    `<meta property="og:site_name" content="RDOC Fleetplanner">` +
    `<meta property="og:title" content="${esc(fullTitle)}">` +
    `<meta property="og:description" content="${esc(o.description)}">` +
    `<meta property="og:url" content="${esc(o.canonical)}">` +
    (o.image ? `<meta property="og:image" content="${esc(o.image)}">` : "") +
    `<meta name="twitter:card" content="summary_large_image">` +
    (o.jsonLd ?? "") +
    `</head><body>${o.body}</body></html>`
  );
}

// FR-P3 org-fleet: writable cache for ship images pulled from Fleetyards.
// Lazy-downloaded on first request, then served from disk (volume-backed in prod).
const SHIP_IMG_DIR = process.env.SHIP_IMAGE_DIR ?? "/app/data/ship-images";
const SHIP_IMG_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

async function cachedShipImage(id: string): Promise<{ path: string; type: string } | null> {
  for (const ext of ["jpg", "png", "webp"]) {
    const p = join(SHIP_IMG_DIR, `${id}.${ext}`);
    try {
      await stat(p);
      return { path: p, type: SHIP_IMG_TYPES[ext] };
    } catch {
      /* not this ext */
    }
  }
  return null;
}

export async function webRoutes(app: FastifyInstance) {
  app.get<{ Params: { file: string } }>("/assets/mission-images/:file", async (req, reply) => {
    const file = req.params.file;
    if (!/^[a-z0-9-]+\.png$/.test(file)) {
      return reply.code(404).send("Not found");
    }
    const fullPath = join(PUBLIC_DIR, "mission-images", file);
    try {
      await stat(fullPath);
      return reply.type("image/png").send(createReadStream(fullPath));
    } catch {
      return reply.code(404).send("Not found");
    }
  });

  // FR-P3: ship image for the Org-Flotte. Serves a locally-cached copy; on a
  // cache miss it downloads the Fleetyards store image for the ship (matched by
  // normalized name), writes it to disk, then streams it. Public (no op data).
  app.get<{ Params: { id: string } }>("/assets/ship-images/:id", async (req, reply) => {
    const id = req.params.id;
    if (!/^[a-z0-9]{20,40}$/.test(id)) return reply.code(404).send("Not found");

    let hit = await cachedShipImage(id);
    if (!hit) {
      const ship = await prisma.ship.findUnique({ where: { id }, select: { name: true } });
      if (!ship) return reply.code(404).send("Not found");
      const fy = await prisma.fleetyardsShip.findFirst({
        where: { nameKey: normShipName(ship.name), storeImageUrl: { not: null } },
        select: { storeImageUrl: true },
      });
      const url = fy?.storeImageUrl;
      if (!url) return reply.code(404).send("Not found");
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return reply.code(404).send("Not found");
        const ct = res.headers.get("content-type") ?? "";
        const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength === 0 || buf.byteLength > 8_000_000) return reply.code(404).send("Not found");
        await mkdir(SHIP_IMG_DIR, { recursive: true });
        const p = join(SHIP_IMG_DIR, `${id}.${ext}`);
        await writeFile(p, buf);
        hit = { path: p, type: SHIP_IMG_TYPES[ext] };
      } catch {
        return reply.code(502).send("Upstream image fetch failed");
      }
    }
    reply.header("cache-control", "public, max-age=86400");
    return reply.type(hit.type).send(createReadStream(hit.path));
  });

  // ── Link unfurl (OpenGraph) — crawler-only meta document. ──────────────
  // Deliberate exception to the "backend = API-only" rule: link-preview bots
  // (Discord/Twitter/Slack…) don't run JS, so the SPA can't provide per-op OG.
  // nginx routes ONLY bot user-agents here; humans get the SPA. No interactive
  // UI — just <meta> tags + an immediate redirect to the app for any human that
  // lands here. Private ops emit a generic card (no detail leak).
  app.get<{ Params: { id: string } }>("/ops/:id", async (req, reply) => {
    const env = getEnv();
    const base = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH ?? ""}`;
    const appUrl = `${base}/ops/${encodeURIComponent(req.params.id)}`;
    const defaultImg = `${base}/assets/operation-hero.png`;

    const op = /^[a-z0-9]{20,32}$/i.test(req.params.id) ? await getOperation(req.params.id) : null;
    let title = "RDOC Fleetplanner";
    let description = "Star-Citizen-Operationen planen.";
    let image = defaultImg;
    let jsonLd = "";
    let noindex = true; // nothing indexes unless it's an upcoming public op
    let body = `<a href="${esc(appUrl)}">${esc(title)}</a>`;
    if (op) {
      const o = op as { title: string; visibility: string; description: string | null; scheduledAt: Date; meetingSystem: string; meetingLocation: string; cover?: { url: string } | null };
      if (o.visibility === "public") {
        const when = o.scheduledAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
        const where = [o.meetingSystem, o.meetingLocation].filter(Boolean).join(" · ");
        title = o.title;
        description = `🕒 ${when}${where ? ` · 📍 ${where}` : ""}`;
        image = o.cover?.url || defaultImg;
        // Index only UPCOMING public ops — past ops go stale, keep them out.
        noindex = o.scheduledAt.getTime() < Date.now();
        const plain = o.description?.trim()
          ? o.description.replace(/\s+/g, " ").trim().slice(0, 280)
          : `Star-Citizen-Operation${where ? ` — ${where}` : ""}. Crew-Anmeldung im RDOC Fleetplanner.`;
        body =
          `<h1>${esc(o.title)}</h1><p>${esc(description)}</p>` +
          (o.description ? `<p>${esc(plain)}</p>` : "") +
          `<p><a href="${esc(appUrl)}">Operation im RDOC Fleetplanner öffnen</a></p>`;
        if (!noindex) {
          jsonLd = jsonLdScript({
            "@context": "https://schema.org",
            "@type": "Event",
            name: o.title,
            startDate: o.scheduledAt.toISOString(),
            eventStatus: "https://schema.org/EventScheduled",
            eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
            location: { "@type": "VirtualLocation", url: appUrl },
            description: plain,
            image: [image],
            url: appUrl,
            organizer: { "@type": "Organization", name: "RDOC Fleetplanner", url: base },
          });
        }
      } else {
        title = "Private Operation — RDOC Fleetplanner";
        description = "Anmeldung erforderlich.";
        body = `<a href="${esc(appUrl)}">${esc(title)}</a>`;
      }
    }
    const html = seoDoc({ title, description, canonical: appUrl, image, jsonLd, noindex, body });
    return reply.header("Cache-Control", "public, max-age=300").type("text/html; charset=utf-8").send(html);
  });

  // ── Link unfurl (OpenGraph) for polls — crawler-only meta document. ────
  // Same exception/contract as /ops/:id above: nginx routes only bot UAs here.
  // Public polls emit a real card; private/partners stay generic (no leak).
  app.get<{ Params: { id: string } }>("/polls/:id", async (req, reply) => {
    const env = getEnv();
    const base = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH ?? ""}`;
    const appUrl = `${base}/polls/${encodeURIComponent(req.params.id)}`;
    const image = `${base}/assets/operation-hero.png`;

    const poll = /^[a-z0-9]{20,32}$/i.test(req.params.id)
      ? ((await prisma.poll.findUnique({
          where: { id: req.params.id },
          select: {
            title: true,
            visibility: true,
            status: true,
            description: true,
            closesAt: true,
            _count: { select: { options: true } },
          },
        })) as unknown as
          | { title: string; visibility: string; status: string; description: string | null; closesAt: Date | null; _count: { options: number } }
          | null)
      : null;

    let title = "RDOC Fleetplanner";
    let description = "Umfragen für Star-Citizen-Orgs.";
    let noindex = true;
    if (poll) {
      if (poll.visibility === "public" && poll.status !== "draft") {
        const closes = poll.closesAt ? ` · offen bis ${poll.closesAt.toISOString().replace("T", " ").slice(0, 16)} UTC` : "";
        title = poll.title;
        description =
          (poll.description?.trim().slice(0, 160)) ||
          `🗳 Umfrage · ${poll._count.options} Optionen${poll.status === "closed" ? " · geschlossen" : closes}`;
        noindex = false;
      } else {
        title = "Umfrage — RDOC Fleetplanner";
        description = "Anmeldung erforderlich.";
      }
    }
    const html = seoDoc({
      title,
      description,
      canonical: appUrl,
      image,
      noindex,
      body: `<h1>${esc(title)}</h1><p>${esc(description)}</p><p><a href="${esc(appUrl)}">Umfrage im RDOC Fleetplanner öffnen</a></p>`,
    });
    return reply.header("Cache-Control", "public, max-age=300").type("text/html; charset=utf-8").send(html);
  });

  // ── SEO: indexable crawler HTML for the public marketing/content routes. ──
  // Same API-only exception as the unfurl docs, but these are INDEXABLE (no
  // meta-refresh): real text + canonical so Googlebot indexes each public URL
  // without the SPA's JS. nginx routes only crawler user-agents here.

  // Landing — keyword intro + internal links to upcoming public ops (crawl
  // discovery) + site-level structured data.
  app.get("/", async (_req, reply) => {
    const env = getEnv();
    const base = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH ?? ""}`;
    const canonical = `${base}/`;
    const ops = await prisma.operation
      .findMany({
        where: { visibility: "public", scheduledAt: { gte: new Date() } },
        orderBy: { scheduledAt: "asc" },
        take: 25,
        select: { id: true, title: true, scheduledAt: true, meetingSystem: true, meetingLocation: true },
      })
      .catch(() => [] as Array<{ id: string; title: string; scheduledAt: Date; meetingSystem: string; meetingLocation: string }>);
    const items = ops
      .map((o) => {
        const when = o.scheduledAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
        const where = [o.meetingSystem, o.meetingLocation].filter(Boolean).join(" · ");
        return `<li><a href="${base}/ops/${o.id}">${esc(o.title)}</a> — ${esc(when)}${where ? ` · ${esc(where)}` : ""}</li>`;
      })
      .join("");
    const description =
      "RDOC Fleetplanner: Events anlegen, Flotten-Slots vergeben, Crew anmelden und Voice koordinieren — die Operationsplanung für Star-Citizen-Organisationen.";
    const body =
      `<h1>RDOC Fleetplanner — Operationsplanung für Star-Citizen-Flotten</h1>` +
      `<p>${esc(description)}</p>` +
      `<p>Der RDOC Fleetplanner ist das Org-Tool für Star-Citizen-Operationen: Plane Flotten-Einsätze mit ` +
      `Datum und Treffpunkt, vergib Schiffs- und Sitzplätze nach Rolle, lass deine Crew sich selbst anmelden ` +
      `und koordiniere alle per Voice. Jede Operation erscheint automatisch als Discord-Event — kein zweites ` +
      `Tool, keine Tabelle.</p>` +
      `<p>Egal ob Mining-Run, Combat-Op oder Frachtkonvoi — vom Event mit Anmeldung über das Flotten-Management ` +
      `bis zur fertigen Teilnehmerliste läuft alles an einem Ort. Befreundete Orgs teilen Einsätze über ` +
      `Partner-Server.</p>` +
      `<h2>Star-Citizen-Operationen planen</h2><ul>` +
      `<li><a href="${base}/handbuch/was-ist-das">Was ist der RDOC Fleetplanner?</a></li>` +
      `<li><a href="${base}/handbuch/technobabble">Was ist das, in Technobabble (technischer Überblick)</a></li>` +
      `<li><a href="${base}/handbuch/architektur">Softwarearchitektur: Bausteine, Datenmodell, Abläufe</a></li>` +
      `<li><a href="${base}/handbuch/anleitung">Anleitung</a></li></ul>` +
      (items ? `<h2>Kommende öffentliche Operationen</h2><ul>${items}</ul>` : "");
    const jsonLd = jsonLdScript({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebApplication",
          name: "RDOC Fleetplanner",
          url: canonical,
          applicationCategory: "GameApplication",
          operatingSystem: "Web",
          inLanguage: "de-DE",
          description,
          offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
          publisher: { "@type": "Organization", name: "Raumdock (RDOC)", url: "https://raumdock.org" },
        },
        { "@type": "Organization", name: "Raumdock (RDOC)", url: "https://raumdock.org" },
      ],
    });
    return reply
      .header("Cache-Control", "public, max-age=300")
      .type("text/html; charset=utf-8")
      .send(
        seoDoc({
          title: "RDOC Fleetplanner — Operationsplanung für Star-Citizen-Flotten",
          description,
          canonical,
          image: `${base}/assets/operation-hero.png`,
          jsonLd,
          body,
        }),
      );
  });

  // Handbuch + Rechtliches: render the real first-party doc content (same source
  // the SPA's DocPage uses) so crawlers get full indexable text per section.
  const HANDBUCH_SLUG: Record<string, string> = {
    "was-ist-das": "whatis",
    technobabble: "whatis-tech",
    architektur: "architecture",
    anleitung: "how-to",
    changelog: "changelog",
    "sc-tools": "sc-tools",
    unsigniert: "why-unsigned",
  };
  const HANDBUCH_DESC: Record<string, string> = {
    "was-ist-das": "Was ist der RDOC Fleetplanner? Operationsplanung für Star-Citizen-Organisationen — Events, Flotten-Slots, Crew und Voice.",
    technobabble: "RDOC Fleetplanner unter der Haube: React-SPA, Fastify, Prisma, PostgreSQL, Discord-OAuth, P2P-WebRTC-Voice — der technische Überblick.",
    architektur: "Softwarearchitektur des RDOC Fleetplanner: Bausteine, Schichten, Datenmodell und die Abläufe hinter Operation, Discord-Event und Partnerverteilung.",
    anleitung: "Anleitung: Star-Citizen-Operationen planen, Flotten-Slots vergeben und Crew anmelden im RDOC Fleetplanner.",
    changelog: "Changelog des RDOC Fleetplanner — neue Funktionen und Änderungen.",
    "sc-tools": "Star-Citizen-Tools rund um Flotten- und Operationsplanung im RDOC Fleetplanner.",
    unsigniert: "Warum die RDOC Squad Link Companion-Binary unsigniert ausgeliefert wird.",
  };
  const RECHT_SLUG: Record<string, string> = { lizenz: "license", impressum: "impressum", datenschutz: "datenschutz" };

  async function renderDocPage(
    reply: FastifyReply,
    opts: { hub: "handbuch" | "rechtliches"; section: string; slug: string | undefined; description: string },
  ) {
    const env = getEnv();
    const base = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH ?? ""}`;
    const canonical = `${base}/${opts.hub}/${opts.section}`;
    const doc = opts.slug ? await getDocContent(opts.slug, "de") : null;
    const title = doc?.title ?? (opts.hub === "handbuch" ? "Handbuch" : "Rechtliches");
    const body = doc
      ? doc.html
      : `<h1>${esc(title)}</h1><p><a href="${esc(canonical)}">Im RDOC Fleetplanner öffnen</a></p>`;
    return reply
      .header("Cache-Control", "public, max-age=600")
      .type("text/html; charset=utf-8")
      .send(seoDoc({ title, description: opts.description, canonical, body, noindex: !doc }));
  }

  app.get<{ Params: { section?: string } }>("/handbuch/:section", (req, reply) => {
    const section = req.params.section || "was-ist-das";
    return renderDocPage(reply, { hub: "handbuch", section, slug: HANDBUCH_SLUG[section], description: HANDBUCH_DESC[section] ?? "RDOC Fleetplanner — Handbuch." });
  });
  app.get("/handbuch", (_req, reply) =>
    renderDocPage(reply, { hub: "handbuch", section: "was-ist-das", slug: HANDBUCH_SLUG["was-ist-das"], description: HANDBUCH_DESC["was-ist-das"] }),
  );
  app.get<{ Params: { section?: string } }>("/rechtliches/:section", (req, reply) => {
    const section = req.params.section || "lizenz";
    return renderDocPage(reply, { hub: "rechtliches", section, slug: RECHT_SLUG[section], description: "Rechtliches zum RDOC Fleetplanner — Lizenz, Impressum und Datenschutz." });
  });
  app.get("/rechtliches", (_req, reply) =>
    renderDocPage(reply, { hub: "rechtliches", section: "lizenz", slug: RECHT_SLUG["lizenz"], description: "Rechtliches zum RDOC Fleetplanner — Lizenz, Impressum und Datenschutz." }),
  );

  // ── Calendar download (.ics) — add the op to your calendar after signing up.
  app.get<{ Params: { id: string } }>("/ops/:id/calendar.ics", async (req, reply) => {
    const ctx = await optionalAuth(req);
    const op = await getOperation(req.params.id);
    if (!op) return reply.code(404).send("Operation not found");
    const opVisibility = (op as Record<string, unknown>).visibility as string | undefined;
    // Same access gate as the join page: public is open; otherwise the viewer
    // must be logged in and have a role in the op's guild.
    if (opVisibility !== "public") {
      if (!ctx) return reply.code(401).send("Login required");
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
      if (!role) return reply.code(404).send("Operation not found");
    }
    const publicUrl = `${getEnv().WEB_PUBLIC_URL}${getEnv().PUBLIC_BASE_PATH ?? ""}`;
    const ics = buildOpIcs(op, publicUrl);
    return reply
      .header("Content-Type", "text/calendar; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="op-${op.id}.ics"`)
      .header("Cache-Control", "no-store")
      .send(ics);
  });

  // ── Mission participant export (CSV) ──────────────────────────────────
  // Any op member (effectiveOpRole != null) may download the roster of who
  // took part. Available regardless of status, but the UI only links it once
  // the op is completed.
  app.get<{ Params: { id: string } }>("/ops/:id/participants.csv", async (req, reply) => {
    const ctx = await optionalAuth(req);
    if (!ctx) return reply.code(404).send("Not found");
    const op = await prisma.operation.findUnique({
      where: { id: req.params.id },
      select: { id: true, title: true },
    });
    if (!op) return reply.code(404).send("Not found");
    const role = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
    if (!role) return reply.code(404).send("Not found");

    const participants = await getMissionParticipants(op.id);
    const csv = participantsToCsv(participants);
    const slug = op.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "mission";
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${slug}-participants.csv"`);
    reply.header("Cache-Control", "no-store");
    return reply.send(csv);
  });

}
