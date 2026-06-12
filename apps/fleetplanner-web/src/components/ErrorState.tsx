import { Link } from "react-router-dom";
import { Ic } from "./Icons";

// Shared system splash (401/403/404/503) — design §140-141: centered max 560px,
// tinted icon wrap by severity, large status code, title, body, one primary button.
const MONO = "var(--mono)";

type Sev = { tone: string; rgb: string; icon: string; label: string };

function severity(code: number): Sev {
  if (code === 401) return { tone: "var(--gold)", rgb: "240,165,0", icon: "lock", label: "ANMELDUNG ERFORDERLICH" };
  if (code === 403) return { tone: "var(--red2)", rgb: "255,107,107", icon: "ban", label: "KEIN ZUGRIFF" };
  if (code === 503) return { tone: "var(--gold)", rgb: "240,165,0", icon: "wrench", label: "WARTUNG" };
  return { tone: "var(--red2)", rgb: "255,107,107", icon: "alert", label: "NICHT GEFUNDEN" };
}

export function ErrorState({ code, message }: { code: number; message: string }) {
  const s = severity(code);
  return (
    <div data-testid={`error-${code}`} style={{ maxWidth: 560, margin: "4rem auto", textAlign: "center", padding: "0 1rem" }}>
      <span
        style={{
          width: 60, height: 60, borderRadius: 15, display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: `rgba(${s.rgb},0.1)`, border: `1px solid rgba(${s.rgb},0.3)`, color: s.tone, marginBottom: "1.1rem",
        }}
      >
        <Ic name={s.icon} size={28} sw={1.6} />
      </span>
      <div style={{ fontFamily: MONO, fontSize: "3rem", lineHeight: 1, color: s.tone, marginBottom: "0.4rem" }}>{code}</div>
      <div style={{ fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.14em", color: "var(--dim2)", marginBottom: "0.7rem" }}>{s.label}</div>
      <p style={{ color: "var(--dim)", fontSize: "0.95rem", lineHeight: 1.6, maxWidth: "42ch", margin: "0 auto 1.6rem" }}>{message}</p>
      {code === 401 ? (
        <Link className="btn" to="/login"><Ic name="lock" size={14} sw={1.7} /> Anmelden</Link>
      ) : (
        <Link className="btn" to="/"><Ic name="board" size={14} sw={1.7} /> Zur Übersicht</Link>
      )}
    </div>
  );
}
