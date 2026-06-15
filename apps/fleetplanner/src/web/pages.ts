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
import { getEnv } from "../config/env.js";
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

// ── Re-export layout for routes ─────────────────────────────────────
export { layout, rawHtml } from "./render.js";

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

function visibilityTag(visibility: string): SafeHtml {
  const key = VISIBILITY_META[visibility] ? visibility : "private";
  const m = VISIBILITY_META[key];
  return html`<span class="tag ${m.cls}">${m.icon} ${t(`vis.${key}`).toUpperCase()}</span>`;
}

/**
 * Visibility control: a select + save button for op leaders, or a plain
 * badge for everyone else. `action` is the POST target.
 */
function visibilityControl(opts: {
  visibility: string;
  canEdit: boolean;
  action: string;
  csrfToken?: string;
}): SafeHtml {
  if (!opts.canEdit) return visibilityTag(opts.visibility);
  const option = (value: string, label: string): SafeHtml =>
    html`<option value="${value}" ${opts.visibility === value ? safe("selected") : ""}>
      ${label}
    </option>`;
  return html`<form method="post" action="${opts.action}" class="opv2-inline-form">
    <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ""}" />
    <select name="visibility" aria-label="${t("vis.aria")}">
      ${option("private", `🔒 ${t("vis.private.long")}`)}
      ${option("partners", `🤝 ${t("vis.partners.long")}`)}
      ${option("public", `🌐 ${t("vis.public.long")}`)}
    </select>
    <button type="submit" class="btn btn-sm">${t("vis.set")}</button>
  </form>`;
}

function roleLabel(role: string): string {
  return role.replace(/_/g, " ");
}

function discordBotInviteUrl(clientId: string, permissions: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "bot applications.commands",
    permissions,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
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
          (Mission voice is currently being rebuilt from scratch and is unavailable for now;
          planning and Discord events work independently of it.)
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
            For servers you administer: Discord guild, role and channel IDs, timezone and voice
            settings, and server partnerships.
          </li>
          <li>
            Relay voice-bot tokens you enter are stored <strong>encrypted</strong> (AES with a
            per-token salt) and are never shown back in the browser.
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

