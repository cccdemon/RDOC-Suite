// Tagged-template HTML renderer — no framework, no EJS, no Handlebars.
// Use html`...${expr}...` for auto-escaping. Wrap already-safe HTML in safe().

import { bridgeConfigured } from "../services/bridge.js";

export function escape(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE = Symbol("safe");
export type SafeHtml = { [SAFE]: true; html: string };

export function safe(input: string | SafeHtml): SafeHtml {
  if (typeof input === "object" && input && SAFE in input) return input;
  return { [SAFE]: true, html: input as string };
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = "";
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) out += renderValue(values[i]);
  }
  return { [SAFE]: true, html: out };
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === false) return "";
  if (Array.isArray(value)) return value.map(renderValue).join("");
  if (typeof value === "object" && value && SAFE in (value as Record<symbol, unknown>)) {
    return (value as SafeHtml).html;
  }
  return escape(value);
}

export function rawHtml(value: SafeHtml): string {
  return value.html;
}

// ── Layout ──────────────────────────────────────────────────────────

export type LayoutOptions = {
  title: string;
  basePath: string;
  currentUser?: { id: string; username: string; role: string } | null;
  csrfToken?: string;
  flash?: { kind: "ok" | "warn" | "error"; text: string } | null;
  navSlot?: SafeHtml;
  body: SafeHtml;
};

const ROLE_LABEL: Record<string, string> = {
  superadmin: "ADMIRAL",
  fleetoperator: "FLEET OP",
  captain: "CAPTAIN",
  crew: "CREW",
};

export function layout(opts: LayoutOptions): SafeHtml {
  const bp = opts.basePath;
  const u = opts.currentUser;

  const nav = html` <nav class="nav">
    <span class="nav-brand">RDOC // FLEETPLANNER</span>
    <a href="${bp}/">Operations</a>
    ${u ? html`<a href="${bp}/guilds">Servers</a>` : ""}
    <a href="${bp}/how-to">How to</a>
    <a href="${bp}/feedback">Feedback</a>
    ${u ? html`<a href="${bp}/profile">Profile</a>` : ""}
    ${u && u.role === "superadmin" ? html`<a href="${bp}/admin">Admin</a>` : ""}
    ${u && u.role === "superadmin" && bridgeConfigured()
      ? html`<a href="${bp}/admin/bridge">Bridge</a>`
      : ""}
    <span class="nav-spacer"></span>
    ${opts.navSlot ?? ""}
    <span class="credit-mark">
      <span class="credit-mark-domain">raumdock.org</span>
      <span class="credit-mark-copy"
        >made by xheadwigx &amp; justcallmedeimos · infrastructure powered by
        twitch.tv/justcallmedeimos</span
      >
    </span>
    ${u
      ? html` <span class="nav-user">
            <span class="tag tag-role">${ROLE_LABEL[u.role] ?? u.role}</span>
            ${u.username}
          </span>
          <form method="post" action="${bp}/auth/logout" class="inline">
            <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ""}" />
            <button type="submit" class="btn-link">Logout</button>
          </form>`
      : html`<a href="${bp}/login" class="btn btn-sm">Login</a>`}
  </nav>`;

  const flash = opts.flash
    ? html`<div class="flash flash-${opts.flash.kind}">${opts.flash.text}</div>`
    : "";

  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${opts.title} — RDOC Fleetplanner</title>
        <style>
          ${safe(CSS)}
        </style>
      </head>
      <body>
        ${nav}
        <main class="main">${flash} ${opts.body}</main>
        <footer class="footer">
          <a href="https://robertsspaceindustries.com/orgs/RDOC" target="_blank" rel="noopener"
            >RDOC</a
          >
          // FLEETPLANNER // RAUMDOCK.ORG // Tested by:
          <a href="https://twitch.tv/smorxel" target="_blank" rel="noopener">smorxel</a>,
          <a href="https://robertsspaceindustries.com/en/orgs/INFHOR" target="_blank" rel="noopener"
            >Infinite Horizon</a
          >,
          <a href="https://robertsspaceindustries.com/orgs/VFAR" target="_blank" rel="noopener"
            >Voidforge Armaments</a
          >
        </footer>
      </body>
    </html>`;
}

// ── DCCC Design System CSS ───────────────────────────────────────────

// No external font import: pulling from fonts.googleapis.com leaks every
// page visit to a third party and breaks rendering offline. The
// --font-mono / --font-body vars below already carry system-font
// fallbacks (ui-monospace / system-ui), so the UI renders fine without
// the Google fonts. To restore the exact Share Tech Mono / Rajdhani
// typefaces, self-host their woff2 files and add @font-face rules here.
const CSS = `
:root {
  --bg:        #050810;
  --bg2:       #090f18;
  --bg3:       #0e1926;
  --text:      #ccdde8;
  --dim:       rgba(200,220,232,0.45);
  --cyan:      #00d4ff;
  --cyan-08:   rgba(0,212,255,0.08);
  --cyan-18:   rgba(0,212,255,0.18);
  --cyan-28:   rgba(0,212,255,0.28);
  --cyan-38:   rgba(0,212,255,0.38);
  --cyan-50:   rgba(0,212,255,0.50);
  --gold:      #f0a500;
  --gold-08:   rgba(240,165,0,0.08);
  --gold-28:   rgba(240,165,0,0.28);
  --gold-38:   rgba(240,165,0,0.38);
  --green:     #00ff88;
  --green-08:  rgba(0,255,136,0.08);
  --red:       #ff4444;
  --red-08:    rgba(255,68,68,0.08);
  --border:    rgba(0,212,255,0.12);
  --border-hi: rgba(0,212,255,0.32);
  --font-mono: 'Share Tech Mono', ui-monospace, monospace;
  --font-body: 'Rajdhani', 'Inter', system-ui, sans-serif;
  --t-fast:    0.12s ease;
  --radius:    2px;
}

