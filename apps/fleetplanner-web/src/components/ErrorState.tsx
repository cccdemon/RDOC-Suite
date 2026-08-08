import { Link } from "react-router-dom";
import { Ic } from "./Icons";
import { tint } from "./ui";
import { useT } from "../i18n";

// Shared system splash (401/403/404/503) — design §140-141: centered max 560px,
// tinted icon wrap by severity, large status code, title, body, one primary button.
const MONO = "var(--mono)";

type Sev = { tone: string; icon: string; labelKey: string };

function severity(code: number): Sev {
  if (code === 401) return { tone: "var(--gold)", icon: "lock", labelKey: "error.401" };
  if (code === 403) return { tone: "var(--red2)", icon: "ban", labelKey: "error.403" };
  if (code === 503) return { tone: "var(--gold)", icon: "wrench", labelKey: "error.503" };
  return { tone: "var(--red2)", icon: "alert", labelKey: "error.404" };
}

export function ErrorState({ code, message }: { code: number; message: string }) {
  const t = useT();
  const s = severity(code);
  return (
    <div data-testid={`error-${code}`} style={{ maxWidth: 560, margin: "4rem auto", textAlign: "center", padding: "0 1rem" }}>
      <span
        style={{
          width: 60, height: 60, borderRadius: 15, display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: tint(s.tone, 10), border: `1px solid ${tint(s.tone, 30)}`, color: s.tone, marginBottom: "1.1rem",
        }}
      >
        <Ic name={s.icon} size={28} sw={1.6} />
      </span>
      <div style={{ fontFamily: MONO, fontSize: "3rem", lineHeight: 1, color: s.tone, marginBottom: "0.4rem" }}>{code}</div>
      <div style={{ fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.14em", color: "var(--dim2)", marginBottom: "0.7rem" }}>{t(s.labelKey)}</div>
      <p style={{ color: "var(--dim)", fontSize: "0.95rem", lineHeight: 1.6, maxWidth: "42ch", margin: "0 auto 1.6rem" }}>{message}</p>
      {code === 401 ? (
        <Link className="btn" to="/login"><Ic name="lock" size={14} sw={1.7} /> {t("common.login")}</Link>
      ) : (
        <Link className="btn" to="/"><Ic name="board" size={14} sw={1.7} /> {t("common.toOverview")}</Link>
      )}
    </div>
  );
}
