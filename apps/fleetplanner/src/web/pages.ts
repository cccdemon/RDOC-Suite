import { html, safe, rawHtml, renderMarkdown, type SafeHtml, type LayoutOptions } from "./render.js";
import type { User, Operation, Ship, Location } from "@prisma/client";
import type { DiscordInstallDiagnostics, BotDiagnostic } from "../services/discordDiagnostics.js";
import {
  fmtDateTz,
  fmtDateLocalTz,
  isValidTimezone,
  TIMEZONE_OPTIONS,
  DEFAULT_TIMEZONE,
} from "../lib/timezone.js";
import { discordSiteBase, getEnv } from "../config/env.js";
import { t, LOCALES, LOCALE_NAMES } from "../i18n/index.js";
import { CHANGELOG } from "../lib/changelog.js";
import { ROADMAP, type RoadmapStatus } from "../lib/roadmap.js";
import { matchesCategory, suggestSlot, isCqbCategory, shipClass } from "../services/composition.js";
import { SHIP_TYPES, shipTypeLabel, CQB_TEAM_DEFAULT, CQB_TEAM_MAX } from "../services/needs.js";
import { normShipName } from "../services/fleetyards.js";
import { slotKindTagKey } from "../services/slotKind.js";
import type { SharedHangar } from "../services/hangarShare.js";
import type { MissionParticipant } from "../services/participants.js";
import type { MultiPositionAssignment } from "../services/primaryUnits.js";

// ── Types returned by getOperation() includes ───────────────────────
type OpFull = Awaited<ReturnType<typeof import("../services/operations.js").getOperation>>;
type UnitFull = NonNullable<OpFull>["units"][number];

// ── Shared helpers ───────────────────────────────────────────────────

const REQUIREMENT_CATEGORIES = [
  "fps",
  "capital",
  "subcapital",
  "fighter",
  "support",
  "ground",
  "transport",
  "mining",
  "salvage",
  "exploration",
  "any",
] as const;

// Fleet Requirements starter templates for the creation wizard (FR-P1 Phase 3). Hosts
// load one and then tweak rows; nothing is locked. Categories must be valid
// REQUIREMENT_CATEGORIES.
const COMPOSITION_TEMPLATES = [
  {
    name: "Tactical Strike Groups",
    requirements: [
      { category: "fps", label: "Fireteam Alpha", count: 1 },
      { category: "fps", label: "Fireteam Bravo", count: 1 },
      { category: "fighter", label: "Jäger", count: 6 },
      { category: "support", label: "Support", count: 1 },
    ],
  },
  {
    name: "Hator",
    requirements: [
      { category: "capital", label: "Großkampfschiff", count: 1 },
      { category: "subcapital", label: "Subcapital", count: 2 },
      { category: "fighter", label: "Jäger-Eskorte", count: 4 },
    ],
  },
  {
    name: "Rockbreaker",
    requirements: [
      { category: "mining", label: "Mining-Schiff", count: 3 },
      { category: "transport", label: "Transport", count: 1 },
      { category: "fighter", label: "Eskorte", count: 2 },
    ],
  },
  {
    name: "Stormbreaker",
    requirements: [
      { category: "subcapital", label: "Großkampfschiff", count: 2 },
      { category: "fighter", label: "Jäger", count: 6 },
      { category: "fps", label: "Boarding-Team", count: 2 },
    ],
  },
] as const;

// Inline "?" help bubble — plain-language ("for dummies") explanation of an
// operator control. CSS-only popover (see .help in render.ts).
function helpIcon(text: string): SafeHtml {
  return html`<span class="help" tabindex="0" role="note" aria-label="${text}"
    >?<span class="help-pop">${text}</span></span
  >`;
}

function categoryLabel(category: string): string {
  return REQUIREMENT_CATEGORIES.includes(category as (typeof REQUIREMENT_CATEGORIES)[number])
    ? t(`cat.${category}`)
    : category;
}

function fmtDate(d: Date, tz = DEFAULT_TIMEZONE): string {
  return fmtDateTz(d, tz);
}

function fmtDateLocal(d: Date, tz = DEFAULT_TIMEZONE): string {
  return fmtDateLocalTz(d, tz);
}

function statusTag(status: string): SafeHtml {
  const map: Record<string, string> = {
    draft: "tag-dim",
    open: "tag-cyan",
    locked: "tag-gold",
    in_progress: "tag-green",
    completed: "tag",
    cancelled: "tag-red",
    pending: "tag-gold",
    accepted: "tag-green",
    rejected: "tag-red",
  };
  const cls = map[status] ?? "tag";
  const label = map[status] ? t(`status.${status}`) : status.replace("_", " ");
  return html`<span class="tag ${cls}">${label.toUpperCase()}</span>`;
}

function opTypeText(opType: string): string {
  return (OP_TYPES as readonly string[]).includes(opType) ? t(`optype.${opType}`) : opType;
}

function opTypeTag(opType: string): SafeHtml {
  return html`<span class="tag">${opTypeText(opType).toUpperCase()}</span>`;
}

const VISIBILITY_META: Record<string, { cls: string; icon: string }> = {
  private: { cls: "tag-dim", icon: "🔒" },
  partners: { cls: "tag-gold", icon: "🤝" },
  public: { cls: "tag-green", icon: "🌐" },
};

function roleLabel(role: string): string {
  return role.replace(/_/g, " ");
}

function discordBotInviteUrl(clientId: string, permissions: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "bot applications.commands",
    permissions,
  });
  return `${discordSiteBase()}/oauth2/authorize?${params.toString()}`;
}

const SYSTEMS = ["stanton", "nyx", "pyro"] as const;
const OP_TYPES = [
  "combat",
  "pve",
  "mining",
  "salvage",
  "training",
  "mixed",
  "exploration",
  "transport",
  "social",
] as const;
const MISSION_IMAGE_TYPES = new Set<string>(OP_TYPES);

function systemLabel(system: string): string {
  // Star system names are proper nouns — not translated, only cased.
  return system ? system[0].toUpperCase() + system.slice(1) : "Stanton";
}

function flashFromQuery(msg: string | undefined): LayoutOptions["flash"] {
  if (!msg) return null;
  const [kind, ...rest] = msg.split(":");
  const text = rest.join(":") || msg;
  if (kind === "ok" || kind === "warn" || kind === "error") return { kind, text };
  return { kind: "ok", text: msg };
}

function missionImageType(opType: string): string {
  const normalized = opType.toLowerCase();
  return MISSION_IMAGE_TYPES.has(normalized) ? normalized : "combat";
}

function missionImageUrl(bp: string, opType: string): string {
  return `${bp}/assets/mission-images/${missionImageType(opType)}.png`;
}

// ── Public info pages ────────────────────────────────────────────────