*,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }
[hidden] { display:none!important; }

html, body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.65;
  min-height: 100vh;
}

body::after {
  content: "";
  position: fixed; inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0,0,0,0.08) 2px,
    rgba(0,0,0,0.08) 4px
  );
  pointer-events: none;
  z-index: 9999;
}

a { color: var(--cyan); text-decoration: none; }
a:hover { color: #fff; }

/* ── Nav ─────────────────────────────────────────────────────── */
.nav {
  position: sticky; top: 0; z-index: 100;
  display: flex; align-items: center; gap: 0;
  background: var(--bg2);
  border-bottom: 1px solid var(--border-hi);
  padding: 0 2rem;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  letter-spacing: 0.04em;
}
.nav-brand {
  color: var(--cyan);
  font-weight: bold;
  font-size: 0.85rem;
  letter-spacing: 0.12em;
  padding: 1rem 2rem 1rem 0;
  border-right: 1px solid var(--border);
  margin-right: 0.75rem;
  white-space: nowrap;
}
.nav a {
  display: block;
  padding: 1rem 1rem;
  color: var(--dim);
  transition: color var(--t-fast), background var(--t-fast);
}
.nav a:hover { color: var(--text); background: var(--cyan-08); }
.nav-spacer { flex: 1; }
.nav-ui-switch {
  display: flex;
  align-items: center;
  gap: 0;
  margin: 0 0.75rem;
  border: 1px solid var(--border);
  background: var(--bg3);
  flex-shrink: 0;
}
.nav-ui-switch a {
  padding: 0.45rem 0.7rem;
  font-size: 0.68rem;
  letter-spacing: 0.06em;
}
.nav-ui-switch a.active {
  color: var(--cyan);
  background: var(--cyan-08);
}
.credit-mark {
  min-width: 318px;
  margin: 0 0.9rem;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  gap: 0.28rem;
  position: relative;
  flex-shrink: 0;
  padding: 0.42rem 0;
  animation: creditFadeIn 0.42s cubic-bezier(.19,1,.22,1) both;
}
.credit-mark::before,
.credit-mark::after {
  content: "";
  position: absolute;
  right: 0;
  width: 100%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0,212,255,0.38), rgba(240,165,0,0.42));
}
.credit-mark::before { top: 0; }
.credit-mark::after { bottom: 0; opacity: 0.68; }
.credit-mark-domain {
  font-family: var(--font-body);
  font-size: 0.9rem;
  line-height: 1;
  letter-spacing: 0.12em;
  color: #fff;
  font-weight: 700;
  text-transform: uppercase;
  text-shadow: 0 0 10px rgba(0,212,255,0.22);
}
.credit-mark-copy {
  font-family: var(--font-mono);
  font-size: 0.5rem;
  line-height: 1;
  letter-spacing: 0.04em;
  color: rgba(200,220,232,0.72);
  text-transform: uppercase;
  white-space: nowrap;
}
@keyframes creditFadeIn {
  0% { opacity: 0; transform: translateX(14px); }
  100% { opacity: .92; transform: translateX(0); }
}
@media (max-width: 1120px) {
  .credit-mark { display: none; }
}
@media (max-width: 840px) {
  .nav-ui-switch { display: none; }
}
.nav-user {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0 1rem;
  color: var(--dim);
  font-size: 0.8rem;
}
.btn-link {
  background: none; border: none; cursor: pointer;
  color: var(--dim); font-family: var(--font-mono); font-size: 0.8rem;
  padding: 1rem 0.75rem;
  transition: color var(--t-fast);
}
.btn-link:hover { color: var(--red); }
.inline { display: inline; }

