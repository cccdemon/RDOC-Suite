import { useState } from "react";
import { addResourceLink, ApiError, removeResourceLink, reorderResourceLinks } from "../api/client";
import type { OperationDetail } from "../api/types";
import { useT } from "../i18n";
import { CardHead, btnGhost, btnPrimary, card, inp } from "./ui";
import { Ic } from "./Icons";

// FR-A1: operator-curated briefing / tutorial links. The player side renders these
// read-only on the op-detail hero (op.resourceLinks); here the operator adds/removes
// them. Backend validates URLs (http/https) and caps the count → conflicts surface
// as a notice. Order matters (the player side renders them top-down), so each row
// carries move-up/move-down buttons — buttons, not drag: this list is short, and a
// keyboard or touch user must be able to do it too.
export function ResourceLinksPanel({
  op,
  opId,
  csrf,
  onChanged,
  onNotice,
}: {
  op: OperationDetail;
  opId: string;
  csrf: string | null;
  onChanged: () => void;
  onNotice: (m: string) => void;
}) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!csrf || busy) return;
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) {
      onNotice(t("rlink.invalid"));
      return;
    }
    setBusy(true);
    try {
      await addResourceLink(opId, csrf, { url: u, title: title.trim() || undefined });
      setUrl("");
      setTitle("");
      onChanged();
    } catch (e) {
      onNotice(e instanceof ApiError ? e.message : t("rlink.invalid"));
    } finally {
      setBusy(false);
    }
  }

  // Send the whole new order; the server ignores ids that are not ours.
  async function move(index: number, dir: -1 | 1) {
    if (!csrf || busy) return;
    const ids = op.resourceLinks.map((l) => l.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    const swapped = ids[index];
    const other = ids[target];
    if (!swapped || !other) return;
    ids[index] = other;
    ids[target] = swapped;
    setBusy(true);
    try {
      await reorderResourceLinks(opId, csrf, ids);
      onChanged();
    } catch (e) {
      onNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(linkId: string) {
    if (!csrf || busy) return;
    setBusy(true);
    try {
      await removeResourceLink(opId, linkId, csrf);
      onChanged();
    } catch (e) {
      onNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ ...card, marginTop: "1.1rem" }} data-testid="rlinks-panel">
      <CardHead icon="doc" label={t("rlink.title").toUpperCase()} tone="cyan" />
      <p style={{ margin: "0 0 0.9rem", color: "var(--dim2)", fontSize: "0.84rem" }}>{t("rlink.hint")}</p>

      {op.resourceLinks.length === 0 ? (
        <p style={{ margin: "0 0 1rem", color: "var(--dim2)", fontSize: "0.86rem" }} data-testid="rlinks-empty">
          {t("rlink.empty")}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "1rem" }}>
          {op.resourceLinks.map((l, i) => (
            <div
              key={l.id}
              data-testid={`rlink-${l.id}`}
              style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.45rem 0.6rem", borderRadius: 8, background: "var(--wash)", border: "1px solid var(--border)" }}
            >
              <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, color: "var(--cyan)", textDecoration: "none", fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {l.title || l.url} <span style={{ color: "var(--dim3)" }}>↗</span>
              </a>
              <button
                type="button"
                data-testid={`rlink-up-${l.id}`}
                aria-label={`${l.title || l.url} nach oben`}
                title="Nach oben"
                style={{ ...btnGhost, padding: "0.3rem 0.5rem", fontSize: "0.7rem" }}
                disabled={busy || !csrf || i === 0}
                onClick={() => move(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                data-testid={`rlink-down-${l.id}`}
                aria-label={`${l.title || l.url} nach unten`}
                title="Nach unten"
                style={{ ...btnGhost, padding: "0.3rem 0.5rem", fontSize: "0.7rem" }}
                disabled={busy || !csrf || i === op.resourceLinks.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                data-testid={`rlink-remove-${l.id}`}
                style={{ ...btnGhost, padding: "0.3rem 0.55rem", fontSize: "0.7rem", borderColor: "var(--edge-red)", color: "var(--red)" }}
                disabled={busy || !csrf}
                onClick={() => remove(l.id)}
              >
                <Ic name="x" size={12} sw={2} /> {t("rlink.remove")}
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <input
          type="url"
          data-testid="rlink-url"
          value={url}
          maxLength={500}
          placeholder={t("rlink.url")}
          onChange={(e) => setUrl(e.target.value)}
          style={{ ...inp, flex: "2 1 240px" }}
        />
        <input
          type="text"
          data-testid="rlink-title"
          value={title}
          maxLength={120}
          placeholder={t("rlink.label")}
          onChange={(e) => setTitle(e.target.value)}
          style={{ ...inp, flex: "1 1 160px" }}
        />
        <button type="button" data-testid="rlink-add" style={btnPrimary} disabled={busy || !csrf} onClick={add}>
          <Ic name="plus" size={13} sw={2} /> {t("rlink.add")}
        </button>
      </div>
    </section>
  );
}
