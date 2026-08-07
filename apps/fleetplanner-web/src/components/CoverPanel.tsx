import { useEffect, useState } from "react";
import { ApiError, coverEditLink, deleteOpCover, generateOpCover, getOpCover, type OpCover } from "../api/client";
import { CardHead, MONO, btnGhost, btnPrimary, card, inp, lbl } from "./ui";
import { Ic } from "./Icons";
import { useT } from "../i18n";

const FORMATS = ["16:9", "1:1", "9:16", "4:3"];
const PRESETS: Array<[string, string]> = [
  ["fleet-ops", "Fleet Operations"],
  ["black-ops", "Black Ops"],
  ["exploration", "Exploration"],
  ["outlaw", "Outlaw"],
];

// Cover management panel (OpManagePage "Cover" tab). All actions go through
// /api/v1; the "Editor öffnen" flow navigates the browser to the external
// mission-cover editor, which redirects back to /ops/:id/cover/saved on save.
export function CoverPanel({ opId, csrf, onNotice }: { opId: string; csrf: string | null; onNotice: (m: string) => void }) {
  const [cover, setCover] = useState<OpCover | null>(null);
  const [serviceConfigured, setServiceConfigured] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState("16:9");
  const [preset, setPreset] = useState("fleet-ops");
  const t = useT();

  function reload() {
    getOpCover(opId)
      .then((s) => {
        setCover(s.cover);
        setServiceConfigured(s.serviceConfigured);
        if (s.cover) {
          setFormat(s.cover.format);
          setPreset(s.cover.preset);
        }
      })
      .catch(() => setServiceConfigured(false))
      .finally(() => setLoaded(true));
  }
  useEffect(reload, [opId]);

  async function run(action: () => Promise<unknown>, msg: string) {
    if (!csrf) return;
    setBusy(true);
    try {
      await action();
      onNotice(msg);
      reload();
    } catch (e) {
      onNotice(e instanceof ApiError ? e.message : t("cover.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  const generate = () => run(() => generateOpCover(opId, csrf!, { format, preset }), t("cover.genDone"));
  const remove = () => {
    if (!window.confirm(t("cover.removeConfirm"))) return;
    run(() => deleteOpCover(opId, csrf!), t("cover.removed"));
  };
  async function openEditor() {
    if (!csrf) return;
    setBusy(true);
    try {
      const { editorUrl } = await coverEditLink(opId, csrf, { format, preset });
      window.location.href = editorUrl;
    } catch (e) {
      onNotice(e instanceof ApiError ? e.message : t("cover.editorFailed"));
      setBusy(false);
    }
  }

  if (!loaded) return <p style={lbl}>{t("common.loading")}</p>;

  if (!serviceConfigured)
    return (
      <section style={card} data-testid="cover-panel">
        <CardHead icon="image" label={t("cover.label")} tone="cyan" />
        <p style={{ margin: 0, color: "var(--dim2)", fontSize: "0.86rem" }}>
          {t("cover.notConfigured")}
        </p>
      </section>
    );

  const danger: React.CSSProperties = { ...btnGhost, borderColor: "rgba(228, 115, 106,0.5)", color: "var(--red)" };

  return (
    <section style={card} data-testid="cover-panel">
      <CardHead icon="image" label={t("cover.label")} tone="cyan" />

      {cover ? (
        <div style={{ marginBottom: "1.1rem" }}>
          <img
            src={cover.url}
            alt="Mission-Cover"
            data-testid="cover-image"
            style={{ maxWidth: "100%", border: "1px solid var(--border)", borderRadius: 8, display: "block" }}
          />
          <p style={{ fontFamily: MONO, fontSize: "0.7rem", color: "var(--dim)", margin: "0.5rem 0 0" }}>
            {cover.format} · {cover.preset} · {cover.width}×{cover.height}px
          </p>
        </div>
      ) : (
        <p style={{ margin: "0 0 1.1rem", color: "var(--dim2)", fontSize: "0.86rem" }} data-testid="cover-empty">
          {t("cover.empty")}
        </p>
      )}

      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.9rem" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "var(--dim)", fontSize: "0.82rem" }}>
          {t("cover.format")}
          <select data-testid="cover-format" value={format} onChange={(e) => setFormat(e.target.value)} style={{ ...inp, width: "auto", minWidth: 90 }}>
            {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "var(--dim)", fontSize: "0.82rem" }}>
          {t("cover.style")}
          <select data-testid="cover-preset" value={preset} onChange={(e) => setPreset(e.target.value)} style={{ ...inp, width: "auto", minWidth: 160 }}>
            {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" data-testid="cover-generate" style={btnPrimary} disabled={busy || !csrf} onClick={generate}>
          <Ic name="bolt" size={13} sw={2} /> {cover ? t("cover.regenerate") : t("cover.generate")}
        </button>
        <button type="button" data-testid="cover-edit" style={btnGhost} disabled={busy || !csrf} onClick={openEditor}>
          <Ic name="edit" size={13} sw={1.8} /> {t("cover.openEditor")}
        </button>
        {cover && (
          <button type="button" data-testid="cover-delete" style={danger} disabled={busy || !csrf} onClick={remove}>
            <Ic name="x" size={13} sw={1.8} /> {t("common.remove")}
          </button>
        )}
      </div>
    </section>
  );
}