export function whatIsBody(bp: string, de: boolean): SafeHtml {
  const card = "card";

  const langToggle = html`<div style="margin-bottom:12px;display:flex;gap:10px;align-items:center">
    <a href="${bp}/${de ? "what-is" : "was-ist"}" class="btn btn-sm">${de ? "🇬🇧 English version" : "🇩🇪 Deutsche Version"}</a>
  </div>`;

  const deBody = html` <div class="page-header">
      <h1 class="page-title">WAS IST DER FLEETMANAGER?</h1>
      <p class="page-subtitle">Kurz erklärt — ohne Technik-Kauderwelsch.</p>
      <p style="margin-top:.4rem"><a href="${bp}/handbuch/technobabble" class="btn btn-sm">Lieber technisch? → Was ist das, in Technobabble</a></p>
    </div>

    <div class="section">
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <p style="margin:0">
          Der <strong>Fleetmanager</strong> ist ein Planungs-Werkzeug für Star-Citizen-Einsätze
          („Operations"). Stell dir vor, deine Org will mit 30 Leuten und 10 Schiffen losziehen —
          den ganzen Kram im Discord-Chat zu organisieren wird schnell Chaos. Der Fleetmanager
          macht daraus eine ordentliche Liste: <strong>Wer fliegt was, wer sitzt wo, wann geht's los.</strong>
        </p>
        <p style="margin-top:.6rem">
          Er hängt direkt an deinem Discord-Server. Was du hier planst, taucht als
          <strong>Discord-Event</strong> auf — niemand muss eine neue App lernen.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Die einfache Idee</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <p style="margin:0">Denk an einen <strong>Tischplan für eine Hochzeit</strong> — nur für Raumschiffe:</p>
        <table class="user-table" style="width:100%;margin-top:.75rem">
          <thead><tr><th>Im Fleetmanager</th><th>Ist wie…</th></tr></thead>
          <tbody>
            <tr><td><strong>Operation</strong></td><td>die Veranstaltung (z. B. „Angriff auf Daymar, Samstag 20 Uhr")</td></tr>
            <tr><td><strong>Schiff / Einheit</strong></td><td>ein Tisch</td></tr>
            <tr><td><strong>Sitzplatz</strong></td><td>ein Stuhl am Tisch (Pilot, Gunner, Sanitäter …)</td></tr>
            <tr><td><strong>Crew</strong></td><td>die Gäste, die sich einen Stuhl schnappen</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Wer macht was?</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <table class="user-table" style="width:100%">
          <thead><tr><th>Rolle</th><th>Aufgabe</th></tr></thead>
          <tbody>
            <tr><td><strong>Fleet&nbsp;Op</strong> <span class="text-dim">(Operator)</span></td><td>plant die Operation: Was, Wann, Wo. Der Veranstalter.</td></tr>
            <tr><td><strong>Crew</strong></td><td>jedes Mitglied. Schaut, welche Schiffe mitfliegen, und schnappt sich einen Platz.</td></tr>
            <tr><td><strong>Captain</strong> <span class="text-dim">(kein Rang)</span></td><td>wirst du automatisch, sobald du ein Schiff anmeldest — du verwaltest dann dessen Plätze. Gilt nur für dieses eine Schiff in dieser Operation.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-title">So läuft eine Operation ab</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <ol style="margin:0;padding-left:1.2rem;line-height:1.7">
          <li><strong>Der Fleet Op legt die Operation an</strong> — Titel, Zeit, Treffpunkt. Sie erscheint sofort als Discord-Event.</li>
          <li><strong>Captains bieten ihre Schiffe an</strong> — „Ich bringe meine Carrack mit, 4 Plätze".</li>
          <li><strong>Der Fleet Op nimmt Schiffe an</strong> — angenommene Schiffe bekommen ihre Sitzplätze.</li>
          <li><strong>Crew schnappt sich Plätze</strong> — jeder sieht, was noch frei ist, und klickt sich rein.</li>
          <li><strong>Es geht los</strong> — alle wissen, wo sie hingehören. Danach gibt's eine Teilnehmerliste.</li>
        </ol>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Nette Extras (optional)</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <ul style="margin:0;padding-left:1.2rem;line-height:1.7">
          <li><strong>Mission Cover</strong> — ein schickes Briefing-Poster für die Operation, automatisch aus den Daten erzeugt.</li>
          <li><strong>Wiederkehrende Einsätze</strong> — ein fester Termin (z. B. „jeden Samstag") wird automatisch immer wieder neu angelegt, jeder mit eigener Crew-Liste.</li>
          <li><strong>Deine Schiffe</strong> — trag im Profil ein, welche Schiffe dir gehören (auch als Sammel-Import aus dem CCU-Game). Dann musst du sie beim Anmelden nicht jedes Mal neu suchen.</li>
          <li><strong>Org-Flotte</strong> — eine Übersicht, wer in deiner Org welches Schiff besitzt (freiwillig). Praktisch, wenn man für einen Einsatz ein bestimmtes Schiff sucht oder sich eins ausleihen will.</li>
          <li><strong>Erinnerungen</strong> — Discord schickt rechtzeitig eine Nachricht, bevor es losgeht.</li>
          <li><strong>Partner-Server</strong> — befreundete Orgs können gemeinsame Einsätze sehen und mitmachen; ein Einsatz lässt sich auf einen Klick auch in die Discords der Partner posten.</li>
        </ul>
      </div>
    </div>

    <div class="section">
      <div class="${card}" style="padding:1.1rem;max-width:54rem;border-left:3px solid var(--cyan,#22d3ee)">
        <p style="margin:0"><strong>Wichtig:</strong> Der Fleetmanager ändert <em>nichts im Spiel</em>.
        Er ist die Organisation <em>drumherum</em> — Planung, Plätze, Absprache. Im Spiel fliegt
        natürlich weiter jeder selbst. 🚀</p>
      </div>
    </div>

    <div class="section">
      <a href="${bp}/how-to" class="btn btn-cyan">Weiter zur ausführlichen Anleitung →</a>
    </div>`;

  const enBody = html` <div class="page-header">
      <h1 class="page-title">WHAT IS THE FLEETMANAGER?</h1>
      <p class="page-subtitle">The short version — no tech jargon.</p>
    </div>

    <div class="section">
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <p style="margin:0">
          The <strong>Fleetmanager</strong> is a planning tool for Star Citizen operations. Picture
          your org heading out with 30 people and 10 ships — coordinating all that in a Discord chat
          turns into chaos fast. The Fleetmanager turns it into a tidy list:
          <strong>who flies what, who sits where, when it kicks off.</strong>
        </p>
        <p style="margin-top:.6rem">
          It plugs straight into your Discord server. Whatever you plan here shows up as a
          <strong>Discord event</strong> — nobody has to learn a new app.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">The simple idea</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <p style="margin:0">Think of a <strong>wedding seating plan</strong> — just for spaceships:</p>
        <table class="user-table" style="width:100%;margin-top:.75rem">
          <thead><tr><th>In the Fleetmanager</th><th>Is like…</th></tr></thead>
          <tbody>
            <tr><td><strong>Operation</strong></td><td>the event (e.g. "Daymar raid, Saturday 8pm")</td></tr>
            <tr><td><strong>Ship / unit</strong></td><td>a table</td></tr>
            <tr><td><strong>Seat</strong></td><td>a chair at the table (pilot, gunner, medic …)</td></tr>
            <tr><td><strong>Crew</strong></td><td>the guests who grab a chair</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Who does what?</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <table class="user-table" style="width:100%">
          <thead><tr><th>Role</th><th>Job</th></tr></thead>
          <tbody>
            <tr><td><strong>Fleet&nbsp;Op</strong> <span class="text-dim">(operator)</span></td><td>plans the operation: what, when, where. The host.</td></tr>
            <tr><td><strong>Crew</strong></td><td>every member. Sees which ships are flying and grabs a seat.</td></tr>
            <tr><td><strong>Captain</strong> <span class="text-dim">(not a rank)</span></td><td>you become one automatically the moment you register a ship — you then manage its seats. Only for that one ship in that one operation.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-title">How an operation runs</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <ol style="margin:0;padding-left:1.2rem;line-height:1.7">
          <li><strong>The Fleet Op creates the operation</strong> — title, time, rendezvous. It instantly appears as a Discord event.</li>
          <li><strong>Captains offer their ships</strong> — "I'll bring my Carrack, 4 seats".</li>
          <li><strong>The Fleet Op accepts ships</strong> — accepted ships open their seats.</li>
          <li><strong>Crew grab seats</strong> — everyone sees what's still free and clicks in.</li>
          <li><strong>It kicks off</strong> — everyone knows where they belong. Afterwards there's a participant list.</li>
        </ol>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Nice extras (optional)</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <ul style="margin:0;padding-left:1.2rem;line-height:1.7">
          <li><strong>Mission Cover</strong> — a slick briefing-poster image for the operation, generated automatically from its data.</li>
          <li><strong>Recurring operations</strong> — a fixed slot (e.g. "every Saturday") is re-created automatically, each with its own crew list.</li>
          <li><strong>Your ships</strong> — record which ships you own in your profile (or bulk-import from CCU-Game), so you don't have to search for them every time you sign up.</li>
          <li><strong>Org fleet</strong> — an overview of who in your org owns which ship (opt-in). Handy when you need a particular hull for an op or want to borrow one.</li>
          <li><strong>Reminders</strong> — Discord pings everyone in time before it starts.</li>
          <li><strong>Partner servers</strong> — friendly orgs can see and join shared operations; an op can also be cross-posted into the partners' Discords with one click.</li>
        </ul>
      </div>
    </div>

    <div class="section">
      <div class="${card}" style="padding:1.1rem;max-width:54rem;border-left:3px solid var(--cyan,#22d3ee)">
        <p style="margin:0"><strong>Important:</strong> the Fleetmanager changes <em>nothing in the game</em>.
        It's the organisation <em>around</em> it — planning, seats, coordination. In game everyone
        still flies for themselves. 🚀</p>
      </div>
    </div>

    <div class="section">
      <a href="${bp}/how-to" class="btn btn-cyan">On to the detailed guide →</a>
    </div>`;

  return html`${langToggle}${de ? deBody : enBody}`;
}

