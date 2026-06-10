import { html, safe, layout, type SafeHtml } from "./render.js";
import { t } from "../i18n/index.js";

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
      >${t("cover.format")}
      ${selector(
        "format",
        opts.format,
        FORMATS.map((f) => ({ id: f, label: f })),
      )}</label
    >
    <label>${t("cover.style")} ${selector("preset", opts.preset, PRESETS)}</label>
    <button type="submit" class="btn">${t("cover.generate")}</button>
  </form>`;

  const editorUrl = `${bp}/ops/${opts.op.id}/cover/edit?format=${encodeURIComponent(
    opts.format,
  )}&preset=${encodeURIComponent(opts.preset)}`;

  const body = !opts.serviceConfigured
    ? html`<section class="panel">
        <h1>${t("cover.title")}</h1>
        <p>
          ${safe(t("cover.notConfigured"))}
        </p>
      </section>`
    : html`<section class="panel">
        <div class="cover-head">
          <h1>${t("cover.title")}</h1>
        </div>
        <p class="muted">${t("cover.operation")}: <strong>${opts.op.title}</strong></p>

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
                <a href="${editorUrl}" class="btn">${t("cover.openEditor")}</a>
                <form
                  method="post"
                  action="${bp}/api/ops/${opts.op.id}/cover/delete"
                  class="inline"
                  onsubmit="return confirm('${t("cover.confirmRemove")}')"
                >
                  <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ""}" />
                  <button type="submit" class="btn btn-danger">${t("cover.remove")}</button>
                </form>
              </div>
            </div>`
          : html`<p class="muted">${t("cover.noCover")}</p>`}

        <hr class="divider" />
        <h2>${opts.cover ? t("cover.regenerate") : t("cover.create")}</h2>
        <p class="muted">
          ${safe(t("cover.quickGenDesc", { link: `<a href="${editorUrl}">${t("cover.openEditorLower")}</a>` }))}
        </p>
        ${generateForm}
      </section>`;

  // Always-visible way back to the operation being managed.
  const backBar = html`<div style="margin-bottom:14px">
    <a href="${manageUrl}" class="btn btn-cyan">← ${t("cover.backToMission")}</a>
  </div>`;

  return layout({
    title: t("cover.title"),
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: opts.flash ?? null,
    body: html`${backBar}${body}`,
  });
}
