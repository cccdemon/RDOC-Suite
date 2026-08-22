import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, getDiagnostics } from "../api/client";
import type { DiagnosticsResponse, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { MONO, card, lbl, tint } from "../components/ui";
import { useT } from "../i18n";
import { useGuildSelection } from "../serverContext";
import { Breadcrumbs } from "../components/Breadcrumbs";

// Severity keeps its functional colour - that is exactly what the functional
// set exists for - but the tint is derived instead of frozen.
const SEV: Record<string, { labelKey: string; color: string }> = {
  ok: { labelKey: "diag.sev.ok", color: "var(--green)" },
  warn: { labelKey: "diag.sev.warn", color: "var(--gold)" },
  error: { labelKey: "diag.sev.error", color: "var(--red)" },
};

export function DiagnosticsPage({ session }: { session: SessionResponse | null }) {
  const t = useT();
  const me = session?.user ?? null;
  const manageable = (session?.memberships ?? []).filter((m) => m.role === "fleetoperator");
  const [guildId, setGuildId] = useGuildSelection(manageable);
  const [diag, setDiag] = useState<DiagnosticsResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload(id: string) {
    setBusy(true); setNotice(null); setDiag(null);
    getDiagnostics(id)
      .then(setDiag)
      .catch((e) => setNotice(e instanceof ApiError ? e.message : t("diag.notLoadable")))
      .finally(() => setBusy(false));
  }
  useEffect(() => { if (guildId) reload(guildId); }, [guildId]);

  if (session === null) return <div className="fpw-state"><span style={lbl}>{t("common.loading")}</span></div>;
  if (!me) return <div className="fpw-state" data-testid="diag-anon"><span style={lbl}>{t("common.authRequired")}</span><Link className="fpw-btn" to="/login">{t("common.login")}</Link></div>;
  if (manageable.length === 0) return <div className="fpw-state" data-testid="diag-none"><span style={lbl}>{t("diag.noRights")}</span><p className="fpw-meta">{t("diag.noRightsHint")}</p></div>;

  return (
    <div data-testid="diagnostics-page" style={{ width: "100%" }}>
      {/* The server context is part of the address: which server these
          settings belong to must never be a guess (IA goal 4). */}
      <Breadcrumbs
        items={[
          { label: "Discord-Server", to: "/guilds" },
          { label: manageable.find((m) => m.guildId === guildId)?.guildName ?? "Server", to: guildId ? `/guilds?guild=${encodeURIComponent(guildId)}` : "/guilds" },
          { label: "Diagnose" },
        ]}
      />
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "0.8rem", marginBottom: "1.3rem" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.4rem" }}>
            <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="check" size={17} sw={1.7} /></span>
            <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.14em", color: "var(--dim2)" }}>{t("diag.label")}</span>
          </div>
          <h1 style={{ fontWeight: 700, fontSize: "1.7rem", lineHeight: 1.12, color: "var(--text-hi)", margin: 0 }}>{t("diag.title")}{diag ? ` · ${diag.guild.name}` : ""}</h1>
        </div>
        <button type="button" data-testid="diag-retest" disabled={busy || !guildId} onClick={() => guildId && reload(guildId)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.5rem 1rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 9, cursor: "pointer" }}><Ic name="refresh" size={14} sw={1.8} /> {t("diag.retest")}</button>
      </div>

      {manageable.length > 1 && (
        <select data-testid="diag-guild" value={guildId ?? ""} onChange={(e) => setGuildId(e.target.value)} style={{ background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: MONO, fontSize: "0.8rem", padding: "0.5rem 0.6rem", borderRadius: 8, marginBottom: "1rem", minWidth: 220 }}>
          {manageable.map((m) => <option key={m.guildId} value={m.guildId}>{m.guildName}</option>)}
        </select>
      )}

      {notice && <p className="fpw-tag gold" role="alert" data-testid="diag-notice" style={{ display: "inline-flex", marginBottom: "1rem" }}>{notice}</p>}

      {busy && !diag ? (
        <p className="fpw-meta">{t("diag.testing")}</p>
      ) : diag ? (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", marginBottom: "1.1rem" }}>
            {(["ok", "warn", "error"] as const).map((s) => {
              const sv = SEV[s];
              return <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: "0.7rem", padding: "4px 10px", borderRadius: 7, border: `1px solid ${tint(sv.color, 40)}`, background: `${tint(sv.color, 8)}`, color: sv.color }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: sv.color }} />{diag.summary[s]} {t(sv.labelKey)}</span>;
            })}
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: MONO, fontSize: "0.68rem", color: "var(--dim2)" }}>{t("diag.guild")} {diag.guild.id}</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
            {diag.bots.map((b) => {
              const sv = SEV[b.severity];
              return (
                <section key={b.key} data-testid={`diag-bot-${b.key}`} style={{ ...card, borderColor: `${tint(sv.color, 22)}` }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "0.8rem" }}>
                    <span style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, background: `${tint(sv.color, 12)}`, border: `1px solid ${tint(sv.color, 30)}`, color: sv.color, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Ic name="server" size={18} sw={1.6} /></span>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.3rem" }}>
                        <strong style={{ fontFamily: "var(--body)", fontWeight: 700, fontSize: "1.05rem", color: "var(--text-hi)" }}>{b.name}{b.username ? ` · @${b.username}` : ""}</strong>
                        <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.05em", padding: "2px 7px", borderRadius: 5, border: `1px solid ${tint(sv.color, 40)}`, background: `${tint(sv.color, 10)}`, color: sv.color }}>{t(sv.labelKey)}</span>
                      </div>
                      <div style={{ fontSize: "0.82rem", color: "var(--dim)", lineHeight: 1.45, marginBottom: "0.55rem" }}>{b.note}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                        {b.requiredPermissions.map((p) => {
                          const missing = b.missingPermissions.some((m) => m.key === p.key);
                          const col = missing ? "var(--red)" : "var(--green)";
                          return <span key={p.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: MONO, fontSize: "0.62rem", padding: "2px 7px", borderRadius: 5, border: `1px solid ${tint(col, 35)}`, background: tint(col, 7), color: col }}><Ic name={missing ? "x" : "check"} size={11} sw={2} />{p.label}</span>;
                        })}
                      </div>
                    </div>
                    {b.inviteUrl && (
                      <a href={b.inviteUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0.4rem 0.8rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.68rem", borderRadius: 7, textDecoration: "none", whiteSpace: "nowrap" }}>{b.installed ? t("diag.reinvite") : t("diag.install")}</a>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