// Technical counterpart to whatIsBody — deliberately jargon-dense, for the
// tech-savvy reader (and it captures technical long-tail search terms). Keep in
// sync with the actual stack. Voice is a deep-link into Subraum (a separate
// app); the Fleetplanner itself carries no audio and has no relay bots.
export function whatIsTechBody(bp: string): SafeHtml {
  const card = "card";
  return html` <div class="page-header">
      <h1 class="page-title">WAS IST DAS — IN TECHNOBABBLE</h1>
      <p class="page-subtitle">Für alle, die's unter der Haube wollen.</p>
      <p style="margin-top:.4rem"><a href="${bp}/handbuch/was-ist-das" class="btn btn-sm">← Lieber einfach erklärt</a></p>
    </div>

    <div class="section">
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <p style="margin:0">
          Der <strong>RDOC Fleetplanner</strong> ist eine multi-tenant Operations-Orchestrierungs-Plattform
          für Star-Citizen-Organisationen. Frontend: <strong>React-SPA</strong> (Vite-Build) gegen eine
          JSON-<code>/api/v1</code>-Schicht. Backend: <strong>Fastify + Prisma</strong> auf
          <strong>PostgreSQL</strong>, zustandslos hinter einem Reverse-Proxy (Caddy).
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Identität &amp; Rollen</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <p style="margin:0">
          Login via <strong>Discord-OAuth2</strong>. Die globale Rolle trägt nur den Superadmin; alles
          andere ist <strong>per-Guild gescoped</strong> (<code>fleetoperator</code> / <code>captain</code> /
          <code>crew</code>). Discord-Server-Rollen werden auf Op-Rollen gemappt.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Datenmodell</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <p style="margin:0">
          Zentrales Aggregat ist die <strong>Operation</strong>: Schiffe → Einheiten → Sitzplätze
          (Pilot / Gunner / Engineer …), mit Self-Service-Seat-Claiming und Bedarfs-Matching.
          Schiffsklassen und Crew-Sollstärke kommen aus dem <strong>SC-Wiki</strong>.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Discord-Integration</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <p style="margin:0">
          Jede Op materialisiert ein natives <strong>Discord Scheduled Event</strong>; „Interested"-Klicks
          ziehen Schatten-Teilnehmer rein. Event-Distribution cross-postet Ops in
          <strong>Partner-Guilds</strong> (Allowlist + Approval-Inbox).
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Voice</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <p style="margin:0">
          Der Fleetplanner überträgt <strong>kein Audio</strong>. Er mintet ausschließlich einen
          signierten Deep-Link (<code>squadlink://connect</code>, HMAC-SHA256 über den Raumnamen) in
          den CommandNet-Raum einer laufenden Operation; gesprochen wird in
          <strong>Subraum</strong> (<a href="https://subraum.cc" target="_blank" rel="noopener">subraum.cc</a>),
          einer eigenständigen Anwendung. Der Operator wählt aus,
          welche zugewiesenen Teilnehmer den Link sehen. Ohne <code>SQUADLINK_ROOM_AUTH_SECRET</code>
          ist die Funktion in der Oberfläche nicht vorhanden. Kein Discord-Audio-Hook, kein Mithören.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Mission Cover</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <p style="margin:0">
          Ein <strong>Headless-Chromium-Microservice</strong> rendert das Briefing-Poster server-seitig
          aus den Op-Daten.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="${card}" style="padding:1.1rem;max-width:54rem;border-left:3px solid var(--cyan,#22d3ee)">
        <p style="margin:0">
          <strong>Stack-Kurzfassung:</strong> TypeScript · React/Vite · Fastify · Prisma · PostgreSQL ·
          Zod-Contracts · Docker-Compose · Caddy. Discord wird über die REST-API v10 angesprochen —
          ohne Client-Bibliothek und ohne Gateway-Verbindung. Quelloffen (PolyForm
          Noncommercial): <a href="https://github.com/cccdemon/RDOC-Suite" target="_blank" rel="noopener">github.com/cccdemon/RDOC-Suite</a>.
        </p>
        <p style="margin-top:.6rem"><strong>TL;DR:</strong> Discord-natives Event- und Flotten-Management
          für Star-Citizen-Ops — ohne im Spiel irgendetwas anzufassen. 🚀</p>
        <p style="margin-top:.6rem" class="text-dim text-sm">
          Ausführlich: <a href="${bp}/handbuch/architektur">Softwarearchitektur</a> —
          Schichten, Datenmodell und Ablaufpläne.
        </p>
      </div>
    </div>

    <div class="section">
      <a href="${bp}/handbuch/anleitung" class="btn btn-cyan">Weiter zur ausführlichen Anleitung →</a>
    </div>`;
}

export function scToolsBody(
  tools: Array<{ url: string; domain: string; name: string; desc: string; image: string | null }>,
): SafeHtml {
  return html`<div class="page-header">
      <h1 class="page-title">${t("sct.title")}</h1>
      <p class="page-subtitle">${t("sct.subtitle")}</p>
    </div>
    <style>
      .sct-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; }
      .sct-card { display: flex; flex-direction: column; border: 1px solid var(--border, #26303d); background: var(--bg2, #0d1117); text-decoration: none; color: inherit; overflow: hidden; transition: border-color .15s; }
      .sct-card:hover { border-color: var(--cyan, #35d0e0); }
      .sct-img { aspect-ratio: 1200/630; background: #05080f center/cover no-repeat; border-bottom: 1px solid var(--border, #26303d); }
      .sct-noimg { aspect-ratio: 1200/630; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #0b1320, #111c2b); color: var(--cyan, #35d0e0); font-family: var(--font-mono); font-weight: 700; letter-spacing: 1px; border-bottom: 1px solid var(--border, #26303d); }
      .sct-body { padding: .7rem .85rem; display: flex; flex-direction: column; gap: .3rem; }
      .sct-name { font-weight: 700; }
      .sct-desc { font-size: .85rem; color: var(--text, #cdd9e1); line-height: 1.4; }
      .sct-domain { font-size: .72rem; color: var(--dim, #7a8a96); font-family: var(--font-mono); margin-top: auto; }
    </style>
    <div class="section">
      <div class="sct-grid">
        ${tools.map(
          (t) => html`<a class="sct-card" href="${t.url}" target="_blank" rel="noopener noreferrer">
            ${t.image
              ? html`<div class="sct-img" style="background-image:url('${t.image}')"></div>`
              : html`<div class="sct-noimg">${t.domain}</div>`}
            <div class="sct-body">
              <span class="sct-name">${t.name}</span>
              <span class="sct-desc">${t.desc}</span>
              <span class="sct-domain">${t.domain} ↗</span>
            </div>
          </a>`,
        )}
      </div>
    </div>
    <div class="section">
      <p class="text-dim text-sm" style="max-width:54rem">
        ${t("sct.footer")}
      </p>
    </div>`;
}