/* ── Main ────────────────────────────────────────────────────── */
.main {
  width: 100%;
  padding: 2.75rem 3rem;
}

/* ── Footer ──────────────────────────────────────────────────── */
.footer {
  text-align: center;
  padding: 2rem;
  color: var(--dim);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  border-top: 1px solid var(--border);
  margin-top: 5rem;
}

/* ── Flash ───────────────────────────────────────────────────── */
.flash {
  padding: 1rem 1.25rem;
  margin-bottom: 2rem;
  font-family: var(--font-mono);
  font-size: 0.85rem;
  border-left: 3px solid;
}
.flash-ok    { background: var(--green-08); border-color: var(--green); color: var(--green); }
.flash-warn  { background: var(--gold-08);  border-color: var(--gold);  color: var(--gold); }
.flash-error { background: var(--red-08);   border-color: var(--red);   color: var(--red); }

/* ── Cards / Panels ──────────────────────────────────────────── */
.card {
  background: var(--bg2);
  border: 1px solid var(--border);
  padding: 1.75rem 2rem;
  margin-bottom: 1.25rem;
  position: relative;
}
.card::before {
  content: "";
  position: absolute; top: 0; left: 0;
  width: 3px; height: 100%;
  background: var(--cyan-38);
}
.card-header {
  display: flex; align-items: center; gap: 1rem;
  margin-bottom: 1.25rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}
.card-title {
  font-family: var(--font-mono);
  font-size: 0.92rem;
  color: var(--cyan);
  letter-spacing: 0.06em;
  flex: 1;
}
.card-meta { color: var(--dim); font-size: 0.82rem; }

/* ── Page header ─────────────────────────────────────────────── */
.page-header {
  margin-bottom: 2.5rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid var(--border);
}
.page-title {
  font-family: var(--font-mono);
  font-size: 1.5rem;
  color: var(--cyan);
  letter-spacing: 0.08em;
  margin-bottom: 0.35rem;
}
.page-subtitle { color: var(--dim); font-size: 0.92rem; line-height: 1.7; }

/* ── Buttons ─────────────────────────────────────────────────── */
.btn {
  display: inline-block;
  padding: 0.55rem 1.25rem;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  cursor: pointer;
  border: 1px solid var(--cyan-38);
  background: var(--cyan-08);
  color: var(--cyan);
  transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
  text-decoration: none;
  white-space: nowrap;
}
.btn:hover { background: var(--cyan-18); border-color: var(--cyan-50); color: #fff; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-sm { padding: 0.35rem 0.8rem; font-size: 0.75rem; }
.btn-danger { border-color: rgba(255,68,68,0.38); background: var(--red-08); color: var(--red); }
.btn-danger:hover { background: rgba(255,68,68,0.18); border-color: var(--red); }
.btn-gold   { border-color: var(--gold-38); background: var(--gold-08); color: var(--gold); }
.btn-gold:hover { background: var(--gold-28); }
.btn-green  { border-color: rgba(0,255,136,0.38); background: var(--green-08); color: var(--green); }
.btn-green:hover { background: rgba(0,255,136,0.18); }
.btn-ghost  { background: none; border-color: var(--border); color: var(--dim); }
.btn-ghost:hover { color: var(--text); border-color: var(--border-hi); }

/* ── Tags / Badges ───────────────────────────────────────────── */
.tag {
  display: inline-block;
  padding: 0.15rem 0.55rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  border: 1px solid var(--border);
  color: var(--dim);
}
.tag-cyan    { border-color: var(--cyan-38); color: var(--cyan); background: var(--cyan-08); }
.tag-gold    { border-color: var(--gold-38); color: var(--gold); background: var(--gold-08); }
.tag-green   { border-color: rgba(0,255,136,0.38); color: var(--green); background: var(--green-08); }
.tag-red     { border-color: rgba(255,68,68,0.38); color: var(--red); background: var(--red-08); }
.tag-dim     { border-color: var(--border); color: var(--dim); }
.tag-role    { border-color: var(--gold-38); color: var(--gold); background: var(--gold-08); font-size: 0.65rem; }

/* ── Tables ──────────────────────────────────────────────────── */
table { width: 100%; border-collapse: collapse; }
th {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  color: var(--dim);
  text-align: left;
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--border-hi);
}
td {
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.9rem;
  vertical-align: middle;
}
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--cyan-08); }

