import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, sendFeedback } from "../api/client";
import type { SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { useT } from "../i18n";

const MONO = "var(--mono)";
const label: React.CSSProperties = { fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.1em", color: "#9fb1c2", marginBottom: "0.4rem", display: "block" };
const field: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "var(--bg3)", border: "1px solid rgba(0,212,255,0.14)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.95rem", padding: "0.55rem 0.7rem", borderRadius: 8, outline: "none" };

export function FeedbackPage({ session }: { session: SessionResponse | null }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const csrf = session?.csrfToken ?? null;
  const t = useT();

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
      await sendFeedback(subject.trim(), message.trim(), csrf);
      setNotice({ ok: true, text: t("feedback.sent") });
      setSubject("");
      setMessage("");
    } catch (err) {
      setNotice({ ok: false, text: err instanceof ApiError ? err.message : t("feedback.failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="feedback-page" style={{ width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.3rem" }}>
        <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="chat" size={20} /></span>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", color: "#eaf4fb", margin: 0 }}>{t("feedback.title")}</h1>
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
        <button type="submit" data-testid="feedback-submit" className="fpw-btn" disabled={busy} style={{ alignSelf: "flex-start" }}>
          <Ic name="check" size={15} sw={2} /> {t("common.send")}
        </button>
      </form>
    </div>
  );
}