export function howToBody(bp: string, superadminContact?: string): SafeHtml {
  const opts = { superadminContact };
  return html` <div class="page-header">
      <h1 class="page-title">HOW TO USE RDOC FLEETPLANNER</h1>
    </div>

    <div class="section">
      <div class="section-title">What is this?</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p>
          RDOC Fleetplanner organises Star Citizen fleet operations across multiple Discord servers.
          Admirals plan operations, captains register their ships, crew members claim seats — all
          coordinated through Discord and posted as Discord scheduled events.
        </p>
        <p style="margin-top:.5rem">
          The core — planning operations and posting them as Discord scheduled events — needs nothing
          but this web app and the Fleetplanner Discord bot. Briefing covers and metrics are
          <strong>optional add-ons</strong> (see below).
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Optional features</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p style="margin-top:0">
          These extend the Fleetplanner but are not required to plan and run operations.
        </p>
        <table class="user-table" style="width:100%;margin-top:.75rem">
          <thead>
            <tr><th>Add-on</th><th>What it adds</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="tag tag-cyan">Org fleet</span></td>
              <td>
                An opt-in roster of who in a server owns which ship, so members can find or borrow a
                hull for an operation. Each member chooses whether their ships appear
                (Account &rarr; Settings).
              </td>
            </tr>
            <tr>
              <td><span class="tag tag-gold">Mission Cover</span></td>
              <td>
                A generator for cinematic briefing-cover images per operation (banner, share preview,
                Discord-event image). If the cover service isn't configured, the op simply uses no
                custom cover.
              </td>
            </tr>
            <tr>
              <td><span class="tag tag-cyan">Subraum voice</span></td>
              <td>
                A join link into the operation's command voice room for the people the operator picks.
                The audio itself runs in Subraum (subraum.cc), a separate app — the Fleetplanner only mints
                the link. Not configured on this instance means the panel is simply absent.
              </td>
            </tr>
            <tr>
              <td><span class="tag tag-dim">Monitoring</span></td>
              <td>Operational metrics dashboard for operators of the instance. Not player-facing.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Roles</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p style="margin-top:0">
          There are only <strong>three</strong> roles, shown as a coloured tag next to your name.
        </p>
        <table class="user-table" style="width:100%;margin-top:.75rem">
          <thead>
            <tr>
              <th>Tag</th>
              <th>Role</th>
              <th>What they can do</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="tag tag-role">ADMIRAL</span></td>
              <td>Superadmin</td>
              <td>Instance owner. Manage all Discord servers, ban/unban servers, trigger ship sync. One per instance.</td>
            </tr>
            <tr>
              <td><span class="tag tag-role">FLEET OP</span></td>
              <td>Fleetoperator</td>
              <td>
                A server's operator. Add the bot to a Discord, create &amp; manage operations,
                accept/reject units, assign mission leaders, manage composition, post Discord
                scheduled events. (Auto-assigned from the server's mapped Discord role; the
                installing user becomes Fleet Op.)
              </td>
            </tr>
            <tr>
              <td><span class="tag tag-role">CREW</span></td>
              <td>Crew</td>
              <td>Default role for every member. Claim open seats, request assignments, and offer ships/CQB teams.</td>
            </tr>
          </tbody>
        </table>
        <p class="text-dim text-sm" style="margin-top:.75rem;margin-bottom:0">
          <strong>"Captain" is not a fleet role.</strong> Anyone — Crew or Fleet Op — becomes the
          <em>captain</em> of a unit simply by registering a ship or CQB team in an operation; they
          then manage that unit's seats. It is per-unit and per-operation, not a rank.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Getting started — for Admirals</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <ol style="margin:0;padding-left:1.25rem;display:flex;flex-direction:column;gap:.6rem">
          <li><strong>Login</strong> via Discord (or GitHub / Google if configured).</li>
          <li>
            Click <strong>Servers → + Add Fleetplanner bot to a Discord</strong> and authorise the
            bot on your server. You become that server's Admiral.
          </li>
          <li>
            Go to <strong>Servers → Settings</strong> to set the server timezone, an optional
            Discord invite link (shown to guests on the signup page), and Discord-role mapping
            (auto-assigns Admiral permissions on login).
          </li>
          <li>
            Click <strong>+ New Operation</strong> to launch the <strong>guided wizard</strong>:
            basics (title, date in your server's timezone, type) → briefing (Markdown) → Discord →
            <strong>Fleet Requirements</strong> (with templates) → review. Optionally make it
            <strong>recurring</strong> (weekly / every 2 weeks / monthly / yearly) and/or jump to the
            Mission Cover after creating.
          </li>
          <li>
            You land in the <strong>management workspace</strong> (status flow Draft → Open → Live →
            Done, with a "next step" button and attention tabs).
          </li>
          <li>
            Set status to <strong>Open</strong> — a Discord scheduled event is posted automatically
            (with the cover image if you made one).
          </li>
          <li>
            Accept incoming ships / CQB teams (and any carried ground vehicles). Accepted units open
            their seats for crew; assign people to composition slots as needed.
          </li>
          <li>
            When done, set status to <strong>Completed</strong> (export participants as CSV) or
            <strong>Cancelled</strong> (event removed from Discord).
          </li>
        </ol>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Getting started — for Crew</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <ol style="margin:0;padding-left:1.25rem;display:flex;flex-direction:column;gap:.6rem">
          <li>
            <strong>Login</strong> and make sure your Discord account is linked (required to see
            your server's operations). Guests of public ops can use the <strong>Discord</strong>
            invite link on the signup page to join the server.
          </li>
          <li>
            Open an operation — the <strong>signup page</strong> has an "I want to join" assistant
            with three choices: <strong>let the operator place me</strong>, <strong>take an open
            seat</strong>, or <strong>offer a ship / CQB team</strong>.
          </li>
          <li>
            If you offer a ship: configure its seats (rename, enable/disable) while it's still
            pending, withdraw it if needed, and (on a ship with a big-enough cargo bay) add a
            <strong>ground vehicle</strong> as a crewable sub-unit. Wait for the operator to accept.
          </li>
          <li>
            See the <strong>accepted units</strong> right on the page and claim/release seats inline —
            no separate edit mode.
          </li>
          <li>
            Fill <strong>Profile → Owned Ships</strong> for quick selection — type by hand or
            <strong>import a CCU-Game JSON</strong> export; unmatched names can be assigned manually.
          </li>
        </ol>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Multiple Discord servers</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p>
          One Fleetplanner instance supports many Discord servers. Each server has its own
          operations and members. Switch between servers via <strong>Servers</strong> in the nav.
          You only see operations from servers you are a Discord member of.
        </p>
        <p style="margin-top:.5rem">
          Admiral permissions can be auto-assigned from a Discord role in the server settings.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Operation visibility</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p>
          Every operation has a visibility setting, independent of its status. Set it when creating
          the op, or change it any time from the op detail page (Admiral or an Event Leader of that
          op).
        </p>
        <table class="user-table" style="width:100%;margin-top:.75rem">
          <thead>
            <tr><th>Visibility</th><th>Who can see &amp; join</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="tag tag-dim">🔒 Private</span></td>
              <td>Only members of this Discord server. Default for new ops.</td>
            </tr>
            <tr>
              <td><span class="tag tag-gold">🤝 Partners</span></td>
              <td>Your server + any linked partner servers (see Partnerships below).</td>
            </tr>
            <tr>
              <td><span class="tag tag-green">🌐 Public</span></td>
              <td>
                Any logged-in user, and a read-only preview even without login. Anyone authenticated
                can register a unit and claim seats.
              </td>
            </tr>
          </tbody>
        </table>
        <p style="margin-top:.5rem">
          Cross-server participants are always treated as <strong>Crew</strong> — they can join but
          never manage the op.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Server partnerships</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p>
          Link two Discord servers so both sides can see each other's
          <span class="tag tag-gold">🤝 Partners</span> operations. Partnerships are mutual and use a
          single-use token.
        </p>
        <ol style="margin:.5rem 0 0;padding-left:1.25rem;display:flex;flex-direction:column;gap:.6rem">
          <li>
            Server A: <strong>Servers → Settings → Partnerships</strong>, enter a label and
            <strong>Create invite token</strong>. The link is shown once — copy it.
          </li>
          <li>Send the token/link to the Admiral of Server B (out of band).</li>
          <li>
            Server B: open <strong>Partnerships</strong>, paste the token under
            <strong>Accept an invite</strong>. Both servers are now partners.
          </li>
          <li>
            Either side can <strong>Revoke</strong> at any time — that is permanent; mint a fresh
            token to re-link.
          </li>
        </ol>
        <p style="margin-top:.5rem">
          Bonus: an operation can be cross-posted straight into the partners' Discords (event
          distribution) — the target server's Fleet Ops approve it first.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Removing or banning a server</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p>
          <strong>Remove a server</strong> (server owner or instance SuperAdmin): in
          <strong>Servers → Settings</strong>, the Danger zone hides the server from Fleetplanner
          (<em>active = off</em>). Operations, members and partnerships are kept — adding the bot
          again reactivates everything. Nothing is deleted.
        </p>
        <p style="margin-top:.5rem">
          <strong>Ban a server</strong> (SuperAdmin only): in <strong>Admin → Discord Servers</strong>,
          Ban forces a server inactive and blocks it from being (re)added until Unban. Use it to keep
          an abusive server out.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Ship catalog</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p>
          Ships are pulled from the
          <a href="https://api.star-citizen.wiki" target="_blank" rel="noopener"
            >Star Citizen Wiki API</a
          >
          and cached locally. The catalog refreshes weekly automatically. Admins can trigger a
          manual sync in the Admin panel.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Contact &amp; support</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p>
          Found a bug or have a feature request? Use the
          <a href="${bp}/feedback">Feedback</a> tab.
        </p>
        <p style="margin-top:.5rem">
          To reach the instance SuperAdmin directly:
          ${
            opts.superadminContact
              ? html`<strong class="text-mono">${opts.superadminContact}</strong>`
              : safe("ask in your community's Discord.")
          }
        </p>
      </div>
    </div>`;
}