/* ── Forms ───────────────────────────────────────────────────── */
.form-group { margin-bottom: 1.5rem; }
label {
  display: block;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  color: var(--dim);
  margin-bottom: 0.5rem;
}
input[type=text], input[type=datetime-local], input[type=number],
input[type=search], select, textarea {
  width: 100%;
  background: var(--bg3);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 0.85rem;
  padding: 0.6rem 0.9rem;
  outline: none;
  transition: border-color var(--t-fast);
  appearance: none;
  line-height: 1.5;
}
input:focus, select:focus, textarea:focus { border-color: var(--cyan-50); }
textarea { resize: vertical; min-height: 90px; }
select option { background: var(--bg3); }

.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
.form-actions { display: flex; gap: 1rem; margin-top: 2rem; }

/* ── Op list ─────────────────────────────────────────────────── */
.op-date-board {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.op-day-group {
  display: grid;
  grid-template-columns: 7.5rem minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}
.op-day-label {
  position: sticky;
  top: 4.5rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 0.85rem;
  border: 1px solid var(--border);
  background: var(--bg2);
  font-family: var(--font-mono);
  min-height: 7.25rem;
}
.op-day-label span {
  color: var(--dim);
  font-size: 0.72rem;
  text-transform: uppercase;
}
.op-day-label strong {
  color: var(--cyan);
  font-size: 2rem;
  line-height: 1;
}
.op-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  gap: 0.85rem;
}
.op-card {
  --op-accent: var(--cyan);
  --op-accent-bg: var(--cyan-08);
  min-height: 12.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-top: 3px solid var(--op-accent);
  background:
    linear-gradient(145deg, var(--op-accent-bg), transparent 42%),
    var(--bg2);
  transition: transform var(--t-fast), border-color var(--t-fast), background var(--t-fast);
}
.op-card:hover {
  transform: translateY(-1px);
  border-color: var(--op-accent);
}
.op-card-top,
.op-card-meta,
.op-card-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.op-card-top { justify-content: space-between; }
.op-card-time {
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 0.9rem;
}
.op-type-pill {
  display: inline-block;
  padding: 0.18rem 0.55rem;
  border: 1px solid var(--op-accent);
  background: var(--op-accent-bg);
  color: var(--op-accent);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.op-card-title {
  flex: 1;
  color: var(--text);
  font-weight: 700;
  font-size: 1.08rem;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.op-card-footer {
  justify-content: space-between;
  color: var(--dim);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  border-top: 1px solid var(--border);
  padding-top: 0.75rem;
}
.op-card-footer span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.op-type-combat { --op-accent: #ff4f5e; --op-accent-bg: rgba(255,79,94,0.10); }
.op-type-pve { --op-accent: #ff7a45; --op-accent-bg: rgba(255,122,69,0.10); }
.op-type-mining { --op-accent: #f0a500; --op-accent-bg: rgba(240,165,0,0.12); }
.op-type-salvage { --op-accent: #9ad7ff; --op-accent-bg: rgba(154,215,255,0.10); }
.op-type-training { --op-accent: #00d4ff; --op-accent-bg: rgba(0,212,255,0.10); }
.op-type-mixed { --op-accent: #a064ff; --op-accent-bg: rgba(160,100,255,0.12); }
.op-type-exploration { --op-accent: #00ff88; --op-accent-bg: rgba(0,255,136,0.10); }
.op-type-transport { --op-accent: #d6c66a; --op-accent-bg: rgba(214,198,106,0.11); }
.op-type-social { --op-accent: #ff70c8; --op-accent-bg: rgba(255,112,200,0.10); }

.op-list { display: flex; flex-direction: column; gap: 0.75rem; }
.op-row {
  display: grid;
  grid-template-columns: 7.5rem 10rem 1fr auto auto auto;
  align-items: center;
  gap: 1.25rem;
  padding: 1.1rem 1.5rem;
  background: var(--bg2);
  border: 1px solid var(--border);
  transition: border-color var(--t-fast), background var(--t-fast);
}
.op-row:hover { border-color: var(--border-hi); background: rgba(0,212,255,0.03); }
.op-time { font-family: var(--font-mono); font-size: 0.8rem; color: var(--dim); }
.op-title { font-weight: 600; color: var(--text); font-size: 1rem; }
.op-count { font-family: var(--font-mono); font-size: 0.8rem; color: var(--dim); }

/* Server/guild badge on op rows — up to 5 color variants */
.op-guild-badge {
  font-size: 0.68rem; font-weight: 700; letter-spacing: .04em;
  padding: .18rem .52rem; border-radius: 3px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; max-width: 7rem;
}
.guild-a { background: rgba(0,212,255,.15); color: var(--cyan); border: 1px solid rgba(0,212,255,.35); }
.guild-b { background: rgba(160,100,255,.15); color: #a064ff; border: 1px solid rgba(160,100,255,.35); }
.guild-c { background: rgba(0,255,136,.12); color: var(--green); border: 1px solid rgba(0,255,136,.28); }
.guild-d { background: rgba(240,165,0,.15); color: var(--gold); border: 1px solid rgba(240,165,0,.35); }
.guild-e { background: rgba(255,68,68,.13); color: var(--red); border: 1px solid rgba(255,68,68,.28); }

/* Guild picker (home quick-create + form) */
.guild-picker-select, .guild-picker-select-form {
  background: var(--bg3); color: var(--text);
  border: 1px solid var(--border); padding: .35rem .6rem;
  font-size: .82rem; cursor: pointer;
}
.guild-selected-badge {
  display: inline-block; padding: .3rem .75rem;
  background: var(--bg3); border: 1px solid var(--border);
  font-size: .82rem; color: var(--dim);
}

/* ── Unit cards ──────────────────────────────────────────────── */
.unit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
  align-items: start;
  gap: 1.25rem;
  margin-top: 1.25rem;
}
.unit-card {
  background: var(--bg2);
  border: 1px solid var(--border);
  padding: 1.25rem;
  position: relative;
  min-width: 0;
  overflow: hidden;
}
.unit-card.status-accepted { border-left: 3px solid var(--green); }
.unit-card.status-pending  { border-left: 3px solid var(--gold); }
.unit-card.status-rejected { border-left: 3px solid var(--red); opacity: 0.6; }
.unit-card-header { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
.unit-name { font-family: var(--font-mono); font-size: 0.9rem; color: var(--cyan); flex: 1 1 12rem; min-width: 0; overflow-wrap: anywhere; }
.unit-captain { font-size: 0.78rem; color: var(--dim); margin-bottom: 0.5rem; }

.seat-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
}
.seat-row:last-child { border-bottom: none; }
.seat-label {
  font-family: var(--font-mono); font-size: 0.72rem; color: var(--dim);
  flex: 0 0 auto; min-width: 5rem; white-space: nowrap;
}
.seat-type  {
  font-size: 0.65rem; color: var(--dim);
  flex: 0 0 auto; white-space: nowrap;
}
.seat-user  {
  font-size: 0.82rem;
  flex: 1 1 7rem;   /* grows but never shrinks below 7rem → no char-wrapping */
  min-width: 7rem;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.seat-user.empty { color: var(--dim); font-style: italic; }
.seat-disabled { opacity: 0.45; }
.seat-assign-details {
  flex: 0 0 100%;
  margin-top: 0.25rem;
}
.seat-assign-details summary {
  display: inline-block;
  list-style: none;
}
.seat-assign-details summary::-webkit-details-marker {
  display: none;
}
.seat-assign-form {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(14rem, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.75rem;
  margin-top: 0.35rem;
  border: 1px solid var(--border);
  background: var(--bg3);
}
.seat-assign-form select {
  min-width: 14rem;
  padding: 0.45rem 0.65rem;
  font-size: 0.8rem;
}
.seat-setup {
  border: 1px solid var(--border);
  background: var(--bg3);
  padding: 0.65rem;
  margin: 0.75rem 0;
}
.seat-setup summary {
  cursor: pointer;
  font-family: var(--font-mono);
  color: var(--cyan);
  font-size: 0.78rem;
}
.seat-setup-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(4.5rem, auto) minmax(3.75rem, auto);
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.5rem;
}
.seat-setup-row input[type=text] {
  min-width: 0;
}
.seat-toggle {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.35rem;
  color: var(--dim);
  font-size: 0.75rem;
  white-space: nowrap;
}

/* ── Sections ────────────────────────────────────────────────── */
.section { margin-bottom: 3.5rem; }
.section-title {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.12em;
  color: var(--dim);
  text-transform: uppercase;
  margin-bottom: 1rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid var(--border);
}

/* ── Ship search ─────────────────────────────────────────────── */
.op-dashboard {
  display: grid;
  grid-template-columns: minmax(15rem, 0.8fr) minmax(0, 1.8fr) minmax(16rem, 0.9fr);
  gap: 1rem;
  align-items: start;
}
.op-side {
  border: 1px solid var(--border);
  background: var(--bg2);
  padding: 1rem;
  min-width: 0;
}
.op-control { min-width: 0; }
.fleet-list { display: flex; flex-direction: column; gap: 0.5rem; }
.fleet-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.65rem 0;
  border-bottom: 1px solid var(--border);
}
.fleet-row:last-child { border-bottom: none; }
.fleet-name {
  font-family: var(--font-mono);
  color: var(--cyan);
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}
.fleet-meta {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  align-items: flex-end;
  color: var(--dim);
  font-size: 0.75rem;
}
.system-map {
  position: relative;
  height: 11rem;
  border: 1px solid var(--border);
  background: radial-gradient(circle at 50% 50%, rgba(0,212,255,0.10), transparent 34%), var(--bg3);
  overflow: hidden;
  margin-bottom: 1rem;
}
.system-orbit {
  position: absolute;
  border: 1px solid var(--cyan-18);
  border-radius: 50%;
  inset: 2.4rem;
}
.orbit-b { inset: 1.25rem; border-color: var(--gold-38); opacity: 0.55; }
.system-core {
  position: absolute;
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 50%;
  left: calc(50% - 0.6rem);
  top: calc(50% - 0.6rem);
  background: var(--gold);
  box-shadow: 0 0 28px var(--gold);
}
.system-node {
  position: absolute;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--cyan);
  box-shadow: 0 0 14px var(--cyan);
}
.node-a { left: 24%; top: 34%; }
.node-b { right: 18%; bottom: 28%; }
.system-label {
  position: absolute;
  left: 0.75rem;
  bottom: 0.6rem;
  font-family: var(--font-mono);
  color: var(--cyan);
  letter-spacing: 0.08em;
}
.system-pyro { background: radial-gradient(circle at 50% 50%, rgba(255,68,68,0.16), transparent 35%), var(--bg3); }
.system-nyx { background: radial-gradient(circle at 50% 50%, rgba(255,204,0,0.12), transparent 35%), var(--bg3); }
.detail-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--border);
}
.detail-row span { color: var(--dim); font-size: 0.78rem; }
.detail-row strong { font-family: var(--font-mono); color: var(--text); text-align: right; }
.raidlead { display: flex; gap: 0.75rem; align-items: center; margin: 1rem 0; }
.raidlead img, .raidlead-fallback {
  width: 3rem;
  height: 3rem;
  border: 1px solid var(--cyan-38);
  background: var(--cyan-08);
}
.raidlead img { object-fit: cover; }
.raidlead-fallback {
  display: grid;
  place-items: center;
  font-family: var(--font-mono);
  color: var(--cyan);
}
.raidlead strong { display: block; color: var(--text); }
.action-brief p { margin-top: 0.35rem; color: var(--text); font-size: 0.88rem; line-height: 1.5; }
.crew-pool { margin-top: 1.25rem; }
.crew-request-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--border);
}
.crew-request-row:last-child { border-bottom: none; }

.mission-banner {
  min-height: 13rem;
  margin: -1.25rem 0 2rem;
  border: 1px solid var(--border);
  background-size: cover;
  background-position: center;
  box-shadow: inset 0 0 0 1px rgba(0,212,255,0.08);
}

.opv2-shell {
  max-width: 1180px;
  margin: 0 auto;
}
.opv2-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1.5rem;
  align-items: start;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid var(--border);
}
.opv2-hero-mission {
  min-height: 16rem;
  padding: 1.25rem;
  border: 1px solid var(--border);
  background-size: cover;
  background-position: center;
  box-shadow: inset 0 0 0 1px rgba(0,212,255,0.08);
}
.opv2-eyebrow {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-bottom: 0.6rem;
}
.opv2-hero h1 {
  font-family: var(--font-mono);
  font-size: 1.55rem;
  line-height: 1.25;
  letter-spacing: 0.06em;
  color: var(--cyan);
  overflow-wrap: anywhere;
}
.opv2-hero p {
  color: var(--dim);
  font-size: 0.92rem;
  margin-top: 0.4rem;
}
.opv2-switch,
.opv2-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.opv2-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 1rem 0;
}
.opv2-metric {
  border: 1px solid var(--border);
  background: var(--bg2);
  padding: 0.85rem 1rem;
}
.opv2-metric span {
  display: block;
  color: var(--dim);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.opv2-metric strong {
  display: block;
  margin-top: 0.3rem;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 1.25rem;
}
.opv2-metric.good { border-color: rgba(0,255,136,0.3); background: var(--green-08); }
.opv2-metric.warn { border-color: var(--gold-38); background: var(--gold-08); }
.opv2-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  margin: 0.5rem 0 1rem;
  border-bottom: 1px solid var(--border);
}
.opv2-tab {
  padding: 0.75rem 1rem;
  border: 1px solid transparent;
  border-bottom: none;
  color: var(--dim);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.06em;
}
.opv2-tab:hover {
  color: var(--text);
  background: var(--cyan-08);
}
.opv2-tab.active {
  color: var(--cyan);
  border-color: var(--border);
  background: var(--bg2);
}
.opv2-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(18rem, 0.8fr);
  gap: 1rem;
  align-items: start;
}
.opv2-panel {
  border: 1px solid var(--border);
  background: var(--bg2);
  padding: 1rem;
  min-width: 0;
}
.opv2-panel-title {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.12em;
  color: var(--cyan);
  text-transform: uppercase;
  margin-bottom: 0.8rem;
}
.opv2-stack {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.opv2-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.65rem 0;
  border-bottom: 1px solid var(--border);
}
.opv2-row:last-child { border-bottom: none; }
.opv2-row strong {
  display: block;
  font-family: var(--font-mono);
  color: var(--text);
  overflow-wrap: anywhere;
}
.opv2-row span {
  color: var(--dim);
  font-size: 0.8rem;
}
.opv2-row-meta {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  align-items: flex-end;
}
.opv2-composition-group {
  border: 1px solid var(--border);
  background: var(--bg3);
  padding: 0.75rem;
}
.opv2-requirement {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.55rem;
  align-items: center;
  padding: 0.45rem 0;
  border-top: 1px solid var(--border);
}
.opv2-requirement span:first-child {
  overflow-wrap: anywhere;
}
.opv2-unit-card {
  border: 1px solid var(--border);
  background: var(--bg3);
  padding: 0.75rem;
}
.opv2-unit-card > .opv2-row {
  padding-top: 0;
}
.opv2-seat-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.65rem;
}
.opv2-seat-row {
  display: grid;
  grid-template-columns: minmax(7rem, 1fr) minmax(7rem, 0.8fr) auto;
  gap: 0.65rem;
  align-items: center;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--border);
  background: rgba(5,8,16,0.42);
}
.opv2-seat-row.disabled {
  opacity: 0.55;
}
.opv2-seat-row strong {
  display: block;
  font-family: var(--font-mono);
  color: var(--text);
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}
.opv2-seat-row span {
  color: var(--dim);
  font-size: 0.75rem;
}
.opv2-seat-user {
  color: var(--text);
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}
.opv2-seat-user.empty {
  color: var(--dim);
  font-style: italic;
}
.opv2-seat-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 0.35rem;
}
.opv2-seat-assign {
  position: relative;
}
.opv2-seat-assign summary {
  display: inline-block;
  list-style: none;
  cursor: pointer;
}
.opv2-seat-assign summary::-webkit-details-marker {
  display: none;
}
.opv2-seat-assign form {
  min-width: 18rem;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.5rem;
  padding: 0.6rem;
  margin-top: 0.35rem;
  border: 1px solid var(--border);
  background: var(--bg2);
}
.opv2-seat-setup-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.5rem;
  align-items: center;
}
.opv2-form,
.opv2-inline-form {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.opv2-inline-form {
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}
.opv2-inline-form input[type=text] {
  width: auto;
  min-width: 12rem;
}
.opv2-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}
.opv2-edit-block {
  border-top: 1px solid var(--border);
  padding-top: 0.75rem;
}
.opv2-edit-block summary {
  display: inline-block;
  list-style: none;
  cursor: pointer;
}
.opv2-edit-block summary::-webkit-details-marker {
  display: none;
}

