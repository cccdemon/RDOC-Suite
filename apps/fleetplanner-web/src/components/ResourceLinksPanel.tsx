import { useState } from "react";
import { addResourceLink, ApiError, removeResourceLink } from "../api/client";
import type { OperationDetail } from "../api/types";
import { useT } from "../i18n";
import { CardHead, btnGhost, btnPrimary, card, inp } from "./ui";
import { Ic } from "./Icons";

// FR-A1: operator-curated briefing / tutorial links. The player side renders these
// read-only on the op-detail hero (op.resourceLinks); here the operator adds/removes
// them. Backend validates URLs (http/https) and caps the count → conflicts surface
// as a notice. Reorder (PATCH sortOrder) is not wired — backend has no PATCH route.
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
          {op.resourceLinks.map((l) => (
            <div
              key={l.id}
              data-testid={`rlink-${l.id}`}
              style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.45rem 0.6rem", borderRadius: 8, background: "rgba(43, 49, 53, 0.05)", border: "1px solid var(--border)" }}
            >
              <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, color: "var(--cyan)", textDecoration: "none", fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {l.title || l.url} <span style={{ color: "var(--dim3)" }}>↗</span>
              </a>
              <button
                type="button"
                data-testid={`rlink-remove-${l.id}`}
                style={{ ...btnGhost, padding: "0.3rem 0.55rem", fontSize: "0.7rem", borderColor: "rgba(228, 115, 106,0.4)", color: "var(--red)" }}
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
