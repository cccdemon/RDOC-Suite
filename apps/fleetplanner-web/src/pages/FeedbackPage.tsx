import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, sendFeedback } from "../api/client";
import type { SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { useT } from "../i18n";

const MONO = "var(--mono)";
const label: React.CSSProperties = { fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.1em", color: "var(--dim)", marginBottom: "0.4rem", display: "block" };
const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.95rem", padding: "0.55rem 0.7rem", borderRadius: 8, outline: "none" };

const MAX_FILES = 4;
const ALLOWED = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export function FeedbackPage({ session }: { session: SessionResponse | null }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const csrf = session?.csrfToken ?? null;
  const t = useT();

  function addFiles(list: FileList | null) {
    if (!list) return;
    const picked = Array.from(list).filter((f) => ALLOWED.includes(f.type));
    setFiles((prev) => [...prev, ...picked].slice(0, MAX_FILES));
  }

  if (session === null) return <div className="fpw-state"><span style={label}>{t("common.loading")}</span></div>;
  if (!session.user)
    return (
      <div className="fpw-state" data-testid="feedback-anon">
        <span style={label}>{t("common.authRequired")}</span>
        <Link className="fpw-btn" to="/login">{t("common.login")}</Link>
      </div>
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!csrf) return;
    if (!subject.trim() || !message.trim()) {
      setNotice({ ok: false, text: t("feedback.required") });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await sendFeedback(subject.trim(), message.trim(), csrf, files);
      setNotice({ ok: true, text: t("feedback.sent") });
      setSubject("");
      setMessage("");
      setFiles([]);
    } catch (err) {
      setNotice({ ok: false, text: err instanceof ApiError ? err.message : t("feedback.failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="feedback-page" style={{ width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.3rem" }}>
        <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="chat" size={20} /></span>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", color: "var(--text-hi)", margin: 0 }}>{t("feedback.title")}</h1>
      </div>
      <p className="fpw-meta" style={{ marginBottom: "1.2rem" }}>{t("feedback.intro")}</p>
      {notice && (
        <p className={`fpw-tag ${notice.ok ? "green" : "gold"}`} role="alert" data-testid="feedback-notice" style={{ display: "inline-flex", marginBottom: "1rem" }}>
          {notice.text}
        </p>
      )}
      <form onSubmit={submit} className="fpw-card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label style={label}>{t("feedback.subject")}</label>
          <input data-testid="feedback-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} style={field} />
        </div>
        <div>
          <label style={label}>{t("feedback.message")}</label>
          <textarea data-testid="feedback-message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1800} style={{ ...field, minHeight: 140, resize: "vertical" }} />
        </div>
        <div>
          <label style={label}>{t("feedback.attach")}</label>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem" }}>
            <label data-testid="feedback-attach-btn" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.45rem 0.8rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 8, cursor: files.length >= MAX_FILES ? "not-allowed" : "pointer", opacity: files.length >= MAX_FILES ? 0.5 : 1 }}>
              <Ic name="plus" size={13} sw={1.9} /> {t("feedback.attachAdd")}
              <input data-testid="feedback-files" type="file" accept={ALLOWED.join(",")} multiple disabled={files.length >= MAX_FILES} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
            </label>
            <span className="fpw-meta" style={{ fontSize: "0.74rem" }}>{t("feedback.attachHint")}</span>
          </div>
          {files.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginTop: "0.6rem" }}>
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} data-testid={`feedback-file-${i}`} style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 7, padding: "0.35rem 0.55rem" }}>
                  <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="doc" size={13} sw={1.6} /></span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: "0.82rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  <span className="fpw-meta" style={{ fontSize: "0.7rem", whiteSpace: "nowrap" }}>{Math.ceil(f.size / 1024)} KB</span>
                  <button type="button" data-testid={`feedback-file-remove-${i}`} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} style={{ border: "none", background: "transparent", color: "var(--dim)", cursor: "pointer", fontFamily: MONO, fontSize: "0.68rem", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Ic name="back" size={12} sw={1.7} /> {t("feedback.attachRemove")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button type="submit" data-testid="feedback-submit" className="fpw-btn" disabled={busy} style={{ alignSelf: "flex-start" }}>
          <Ic name="check" size={15} sw={2} /> {t("common.send")}
        </button>
      </form>
    </div>
  );
}
