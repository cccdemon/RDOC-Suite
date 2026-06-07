import { html, layout, type SafeHtml } from "./render.js";

export type CoverPageOptions = {
  basePath: string;
  currentUser: { id: string; username: string; role: string } | null;
  csrfToken?: string;
  flash?: { kind: "ok" | "warn" | "error"; text: string } | null;
  op: { id: string; title: string };
  cover: {
    url: string;
    width: number;
    height: number;
    preset: string;
    format: string;
    updatedAt: Date;
  } | null;
  serviceConfigured: boolean;
  format: string;
  preset: string;
};

const FORMATS = ["16:9", "1:1", "9:16", "4:3"];
const PRESETS: Array<{ id: string; label: string }> = [
  { id: "fleet-ops", label: "Fleet Operations" },
  { id: "black-ops", label: "Black Ops" },
  { id: "exploration", label: "Exploration" },
  { id: "outlaw", label: "Outlaw" },
];

export function coverPage(opts: CoverPageOptions): SafeHtml {
  const bp = opts.basePath;
  const manageUrl = `${bp}/ops/${opts.op.id}/manage`;

  const selector = (name: string, value: string, options: Array<{ id: string; label: string }>) =>
    html`<select name="${name}">
      ${options.map(
        (o) =>
          html`<option value="${o.id}" ${o.id === value ? "selected" : ""}>${o.label}</option>`,
      )}
    </select>`;

  const generateForm = html`<form method="post" action="${bp}/api/ops/${opts.op.id}/cover" class="cover-form">
    <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ""}" />
    <label
      >Format
      ${selector(
        "format",
        opts.format,
        FORMATS.map((f) => ({ id: f, label: f })),
      )}</label
    >
    <label>Stil ${selector("preset", opts.preset, PRESETS)}</label>
    <button type="submit" class="btn">Cover generieren</button>
  </form>`;

  const editorUrl = `${bp}/ops/${opts.op.id}/cover/edit?format=${encodeURIComponent(
    opts.format,
  )}&preset=${encodeURIComponent(opts.preset)}`;

  const body = !opts.serviceConfigured
    ? html`<section class="panel">
        <h1>Mission Cover</h1>
        <p>
          Der Mission-Cover-Service ist nicht konfiguriert
          (<code>MISSIONCOVER_SERVICE_SECRET</code> fehlt). Sobald gesetzt, kann hier ein Cover
          gerendert werden.
        </p>
      </section>`
    : html`<section class="panel">
        <div class="cover-head">
          <h1>Mission Cover</h1>
        </div>
        <p class="muted">Operation: <strong>${opts.op.title}</strong></p>

        ${opts.cover
          ? html`<div class="cover-current">
              <img
                src="${opts.cover.url}"
                alt="Mission cover"
                style="max-width:100%;border:1px solid #1e293b;border-radius:8px"
              />
              <p class="muted">
                ${opts.cover.format} · ${opts.cover.preset} · ${opts.cover.width}×${opts.cover.height}px
              </p>
              <div class="cover-actions">
                <a href="${editorUrl}" class="btn">Im Editor öffnen</a>
                <form
                  method="post"
                  action="${bp}/api/ops/${opts.op.id}/cover/delete"
                  class="inline"
                  onsubmit="return confirm('Cover entfernen?')"
                >
                  <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ""}" />
                  <button type="submit" class="btn btn-danger">Entfernen</button>
                </form>
              </div>
            </div>`
          : html`<p class="muted">Noch kein Cover für diese Operation.</p>`}

        <hr class="divider" />
        <h2>${opts.cover ? "Neu generieren" : "Cover erzeugen"}</h2>
        <p class="muted">
          Schnellgenerierung aus den Operationsdaten, oder
          <a href="${editorUrl}">im Editor öffnen</a> für Feintuning.
        </p>
        ${generateForm}
      </section>`;

  // Always-visible way back to the operation being managed.
  const backBar = html`<div style="margin-bottom:14px">
    <a href="${manageUrl}" class="btn btn-cyan">← Zurück zur Mission</a>
  </div>`;

  return layout({
    title: "Mission Cover",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: opts.flash ?? null,
    body: html`${backBar}${body}`,
  });
}