.ship-results { margin-top: 1.25rem; }
.ship-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr auto;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 1.1rem;
  background: var(--bg2);
  border: 1px solid var(--border);
  margin-bottom: 0.4rem;
  cursor: pointer;
  /* <button> resets — prevents browser default black/white */
  color: var(--text);
  font-family: var(--font-body);
  font-size: 1rem;
  text-align: left;
  width: 100%;
  transition: border-color var(--t-fast), background var(--t-fast);
}
.ship-row:hover { border-color: var(--border-hi); background: rgba(0,212,255,0.05); }
.ship-row.selected { border-color: var(--cyan-50); background: var(--cyan-08); }
/* ship-row inner elements — set explicitly so <strong>/<span> inside <button> stay on theme */
.ship-row strong { font-family: var(--font-mono); font-size: 0.88rem; color: var(--cyan); font-weight: 600; }
.ship-row span   { font-size: 0.8rem; color: var(--dim); }
.ship-name { font-family: var(--font-mono); font-size: 0.88rem; color: var(--cyan); }
.ship-mfr  { font-size: 0.8rem; color: var(--dim); }
.ship-stat { font-family: var(--font-mono); font-size: 0.78rem; color: var(--dim); text-align: center; }

/* ── Register form toggle ────────────────────────────────────── */
.collapse-toggle {
  background: none; border: none; cursor: pointer; width: 100%;
  display: flex; align-items: center; gap: 0.65rem;
  font-family: var(--font-mono); font-size: 0.82rem; letter-spacing: 0.08em;
  color: var(--dim); padding: 1rem 0; border-bottom: 1px solid var(--border);
  transition: color var(--t-fast);
}
.collapse-toggle:hover { color: var(--cyan); }
.collapse-body { display: none; padding-top: 1.5rem; }
.collapse-body.open { display: block; }