export function changelogBody(): SafeHtml {
  const entries = CHANGELOG.map(
    (e) => html`<div class="card" style="padding:1rem 1.25rem;max-width:52rem;margin-bottom:1rem">
      <div class="card-header" style="margin-bottom:.75rem;padding-bottom:.6rem">
        <span class="card-title" style="flex:1">${e.title}</span>
        <span class="tag tag-cyan">${e.date}</span>
      </div>
      <ul style="margin:0;padding-left:1.25rem;display:flex;flex-direction:column;gap:.45rem">
        ${e.changes.map((c) => html`<li>${c}</li>`)}
      </ul>
    </div>`,
  );

  return html`<div class="page-header">
      <h1 class="page-title">${t("nav.changelog").toUpperCase()}</h1>
      <div class="page-subtitle">${t("misc.changelogSub")}</div>
    </div>
    <div class="section">${entries}</div>`;
}

export function whyUnsignedBody(): SafeHtml {
  const option = (n: string, title: string, body: SafeHtml) => html`
    <div class="card" style="padding:1.1rem;margin-bottom:.85rem">
      <h2 style="margin:0 0 .5rem;font-size:1rem;color:var(--cyan)">
        <span class="text-dim">${n}.</span> ${title}
      </h2>
      <div class="text-sm" style="color:var(--text);line-height:1.55">${body}</div>
    </div>
  `;

  return html`
    <div class="page-header"><h1 class="page-title">${t("wu.title")}</h1></div>
    <div class="section" style="max-width:52rem">
      <p class="text-sm" style="color:var(--text);line-height:1.6;margin:0 0 1.25rem">
        ${safe(t("wu.intro"))}
      </p>

      ${option("1", t("wu.o1t"), safe(t("wu.o1b")))}
      ${option("2", t("wu.o2t"), safe(t("wu.o2b")))}
      ${option("3", t("wu.o3t"), safe(t("wu.o3b")))}
      ${option("4", t("wu.o4t"), safe(t("wu.o4b")))}
      ${option("5", t("wu.o5t"), safe(t("wu.o5b")))}
      ${option("6", t("wu.o6t"), safe(t("wu.o6b")))}

      <div class="card" style="padding:1.1rem;margin-top:.4rem;border-color:var(--gold-38)">
        <h2 style="margin:0 0 .5rem;font-size:1rem;color:var(--gold)">${t("wu.standTitle")}</h2>
        <p class="text-sm" style="color:var(--text);line-height:1.55;margin:0">
          ${safe(t("wu.standBody"))}
        </p>
      </div>
    </div>
  `;
}

// ── Privacy policy (English — mirrors raumdock.org + app data) ──────
export function datenschutzBody(bp: string): SafeHtml {
  return html`<div class="page-header">
      <h1 class="page-title">PRIVACY POLICY</h1>
    </div>
    <div class="section" style="max-width:52rem">
      <p class="text-dim">
        This describes exactly what data RDOC Fleetplanner stores and logs. We keep it to the minimum
        needed to run the service. There are no tracking or advertising scripts and no advertising
        cookies.
      </p>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">Controller</div>
        <p class="mt-1">
          <strong>Raumdock – Star Citizen Orga</strong><br />
          Email: <a href="mailto:tower@raumdock.org">tower@raumdock.org</a><br />
          Full details in the <a href="${bp}/impressum">Legal Notice</a>.
        </p>
      </div>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">Account &amp; login data we store</div>
        <ul class="text-dim text-sm mt-1" style="padding-left:1.25rem;line-height:1.7">
          <li>An internal account ID, your instance role and an active flag, plus join and last-seen timestamps.</li>
          <li>
            For each linked login (Discord, and optionally GitHub or Google): the external account ID,
            display name, avatar URL, and an email address <em>if the provider returns one</em>. Our
            Discord login requests only <span class="text-mono">identify</span> and
            <span class="text-mono">guilds</span> — it does <strong>not</strong> request your Discord
            email. GitHub and Google logins do include your email.
          </li>
          <li>
            The list of Discord server IDs you share with the bot (from the
            <span class="text-mono">guilds</span> scope) and your role per server, so we can scope
            your access.
          </li>
        </ul>
      </div>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">Content &amp; configuration we store</div>
        <ul class="text-dim text-sm mt-1" style="padding-left:1.25rem;line-height:1.7">
          <li>Operations, fleet units / ships, seat assignments and crew requests you create or join.</li>
          <li>Ships you save to your hangar.</li>
          <li>
            For servers you administer: Discord guild, role and channel IDs, timezone, reminder
            lead time and server partnerships.
          </li>
        </ul>
      </div>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">Sessions &amp; cookies</div>
        <p class="text-dim text-sm mt-1">
          A login session (with a CSRF token) and, for the companion app, a bearer token stored on
          <em>your own device</em>. These expire automatically and can be cleared by logging out.
          We use no third-party or advertising cookies.
        </p>
      </div>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">What we do NOT store</div>
        <ul class="text-dim text-sm mt-1" style="padding-left:1.25rem;line-height:1.7">
          <li>No passwords — login is OAuth only.</li>
          <li>
            No OAuth access tokens — they are used once during sign-in to read your profile and guild
            list, then discarded (never written to the database).
          </li>
          <li>No voice or audio data.</li>
        </ul>
      </div>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">Server logs</div>
        <p class="text-dim text-sm mt-1">
          The application and its hosting provider write operational access logs containing your IP
          address, timestamp, HTTP method and requested path, and the response status — used only for
          debugging and system security. Secrets and tokens are not logged. Logs are rotated and
          deleted according to the host's retention policy.
        </p>
      </div>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">Third parties</div>
        <p class="text-dim text-sm mt-1">
          Login is handled via <strong>Discord</strong> (and optionally GitHub or Google). When you
          authenticate, your IP address is transmitted to that provider. The bot reads your Discord
          guild list and posts scheduled events to servers you administer. Legal basis: Art. 6(1)(b)
          GDPR (performance of the service you request) and Art. 6(1)(f) GDPR (legitimate interest in
          operating it).
        </p>
      </div>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">Retention &amp; deletion</div>
        <p class="text-dim text-sm mt-1">
          Account and content data is kept until you ask us to delete it or your server is removed.
          Sessions expire on their own. To request access, correction or deletion of your data, email
          <a href="mailto:tower@raumdock.org">tower@raumdock.org</a>.
        </p>
      </div>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">Your rights</div>
        <ul class="text-dim text-sm mt-1" style="padding-left:1.25rem;line-height:1.7">
          <li>Access, rectification, erasure / restriction</li>
          <li>Data portability and objection where legally permitted</li>
        </ul>
      </div>
    </div>`;
}


