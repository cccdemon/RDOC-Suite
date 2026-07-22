import { useRef, useState } from "react";
import { ApiError, deleteOpDocument, opDocumentUrl, uploadOpDocument, type OpDocument } from "../api/client";
import { Ic } from "./Icons";

const MONO = "var(--mono)";
const MAX_DOCS = 5;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// PDF attachments on an op. Managers (operator/creator/leader) upload/delete;
// everyone with op access can download. Used in the create wizard and on the op
// detail page. Seeds from `initialDocs`; keeps its own list as uploads/deletes land.
export function DocumentsPanel({
  opId,
  csrf,
  canManage,
  initialDocs = [],
  onNotice,
}: {
  opId: string;
  csrf: string | null;
  canManage: boolean;
  initialDocs?: OpDocument[];
  onNotice?: (m: string) => void;
}) {
  const [docs, setDocs] = useState<OpDocument[]>(initialDocs);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = ""; // allow re-picking the same file
    if (!file || !csrf || busy) return;
    if (file.type !== "application/pdf") { onNotice?.("Nur PDF-Dateien sind erlaubt."); return; }
    setBusy(true);
    try {
      const r = await uploadOpDocument(opId, csrf, file);
      setDocs((prev) => [...prev, r.document]);
      onNotice?.("Dokument hochgeladen.");
    } catch (err) {
      onNotice?.(err instanceof ApiError ? err.message : "Upload fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(docId: string) {
    if (!csrf || busy) return;
    setBusy(true);
    try {
      await deleteOpDocument(opId, docId, csrf);
      setDocs((prev) => prev.filter((d) => d.id !== docId));
    } catch (err) {
      onNotice?.(err instanceof ApiError ? err.message : "Löschen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  if (!canManage && docs.length === 0) return null;

  return (
    <section style={{ border: "1px solid rgba(0,212,255,0.16)", borderRadius: 14, background: "#090f18", padding: "1.1rem 1.2rem" }} data-testid="documents-panel">
      <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.06em", color: "#eaf4fb", marginBottom: "0.9rem" }}>
        <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="doc" size={15} sw={1.6} /></span> DOKUMENTE (PDF)
      </div>

      {docs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: canManage ? "0.9rem" : 0 }}>
          {docs.map((d) => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.45rem 0.6rem", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8 }}>
              <span style={{ color: "#ff6b6b", display: "inline-flex", flexShrink: 0 }}><Ic name="doc" size={15} sw={1.6} /></span>
              <a href={opDocumentUrl(opId, d.id)} target="_blank" rel="noopener noreferrer" data-testid={`doc-link-${d.id}`} style={{ flex: 1, minWidth: 0, color: "#cfe3f2", fontSize: "0.86rem", textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.filename}</a>
              <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "#5b6b7a", flexShrink: 0 }}>{humanSize(d.size)}</span>
              {canManage && (
                <button type="button" data-testid={`doc-del-${d.id}`} title="Dokument entfernen" disabled={busy} onClick={() => remove(d.id)} style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 6, border: "1px solid rgba(255,68,68,0.4)", background: "rgba(255,68,68,0.07)", color: "#ff6b6b", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Ic name="x" size={12} sw={2} /></button>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" data-testid="doc-input" onChange={onPick} style={{ display: "none" }} />
          <button type="button" data-testid="doc-upload" disabled={busy || !csrf || docs.length >= MAX_DOCS} onClick={() => fileRef.current?.click()} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0.5rem 1rem", border: "1px solid rgba(0,212,255,0.5)", background: "rgba(0,212,255,0.14)", color: "#00d4ff", fontFamily: MONO, fontSize: "0.74rem", borderRadius: 9, cursor: docs.length >= MAX_DOCS ? "not-allowed" : "pointer", opacity: docs.length >= MAX_DOCS ? 0.5 : 1 }}>
            <Ic name="plus" size={14} sw={1.8} /> {busy ? "Lädt…" : "PDF hochladen"}
          </button>
          <p style={{ fontSize: "0.72rem", color: "#5b6b7a", margin: "0.5rem 0 0" }}>Max. {MAX_DOCS} Dateien · je bis 8 MB · nur PDF.</p>
        </>
      )}
    </section>
  );
}