/* ── Unit type tabs ──────────────────────────────────────────── */
.type-tabs { display: flex; gap: 0; margin-bottom: 1.25rem; }
.type-tab {
  padding: 0.55rem 1.25rem;
  font-family: var(--font-mono); font-size: 0.78rem; letter-spacing: 0.06em;
  cursor: pointer; border: 1px solid var(--border); color: var(--dim);
  background: none; transition: all var(--t-fast);
}
.type-tab.active { border-color: var(--cyan-38); color: var(--cyan); background: var(--cyan-08); }
.type-tab:first-child { border-right: none; }

/* ── Admin table ─────────────────────────────────────────────── */
.user-table select { width: auto; padding: 0.2rem 0.4rem; font-size: 0.75rem; }

/* ── Helpers ─────────────────────────────────────────────────── */
.flex { display: flex; }
.gap-1 { gap: 0.5rem; }
.gap-2 { gap: 1rem; }
.mt-1 { margin-top: 0.5rem; }
.mt-2 { margin-top: 1rem; }
.mt-3 { margin-top: 1.5rem; }
.mb-1 { margin-bottom: 0.5rem; }
.text-dim { color: var(--dim); }
.text-sm { font-size: 0.82rem; }
.text-mono { font-family: var(--font-mono); }
.text-right { text-align: right; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 680px) {
  .main { padding: 1.25rem 0.75rem; }
  .card { padding: 1.25rem 1.25rem; }
  .card-header { align-items: flex-start; flex-wrap: wrap; }
  .seat-row { gap: 0.2rem 0.5rem; padding: 0.4rem 0; }
  .seat-user { min-width: 6rem; }
  .seat-assign-form { grid-template-columns: 1fr; padding: 0.65rem; }
  .seat-assign-form select { min-width: 0; }
  .seat-setup-row { grid-template-columns: 1fr; }
  .op-row { grid-template-columns: auto 1fr; gap: 0.35rem; }
  .op-guild-badge { grid-column: 1; }
  .op-title { grid-column: 2; }
  .op-time, .op-count { font-size: 0.72rem; }
  .op-time, .op-count, .tag { grid-column: span 2; }
  .op-day-group { grid-template-columns: 1fr; gap: 0.6rem; }
  .op-day-label {
    position: static;
    min-height: 0;
    flex-direction: row;
    align-items: baseline;
  }
  .op-day-label strong { font-size: 1.35rem; }
  .op-card { min-height: 0; }
  .form-row { grid-template-columns: 1fr; }
  .op-dashboard { grid-template-columns: 1fr; }
  .op-side { padding: 0.85rem; }
  .opv2-hero,
  .opv2-grid,
  .opv2-row {
    grid-template-columns: 1fr;
  }
  .opv2-switch,
  .opv2-row-meta {
    align-items: flex-start;
  }
  .opv2-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .opv2-form-grid {
    grid-template-columns: 1fr;
  }
  .opv2-inline-form {
    align-items: stretch;
  }
  .opv2-inline-form input[type=text] {
    width: 100%;
  }
  .opv2-seat-row,
  .opv2-seat-assign form,
  .opv2-seat-setup-row {
    grid-template-columns: 1fr;
  }
  .opv2-seat-actions {
    justify-content: flex-start;
  }
  .opv2-tab {
    flex: 1 1 50%;
    text-align: center;
  }
  /* ship search: stack on mobile */
  .ship-row { grid-template-columns: 1fr 1fr; gap: 0.5rem; padding: 0.75rem 0.9rem; }
  .ship-stat { display: none; }
  /* type tabs: full width on mobile */
  .type-tab { padding: 0.5rem 0.85rem; font-size: 0.75rem; }
}
`;
