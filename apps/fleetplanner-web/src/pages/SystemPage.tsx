import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, getSystemEvents, getSystemHealth, syncCatalog } from "../api/client";
import type { ServiceHealth, SessionResponse, SyncHealth, SystemEvent } from "../api/types";
import { Ic } from "../components/Icons";

const MONO = "'Share Tech Mono',ui-monospace,monospace";
const label: React.CSSProperties = { fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.12em", color: "var(--dim)", marginBottom: "0.7rem" };
const POLL_MS = 5000;

const STATUS_COLOR: Record<string, string> = { ok: "var(--green)", warn: "var(--gold)", error: "var(--red)", down: "var(--red)" };
const STATUS_TEXT: Record<string, string> = { ok: "OK", warn: "Warnung", error: "Fehler", down: "Offline" };
const LEVEL_COLOR: Record<string, string> = { info: "#5fa8d8", warn: "var(--gold)", error: "var(--red)" };
const CAT_LABEL: Record<string, string> = {
  "sync.ship": "Schiff-Sync",
  "sync.location": "Standort-Sync",
  scheduler: "Scheduler",
  "http.error": "HTTP-Fehler",
  health: "Health",
};

function fmtRel(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const days = Math.floor(h / 24);
  return days === 1 ? "gestern" : `vor ${days} Tagen`;
}
function fmtTs(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function SystemPage({ session }: { session: SessionResponse | null }) {
  const me = session?.user ?? null;
  const csrf = session?.csrfToken ?? null;

  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [syncs, setSyncs] = useState<SyncHealth[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [retentionDays, setRetentionDays] = useState(10);
  const [levelFilter, setLevelFilter] = useState<string>("");
  const [catFilter, setCatFilter] = useState<string>("");
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const filtersRef = useRef({ levelFilter, catFilter });
  filtersRef.current = { levelFilter, catFilter };

  function flash(msg: string) {
    setToast(msg);
    window.clearTimeout((flash as unknown as { _t?: number })._t);
    (flash as unknown as { _t?: number })._t = window.setTimeout(() => setToast(null), 2600);
  }

  const refresh = useCallback(async () => {
    const { levelFilter: lvl, catFilter: cat } = filtersRef.current;
    try {
      const [h, e] = await Promise.all([
        getSystemHealth(),
        getSystemEvents({ level: lvl || undefined, category: cat || undefined, limit: 300 }),
      ]);
      setServices(h.services);
      setSyncs(h.syncs);
      setCheckedAt(h.checkedAt);
      setEvents(e.events);
      setRetentionDays(e.retentionDays);
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "System-Status nicht ladbar.");
    }
  }, []);

  useEffect(() => {
    if (me?.role !== "superadmin") return;
    void refresh();
  }, [me, refresh, levelFilter, catFilter]);

  useEffect(() => {
    if (me?.role !== "superadmin" || !live) return;
    const t = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(t);
  }, [me, live, refresh]);

  async function runSync(kind: "ships" | "locations") {
    if (!csrf) return;
    setBusy(true);
    try {
      await syncCatalog(csrf, kind);
      flash(`${kind === "ships" ? "Schiffskatalog" : "Standortkatalog"}-Sync gestartet.`);
      window.setTimeout(() => void refresh(), 600);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : "Sync konnte nicht gestartet werden.");
    } finally {
      setBusy(false);
    }
  }

  if (session === null) return <div className="fpw-state"><span style={label}>LADE…</span></div>;
  if (me?.role !== "superadmin")
    return (
      <div className="fpw-state" data-testid="system-forbidden">
        <span style={label}>NUR SUPERADMIN</span>
        <Link className="fpw-btn" to="/">Zur Übersicht</Link>
      </div>
    );

  const card: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 13, background: "var(--bg2)", padding: "1.05rem 1.15rem" };
  const tile = (key: string, name: string, status: string, detail: string, icon: string) => {
    const c = STATUS_COLOR[status] ?? "var(--dim)";
    return (
      <div key={key} data-testid={`svc-${key}`} style={{ border: "1px solid var(--border)", borderLeft: `3px solid ${c}`, borderRadius: 12, background: "var(--bg2)", padding: "0.85rem 0.95rem", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.06em", color: "var(--text)" }}>
            <span style={{ color: c, display: "inline-flex" }}><Ic name={icon} size={14} sw={1.6} /></span>{name}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontFamily: MONO, fontSize: "0.58rem", color: c }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}` }} />{STATUS_TEXT[status] ?? status}
          </span>
        </div>
        <div style={{ fontSize: "0.78rem", color: "var(--dim)", lineHeight: 1.3 }}>{detail}</div>
      </div>
    );
  };

  const filteredEvents = events; // server-side filtered already

  return (
    <div data-testid="system-page" style={{ width: "100%", color: "var(--text)" }}>
      <style>{`@keyframes fpw-spin{to{transform:rotate(360deg)}}`}</style>

      {/* HEADER */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "1rem 1.4rem", marginBottom: "1.4rem", paddingBottom: "1.1rem", borderBottom: "1px solid var(--border)" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.35rem" }}><span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="shield" size={19} sw={1.7} /></span><span style={{ fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.14em", color: "var(--dim3)" }}>ADMIN // SYSTEM &amp; LOGS</span></div>
          <h1 style={{ fontWeight: 700, fontSize: "1.95rem", lineHeight: 1.05, color: "var(--text-hi)", margin: 0 }}>System &amp; Logs</h1>
          <div style={{ color: "var(--dim)", fontSize: "0.9rem", marginTop: "0.2rem" }}>
            {checkedAt ? <>Stand <span style={{ fontFamily: MONO, color: "var(--dim2)" }}>{fmtTs(checkedAt)}</span></> : "—"} · Log-Historie {retentionDays} Tage
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.7rem" }}>
          <button type="button" data-testid="live-toggle" onClick={() => setLive((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0.5rem 0.85rem", fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.03em", borderRadius: 9, cursor: "pointer", whiteSpace: "nowrap", border: `1px solid ${live ? "var(--green)66" : "var(--dim3)66"}`, background: live ? "var(--green)12" : "var(--bg3)", color: live ? "var(--green)" : "var(--dim2)" }}>
            <span style={live ? { animation: "fpw-spin 0.9s linear infinite", display: "inline-flex" } : { display: "inline-flex" }}><Ic name="refresh" size={14} sw={1.8} /></span>
            Live {live ? "an" : "aus"}
          </button>
          <button type="button" data-testid="manual-refresh" onClick={() => void refresh()} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0.5rem 0.8rem", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 9, cursor: "pointer", border: "1px solid var(--border-hi)", background: "rgba(43, 49, 53, 0.06)", color: "var(--dim)" }}>
            <Ic name="refresh" size={14} sw={1.8} /> Aktualisieren
          </button>
        </div>
      </div>

      {err && (
        <div style={{ ...card, borderColor: "rgba(228, 115, 106,0.4)", color: "var(--red)", marginBottom: "1.1rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <Ic name="alert" size={16} sw={1.7} /> {err}
        </div>
      )}

      {/* SERVICE HEALTH */}
      <div style={{ ...label, marginBottom: "0.6rem" }}>DIENSTE</div>
      <div data-testid="system-services" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: "0.8rem", marginBottom: "1.3rem" }}>
        {services.map((s) => tile(s.key, s.name, s.status, s.detail, s.key === "db" ? "server" : "clock"))}
        {syncs.map((s) =>
          tile(
            s.key,
            s.name,
            s.status,
            s.running ? (s.stale ? "Hängt — stale lock" : "Läuft gerade…") : `${s.count.toLocaleString("de-DE")} gecacht · Lauf ${fmtRel(s.lastRun)}`,
            s.key === "ship" ? "ship" : "pin",
          ),
        )}
      </div>

      {/* SYNC CONTROL */}
      <div style={{ ...label, marginBottom: "0.6rem" }}>SYNCS</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: "0.9rem", marginBottom: "1.3rem" }}>
        {syncs.map((s) => {
          const c = STATUS_COLOR[s.status] ?? "var(--dim)";
          const kind = s.key === "ship" ? "ships" : "locations";
          return (
            <section key={s.key} data-testid={`sync-${s.key}`} style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.7rem" }}>
                <span style={{ color: c, display: "inline-flex" }}><Ic name={s.key === "ship" ? "ship" : "pin"} size={16} sw={1.6} /></span>
                <span style={{ fontFamily: MONO, fontSize: "0.74rem", letterSpacing: "0.06em", color: "var(--text-hi)" }}>{s.name}</span>
                <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.62rem", color: c }}>{s.running ? (s.stale ? "⚠ hängt" : "⟳ läuft") : STATUS_TEXT[s.status]}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.45rem 0.8rem", marginBottom: "0.8rem", fontSize: "0.8rem" }}>
                <div><div style={{ fontFamily: MONO, fontSize: "0.56rem", color: "var(--dim3)" }}>GECACHED</div><div style={{ color: "var(--text)" }}>{s.count.toLocaleString("de-DE")}</div></div>
                <div><div style={{ fontFamily: MONO, fontSize: "0.56rem", color: "var(--dim3)" }}>LETZTER LAUF</div><div style={{ color: "var(--text)" }}>{fmtRel(s.lastRun)}</div></div>
                <div style={{ gridColumn: "1 / 3" }}><div style={{ fontFamily: MONO, fontSize: "0.56rem", color: "var(--dim3)" }}>ERGEBNIS</div><div style={{ color: s.lastResult?.includes("ERROR") ? "var(--red)" : "var(--dim)", fontFamily: MONO, fontSize: "0.72rem", wordBreak: "break-word" }}>{s.lastResult ?? "—"}</div></div>
              </div>
              <button type="button" data-testid={`do-sync-${s.key}`} disabled={busy || !csrf || s.running} onClick={() => runSync(kind)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.42rem 0.8rem", fontFamily: MONO, fontSize: "0.7rem", borderRadius: 7, cursor: s.running ? "default" : "pointer", border: `1px solid ${c}66`, background: `${c}14`, color: c, opacity: s.running ? 0.7 : 1 }}>
                <span style={s.running ? { animation: "fpw-spin 0.9s linear infinite", display: "inline-flex" } : { display: "inline-flex" }}><Ic name="refresh" size={13} sw={1.8} /></span>
                {s.running ? "Synchronisiert…" : "Sync jetzt"}
              </button>
            </section>
          );
        })}
      </div>

      {/* EVENT LOG */}
      <section style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem", padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--border)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}><span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="doc" size={16} sw={1.6} /></span><span style={{ fontFamily: MONO, fontSize: "0.74rem", letterSpacing: "0.08em", color: "var(--text-hi)" }}>EREIGNIS-LOG</span><span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "var(--dim3)" }}>{filteredEvents.length}</span></span>
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.45rem" }}>
            <select data-testid="level-filter" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} style={{ background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: MONO, fontSize: "0.7rem", padding: "0.3rem 0.45rem", borderRadius: 6, cursor: "pointer" }}>
              <option value="">Alle Level</option>
              <option value="error">Fehler</option>
              <option value="warn">Warnung</option>
              <option value="info">Info</option>
            </select>
            <select data-testid="cat-filter" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: MONO, fontSize: "0.7rem", padding: "0.3rem 0.45rem", borderRadius: 6, cursor: "pointer" }}>
              <option value="">Alle Kategorien</option>
              <option value="sync.ship">Schiff-Sync</option>
              <option value="sync.location">Standort-Sync</option>
              <option value="http.error">HTTP-Fehler</option>
              <option value="scheduler">Scheduler</option>
            </select>
          </div>
        </div>
        {filteredEvents.length === 0 ? (
          <div style={{ padding: "1.6rem 1.1rem", textAlign: "center", color: "var(--dim3)", fontFamily: MONO, fontSize: "0.78rem" }}>Keine Ereignisse im gewählten Zeitraum.</div>
        ) : (
          <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
            {filteredEvents.map((ev) => {
              const lc = LEVEL_COLOR[ev.level] ?? "var(--dim)";
              const open = expanded === ev.id;
              return (
                <div key={ev.id} data-testid={`event-${ev.id}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <div
                    onClick={() => ev.detail && setExpanded(open ? null : ev.id)}
                    style={{ display: "grid", gridTemplateColumns: "auto 84px 110px 1fr", gap: "0.6rem", alignItems: "center", padding: "0.5rem 1.1rem", cursor: ev.detail ? "pointer" : "default", fontSize: "0.84rem" }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: lc, flexShrink: 0 }} />
                    <span style={{ fontFamily: MONO, fontSize: "0.66rem", color: "var(--dim2)", whiteSpace: "nowrap" }}>{fmtTs(ev.ts)}</span>
                    <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: lc, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{CAT_LABEL[ev.category] ?? ev.category}</span>
                    <span style={{ color: ev.level === "error" ? "var(--red)" : "var(--text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: open ? "normal" : "nowrap" }}>{ev.message}{ev.detail && !open ? <span style={{ color: "var(--dim3)" }}> …</span> : null}</span>
                  </div>
                  {open && ev.detail && (
                    <pre style={{ margin: 0, padding: "0.4rem 1.1rem 0.8rem 2.6rem", color: "var(--dim2)", fontFamily: MONO, fontSize: "0.7rem", whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--bg)" }}>{ev.detail}</pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {toast && (
        <div data-testid="system-notice" role="status" style={{ position: "fixed", left: "50%", bottom: "1.6rem", transform: "translateX(-50%)", zIndex: 9997, display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.65rem 1.1rem", background: "var(--row)", border: "1px solid var(--border-hi)", borderRadius: 10, color: "var(--cyan)", fontFamily: MONO, fontSize: "0.78rem", boxShadow: "0 12px 40px rgba(0,0,0,0.55)" }}>
          <Ic name="check" size={15} sw={1.8} /> {toast}
        </div>
      )}
    </div>
  );
}