// ── Handbuch: Architektur ──────────────────────────────────────────────
// The long form lives in docs/ARCHITEKTUR.md (Mermaid, rendered by GitHub).
// This is the same content for the website, with the diagrams as INLINE SVG:
// the app CSP forbids inline script, so a browser-side diagram renderer is not
// an option. Colours come from the theme variables so both themes work.
export function architectureBody(bp: string): SafeHtml {
  const card = "card";
  const svgBox = "width:100%;height:auto;max-width:56rem;display:block";
  const scroll = "overflow-x:auto";
  return html` <div class="page-header">
      <h1 class="page-title" style="overflow-wrap:anywhere">SOFTWARE&shy;ARCHITEKTUR</h1>
      <p class="page-subtitle">
        Wie der Fleetplanner gebaut ist: Bausteine, Datenmodell, Abläufe. Die Langfassung mit allen
        Diagrammen liegt im Repository unter <code>docs/ARCHITEKTUR.md</code>.
      </p>
      <div style="margin-top:.4rem;display:flex;flex-wrap:wrap;gap:.4rem">
        <a href="${bp}/handbuch/technobabble" class="btn btn-sm">← Kurzfassung</a>
        <a href="${bp}/api-docs" class="btn btn-sm">API-Doku →</a>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Worum es geht</div>
      <div class="${card}" style="max-width:56rem">
        <p style="margin:0">
          Der Fleetplanner plant Star-Citizen-Operationen für Discord-Organisationen: Termin,
          Flottenbedarf, Sitzplätze, Anmeldung, Voice. Ein <strong>Mandant</strong> ist genau eine
          Discord-Guild — jede Operation, jede Umfrage und jede Vorlage gehört einem Server.
        </p>
        <p class="text-dim text-sm mt-1" style="margin-bottom:0">
          Der Bot spricht Discord ausschließlich über die offizielle REST-Schnittstelle mit Bot-Token
          plus signierte Interaktionen. Keine Nutzer-Tokens, kein veränderter Client, kein
          Dauer-Socket. Das erklärt eine Eigenheit weiter unten: „Interessiert"-Klicks werden
          abgefragt, nicht empfangen.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Bausteine zur Laufzeit</div>
      <div class="${card}" style="max-width:56rem">
        <div style="${scroll}">
          <svg viewBox="0 0 720 300" role="img" aria-label="Laufzeitdiagramm: Browser, Caddy, nginx, Fastify-Backend, PostgreSQL, Discord, Mission-Cover, Prometheus" style="${svgBox}">
            <g font-family="ui-monospace, monospace" font-size="11">
              <rect x="8" y="118" width="96" height="46" rx="8" fill="none" stroke="var(--border-hi, #555)"></rect>
              <text x="56" y="139" text-anchor="middle" fill="var(--text, #eee)">Browser</text>
              <text x="56" y="153" text-anchor="middle" fill="var(--dim, #999)" font-size="9">/ Crawler</text>

              <rect x="136" y="118" width="104" height="46" rx="8" fill="none" stroke="var(--accent, #c48a4a)"></rect>
              <text x="188" y="139" text-anchor="middle" fill="var(--text, #eee)">Caddy</text>
              <text x="188" y="153" text-anchor="middle" fill="var(--dim, #999)" font-size="9">TLS :443</text>

              <rect x="272" y="106" width="124" height="70" rx="8" fill="none" stroke="var(--accent, #c48a4a)"></rect>
              <text x="334" y="130" text-anchor="middle" fill="var(--text, #eee)">fleetplanner-web</text>
              <text x="334" y="146" text-anchor="middle" fill="var(--dim, #999)" font-size="9">nginx + React</text>
              <text x="334" y="162" text-anchor="middle" fill="var(--dim, #999)" font-size="9">Security-Header</text>

              <rect x="428" y="106" width="120" height="70" rx="8" fill="none" stroke="var(--cyan, #4fb5b5)"></rect>
              <text x="488" y="130" text-anchor="middle" fill="var(--text, #eee)">fleetplanner</text>
              <text x="488" y="146" text-anchor="middle" fill="var(--dim, #999)" font-size="9">Fastify + Prisma</text>
              <text x="488" y="162" text-anchor="middle" fill="var(--dim, #999)" font-size="9">Port 3200</text>

              <rect x="586" y="118" width="118" height="46" rx="8" fill="none" stroke="var(--cyan, #4fb5b5)"></rect>
              <text x="645" y="139" text-anchor="middle" fill="var(--text, #eee)">PostgreSQL</text>
              <text x="645" y="153" text-anchor="middle" fill="var(--dim, #999)" font-size="9">40 Entitäten</text>

              <rect x="428" y="26" width="120" height="42" rx="8" fill="none" stroke="var(--dim, #777)"></rect>
              <text x="488" y="43" text-anchor="middle" fill="var(--text, #eee)">Discord</text>
              <text x="488" y="57" text-anchor="middle" fill="var(--dim, #999)" font-size="9">REST · OAuth2</text>

              <rect x="272" y="216" width="124" height="42" rx="8" fill="none" stroke="var(--dim, #777)"></rect>
              <text x="334" y="233" text-anchor="middle" fill="var(--text, #eee)">mission-cover</text>
              <text x="334" y="247" text-anchor="middle" fill="var(--dim, #999)" font-size="9">Grafik-Renderer</text>

              <rect x="586" y="216" width="118" height="42" rx="8" fill="none" stroke="var(--dim, #777)"></rect>
              <text x="645" y="233" text-anchor="middle" fill="var(--text, #eee)">Prometheus</text>
              <text x="645" y="247" text-anchor="middle" fill="var(--dim, #999)" font-size="9">Messwerte</text>

              <g stroke="var(--dim, #888)" fill="none" stroke-width="1.2">
                <path d="M104 141 H136"></path>
                <path d="M240 141 H272"></path>
                <path d="M396 141 H428"></path>
                <path d="M548 141 H586"></path>
                <path d="M488 106 V68"></path>
                <path d="M428 168 H410 V237 H396"></path>
                <path d="M645 216 V186 H556 V176"></path>
              </g>
              <text x="412" y="134" text-anchor="middle" fill="var(--dim, #999)" font-size="9">proxy</text>
            </g>
          </svg>
        </div>
        <p class="text-dim text-sm mt-1" style="margin-bottom:0">
          <strong>nginx ist die Haustür, nicht nur ein Dateiserver.</strong> Es entscheidet pro Pfad
          zwischen Anwendung, statischer Datei und Backend — und setzt als einzige Schicht die
          Security-Header. Link-Vorschau-Bots bekommen statt der Anwendung das lesbare HTML des
          Backends; deshalb erzeugt das Backend überhaupt noch HTML.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Schichten im Backend</div>
      <div class="${card}" style="max-width:56rem">
        <div style="${scroll}">
          <table class="user-table">
            <tr><th>Schicht</th><th>Ort</th><th>Aufgabe</th></tr>
            <tr><td>Routen</td><td><code>routes/</code></td><td>HTTP, Prüfung der Eingaben, Statuscodes</td></tr>
            <tr><td>Verträge</td><td><code>fleetplanner-contracts</code></td><td>eine Typquelle für Backend und Oberfläche</td></tr>
            <tr><td>Darstellung</td><td><code>api/presenters.ts</code></td><td>Abbildung nach außen, Redaktion für anonyme Betrachter</td></tr>
            <tr><td>Fachlogik</td><td><code>services/</code> (43 Module)</td><td>kennt kein HTTP, liefert Ergebnisobjekte statt Statuscodes</td></tr>
            <tr><td>Datenzugriff</td><td>Prisma</td><td>eine Instanz für den ganzen Prozess</td></tr>
            <tr><td>Adapter</td><td><code>discord</code>, <code>scwiki</code>, <code>fleetyards</code></td><td>alles Externe</td></tr>
          </table>
        </div>
        <p class="text-dim text-sm mt-1" style="margin-bottom:0">
          Der Code ist bewusst modul-funktional, nicht objektorientiert: die Fachlogik besteht aus
          Funktionen über Datensätze. Echte Klassen gibt es drei — den Rate-Limiter, den Fehlertyp
          der Oberfläche und den erzeugten Datenbank-Client. Die fachlichen „Klassen" sind die
          Entitäten des Datenmodells.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Datenmodell — der Kern</div>
      <div class="${card}" style="max-width:56rem">
        <div style="${scroll}">
          <svg viewBox="0 0 720 320" role="img" aria-label="Datenmodell: Guild, Operation, Bedarf, Einheit, Sitzplatz, Nutzer, Verteilung, Interesse" style="${svgBox}">
            <g font-family="ui-monospace, monospace" font-size="11">
              <rect x="16" y="20" width="130" height="40" rx="8" fill="none" stroke="var(--accent, #c48a4a)"></rect>
              <text x="81" y="45" text-anchor="middle" fill="var(--text, #eee)">Server (Guild)</text>

              <rect x="16" y="110" width="130" height="58" rx="8" fill="none" stroke="var(--accent, #c48a4a)"></rect>
              <text x="81" y="132" text-anchor="middle" fill="var(--text, #eee)">Operation</text>
              <text x="81" y="147" text-anchor="middle" fill="var(--dim, #999)" font-size="9">Status</text>
              <text x="81" y="159" text-anchor="middle" fill="var(--dim, #999)" font-size="9">Sichtbarkeit</text>

              <rect x="222" y="110" width="140" height="58" rx="8" fill="none" stroke="var(--cyan, #4fb5b5)"></rect>
              <text x="292" y="132" text-anchor="middle" fill="var(--text, #eee)">Bedarf</text>
              <text x="292" y="147" text-anchor="middle" fill="var(--dim, #999)" font-size="9">Gruppe, Anforderung</text>
              <text x="292" y="159" text-anchor="middle" fill="var(--dim, #999)" font-size="9">Anzahl</text>

              <rect x="438" y="110" width="140" height="58" rx="8" fill="none" stroke="var(--cyan, #4fb5b5)"></rect>
              <text x="508" y="132" text-anchor="middle" fill="var(--text, #eee)">Einheit</text>
              <text x="508" y="147" text-anchor="middle" fill="var(--dim, #999)" font-size="9">Schiff, Squad, Fahrzeug</text>
              <text x="508" y="159" text-anchor="middle" fill="var(--dim, #999)" font-size="9">offen bis angenommen</text>

              <rect x="438" y="222" width="140" height="56" rx="8" fill="none" stroke="var(--cyan, #4fb5b5)"></rect>
              <text x="508" y="244" text-anchor="middle" fill="var(--text, #eee)">Sitzplatz</text>
              <text x="508" y="259" text-anchor="middle" fill="var(--dim, #999)" font-size="9">Pilot, Gunner, FPS</text>
              <text x="508" y="271" text-anchor="middle" fill="var(--dim, #999)" font-size="9">frei oder besetzt</text>

              <rect x="612" y="20" width="96" height="40" rx="8" fill="none" stroke="var(--gold, #ebcf52)"></rect>
              <text x="660" y="45" text-anchor="middle" fill="var(--text, #eee)">Nutzer</text>

              <rect x="222" y="222" width="140" height="56" rx="8" fill="none" stroke="var(--dim, #777)"></rect>
              <text x="292" y="244" text-anchor="middle" fill="var(--text, #eee)">Interesse</text>
              <text x="292" y="259" text-anchor="middle" fill="var(--dim, #999)" font-size="9">aus Discord</text>
              <text x="292" y="271" text-anchor="middle" fill="var(--dim, #999)" font-size="9">auch ohne Konto</text>

              <rect x="16" y="222" width="130" height="56" rx="8" fill="none" stroke="var(--dim, #777)"></rect>
              <text x="81" y="244" text-anchor="middle" fill="var(--text, #eee)">Verteilung</text>
              <text x="81" y="259" text-anchor="middle" fill="var(--dim, #999)" font-size="9">an Partner</text>
              <text x="81" y="271" text-anchor="middle" fill="var(--dim, #999)" font-size="9">offen bis geteilt</text>

              <g stroke="var(--dim, #888)" fill="none" stroke-width="1.2">
                <path d="M81 60 V110"></path>
                <path d="M146 139 H222"></path>
                <path d="M362 139 H438"></path>
                <path d="M508 168 V222"></path>
                <path d="M660 60 V139 H578"></path>
                <path d="M660 60 V250 H578"></path>
                <path d="M81 168 V222"></path>
                <path d="M146 250 H222"></path>
              </g>
              <text x="90" y="90" fill="var(--dim, #999)" font-size="9">1 : n</text>
              <text x="170" y="132" fill="var(--dim, #999)" font-size="9">fordert</text>
              <text x="382" y="132" fill="var(--dim, #999)" font-size="9">erfüllt</text>
              <text x="516" y="200" fill="var(--dim, #999)" font-size="9">hat Sitze</text>
              <text x="592" y="104" fill="var(--dim, #999)" font-size="9">Kapitän</text>
              <text x="592" y="290" fill="var(--dim, #999)" font-size="9">besetzt</text>
            </g>
          </svg>
        </div>
        <div style="${scroll}">
          <table class="user-table" style="margin-top:.9rem">
            <tr><th>Gruppe</th><th>Entitäten</th></tr>
            <tr><td>Mandant und Identität</td><td>Server, Mitgliedschaft, Nutzer, Identität, Sitzung, Partnerschaft, Freigaberegel</td></tr>
            <tr><td>Operation</td><td>Operation, Serie, Kommandant, Fragen, Protokoll, Cover, Dokument, Link, Stream, Hangar-Freigabe</td></tr>
            <tr><td>Flotte</td><td>Gruppe, Anforderung, Einheit, Sitzplatz, Hauptschiff, Bodentruppe</td></tr>
            <tr><td>Discord</td><td>Verteilung, Interesse, Voice-Empfänger</td></tr>
            <tr><td>Kataloge</td><td>Schiff, Ort, Fleetyards-Schiff, Sync-Zustände</td></tr>
            <tr><td>Community</td><td>Umfrage, Option, Stimme, Vorlage</td></tr>
            <tr><td>Betrieb</td><td>Einstellung, Systemereignis</td></tr>
          </table>
        </div>
        <p class="text-dim text-sm mt-1" style="margin-bottom:0">
          Zwei Regeln tragen das ganze Modell. <strong>Erstens:</strong> die globale Rolle trägt nur
          den Superadmin — Operator, Kapitän und Crew gelten <em>pro Server</em>. <strong>Zweitens:</strong>
          Status und Sichtbarkeit sind unabhängig; eine veröffentlichte Operation kann trotzdem nur
          intern sichtbar sein.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Ablauf: eine Operation veröffentlichen</div>
      <div class="${card}" style="max-width:56rem">
        <div style="${scroll}">
          <svg viewBox="0 0 720 430" role="img" aria-label="Ablaufplan: Operation veröffentlichen, Discord-Event anlegen, an Partner verteilen" style="${svgBox}">
            <defs>
              <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--dim, #888)"></path>
              </marker>
            </defs>
            <g font-family="ui-monospace, monospace" font-size="11" stroke-width="1.2">
              <rect x="250" y="14" width="220" height="34" rx="17" fill="none" stroke="var(--dim, #777)"></rect>
              <text x="360" y="35" text-anchor="middle" fill="var(--text, #eee)">Status auf „offen" setzen</text>

              <path d="M360 78 L446 104 L360 130 L274 104 Z" fill="none" stroke="var(--gold, #ebcf52)"></path>
              <text x="360" y="108" text-anchor="middle" fill="var(--text, #eee)">Operator?</text>
              <text x="470" y="100" fill="var(--red, #ee6e76)" font-size="9">nein: abgelehnt</text>

              <rect x="250" y="152" width="220" height="34" rx="6" fill="none" stroke="var(--cyan, #4fb5b5)"></rect>
              <text x="360" y="173" text-anchor="middle" fill="var(--text, #eee)">Status und Protokoll speichern</text>

              <path d="M360 216 L470 242 L360 268 L250 242 Z" fill="none" stroke="var(--gold, #ebcf52)"></path>
              <text x="360" y="238" text-anchor="middle" fill="var(--text, #eee)">Discord-Event</text>
              <text x="360" y="251" text-anchor="middle" fill="var(--dim, #999)" font-size="9">schon vorhanden?</text>

              <rect x="18" y="290" width="200" height="46" rx="6" fill="none" stroke="var(--cyan, #4fb5b5)"></rect>
              <text x="118" y="310" text-anchor="middle" fill="var(--text, #eee)">Event bei Discord anlegen</text>
              <text x="118" y="325" text-anchor="middle" fill="var(--dim, #999)" font-size="9">Fehler nur protokollieren</text>

              <path d="M360 300 L470 326 L360 352 L250 326 Z" fill="none" stroke="var(--gold, #ebcf52)"></path>
              <text x="360" y="322" text-anchor="middle" fill="var(--text, #eee)">Sichtbarkeit</text>
              <text x="360" y="335" text-anchor="middle" fill="var(--dim, #999)" font-size="9">Partner oder öffentlich?</text>

              <rect x="502" y="290" width="200" height="46" rx="6" fill="none" stroke="var(--cyan, #4fb5b5)"></rect>
              <text x="602" y="310" text-anchor="middle" fill="var(--text, #eee)">an Partner verteilen</text>
              <text x="602" y="325" text-anchor="middle" fill="var(--dim, #999)" font-size="9">automatisch oder auf Anfrage</text>

              <rect x="250" y="382" width="220" height="34" rx="17" fill="none" stroke="var(--green, #63c271)"></rect>
              <text x="360" y="403" text-anchor="middle" fill="var(--text, #eee)">Operation ist offen</text>

              <g stroke="var(--dim, #888)" fill="none" marker-end="url(#arch-arrow)">
                <path d="M360 48 V74"></path>
                <path d="M446 104 H466"></path>
                <path d="M360 130 V148"></path>
                <path d="M360 186 V212"></path>
                <path d="M250 242 H118 V286"></path>
                <path d="M118 336 V326 H246"></path>
                <path d="M470 242 H602 V286"></path>
                <path d="M470 326 H498"></path>
                <path d="M360 352 V378"></path>
              </g>
              <path d="M602 336 V362 H470 V378" stroke="var(--dim, #888)" fill="none"></path>
              <text x="176" y="236" fill="var(--dim, #999)" font-size="9">nein</text>
              <text x="478" y="236" fill="var(--dim, #999)" font-size="9">ja</text>
              <text x="366" y="374" fill="var(--dim, #999)" font-size="9">nein</text>
              <text x="478" y="320" fill="var(--dim, #999)" font-size="9">ja</text>
            </g>
          </svg>
        </div>
        <p class="text-dim text-sm mt-1" style="margin-bottom:0">
          Alle Discord-Schritte sind <strong>bestmöglich, nicht zwingend</strong>. Fällt Discord aus,
          bleibt die Operation trotzdem offen — ein fehlendes Discord-Event lässt sich nachholen, eine
          verlorene Operation nicht. Beim Absagen läuft derselbe Weg rückwärts: Event löschen,
          verteilte Partner-Events abbauen.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Ablauf: jede Anfrage an die Schnittstelle</div>
      <div class="${card}" style="max-width:56rem">
        <div style="${scroll}">
          <table class="user-table">
            <tr><th>Schritt</th><th>Prüfung</th><th>Antwort bei Ablehnung</th></tr>
            <tr><td>1</td><td>Wartungsmodus aktiv?</td><td>Wartungsseite, außer für den Superadmin</td></tr>
            <tr><td>2</td><td>Sind Pfad und Inhalt formal gültig?</td><td>400 — fehlerhafte Anfrage</td></tr>
            <tr><td>3</td><td>Ist eine Sitzung vorhanden?</td><td>401 — nicht angemeldet</td></tr>
            <tr><td>4</td><td>Bei Änderungen: passende Schutzkennung?</td><td>403 — abgelehnt</td></tr>
            <tr><td>5</td><td>Rolle im richtigen Server ausreichend?</td><td>403 — abgelehnt</td></tr>
            <tr><td>6</td><td>Ist das Anfragelimit frei?</td><td>429 — zu viele Anfragen</td></tr>
          </table>
        </div>
        <p class="text-dim text-sm mt-1" style="margin-bottom:0">
          Die Reihenfolge ist Absicht: erst Anmeldung, dann Fachprüfung. So verrät kein Fehlertext
          einem nicht angemeldeten Aufrufer, welche Felder ein Endpunkt erwartet. Fehler verlassen
          das System nur in einer Form — Kennung, bereinigte Meldung und eine Anfragenummer, mit der
          sich der Vorgang im Protokoll wiederfindet.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Ablauf: „Interessiert" aus Discord</div>
      <div class="${card}" style="max-width:56rem">
        <p style="margin:0">
          Discord meldet Zusagen nur über einen Dauer-Socket mit besonderer Berechtigung. Den nutzt
          der Fleetplanner bewusst nicht, also <strong>fragt er nach</strong>: alle fünf Minuten
          werden die Interessierten jedes offenen Events geladen und mit dem eigenen Stand
          abgeglichen.
        </p>
        <ul class="text-sm" style="margin:.6rem 0 0;padding-left:1.1rem;line-height:1.7">
          <li>Bekanntes Konto: wird direkt zugeordnet.</li>
          <li>Kein Konto: erscheint als Platzhalter und wird beim ersten Login übernommen.</li>
          <li>Zusage zurückgezogen: Eintrag wird stillgelegt, ein belegter Sitzplatz wieder frei.</li>
        </ul>
        <p class="text-dim text-sm mt-1" style="margin-bottom:0">
          Der Sitzplatz geht zurück, weil für bloßes Interesse die Discord-Zusage die Wahrheit ist.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Hintergrundläufe</div>
      <div class="${card}" style="max-width:56rem">
        <div style="${scroll}">
          <table class="user-table">
            <tr><th>Lauf</th><th>Takt</th><th>Aufgabe</th></tr>
            <tr><td>Erinnerungen</td><td>jede Minute</td><td>Nachrichten vor dem Start, Vorlauf je Server einstellbar</td></tr>
            <tr><td>Interesse</td><td>alle 5 Minuten</td><td>Discord-Zusagen abgleichen</td></tr>
            <tr><td>Serien</td><td>regelmäßig</td><td>wiederkehrende Operationen erzeugen</td></tr>
            <tr><td>Schiffs- und Ortskatalog</td><td>wöchentlich</td><td>Daten aus dem SC-Wiki</td></tr>
            <tr><td>Cover aufräumen</td><td>regelmäßig</td><td>Grafiken abgeschlossener Operationen nach 14 Tagen</td></tr>
          </table>
        </div>
        <p class="text-dim text-sm mt-1" style="margin-bottom:0">
          Die Läufe laufen im Anwendungsprozess. Deshalb läuft der Fleetplanner als eine Instanz —
          zwei würden dieselbe Arbeit doppelt machen.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Warum es so gebaut ist</div>
      <div class="${card}" style="max-width:56rem">
        <div style="${scroll}">
          <table class="user-table">
            <tr><th>Entscheidung</th><th>Grund</th><th>Preis</th></tr>
            <tr><td>Discord nur über die REST-Schnittstelle</td><td>keine besonderen Berechtigungen nötig</td><td>Zusagen kommen verzögert an</td></tr>
            <tr><td>Discord-Schritte bestmöglich</td><td>eine Operation darf nicht an Discord scheitern</td><td>Stände können auseinanderlaufen</td></tr>
            <tr><td>Rollen je Server</td><td>ein Konto bedient mehrere Organisationen</td><td>jede Prüfung braucht den Serverbezug</td></tr>
            <tr><td>Sitzungskennung nur als Prüfsumme</td><td>ein Datenbankleck ist nicht wiederverwendbar</td><td>Sitzungen sind aus der Datenbank nicht lesbar</td></tr>
            <tr><td>Security-Header nur im Proxy</td><td>zwei Quellen widersprachen sich</td><td>das Backend allein ist ungeschützt</td></tr>
          </table>
        </div>
      </div>
    </div>`;
}
