import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { addHangarShip, ApiError, getHangar, importFleet, removeHangarShip, searchShips } from "../api/client";
import type { FleetImportResponse, SessionResponse, ShipSummary } from "../api/types";
import { Ic } from "../components/Icons";

const MONO = "var(--mono)";
const label: React.CSSProperties = { fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.12em", color: "#9fb1c2", marginBottom: "0.7rem" };

export function ProfilePage({ session }: { session: SessionResponse | null }) {
  const [hangar, setHangar] = useState<ShipSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ShipSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fleetJson, setFleetJson] = useState("");
  const [importResult, setImportResult] = useState<FleetImportResponse | null>(null);
  // FR-D2: manually assign an unmatched import name to a catalog ship.
  const [assignName, setAssignName] = useState<string | null>(null);
  const [assignQ, setAssignQ] = useState("");
  const [assignResults, setAssignResults] = useState<ShipSummary[]>([]);

  const csrf = session?.csrfToken ?? null;
  const me = session?.user ?? null;

  function reload() {
    getHangar()
      .then((r) => setHangar(r.ships))
      .catch((e) => setNotice(e instanceof ApiError ? e.message : "Hangar nicht ladbar."));
  }
  useEffect(() => {
    if (me) reload();
  }, [me]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchShips(q).then((r) => setResults(r.ships.slice(0, 10))).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // FR-D2: search for the catalog ship matching an unmatched name (seeded with it).
  useEffect(() => {
    const q = assignQ.trim();
    if (assignName === null || q.length < 2) {
      setAssignResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchShips(q).then((r) => setAssignResults(r.ships.slice(0, 8))).catch(() => setAssignResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [assignQ, assignName]);

  // Assign an unmatched name → add the picked catalog ship, drop the name locally.
  async function assignUnmatched(name: string, shipId: string) {
    if (!csrf) return;
    setBusy(true);
    setNotice(null);
    try {
      await addHangarShip(shipId, csrf);
      setImportResult((r) => (r ? { ...r, unmatched: r.unmatched.filter((n) => n !== name) } : r));
      setAssignName(null);
      setAssignQ("");
      reload();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Zuordnung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<unknown>) {
    if (!csrf) return;
    setBusy(true);
    setNotice(null);
    try {
      await action();
      reload();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!csrf || fleetJson.trim().length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await importFleet(csrf, fleetJson);
      setImportResult(r);
      setFleetJson("");
      reload();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Import fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  if (session === null) return <div className="fpw-state"><span style={label}>LADE…</span></div>;
  if (!me)
    return (
      <div className="fpw-state" data-testid="profile-anon">
        <span style={label}>ANMELDUNG ERFORDERLICH</span>
        <Link className="fpw-btn" to="/login">Anmelden</Link>
      </div>
    );

  const owned = new Set((hangar ?? []).map((s) => s.id));

  return (
    <div data-testid="profile-page" style={{ width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1.2rem" }}>
        <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="users" size={20} /></span>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", color: "#eaf4fb", margin: 0 }}>Profil · {me.username}</h1>
      </div>
      {me.role === "superadmin" && (
        <p className="fpw-meta" style={{ marginBottom: "1rem" }}>
          <Link to="/admin" data-testid="admin-link">Admin · Server-Verwaltung →</Link>
        </p>
      )}
      {notice && <p className="fpw-tag gold" role="alert" data-testid="profile-notice" style={{ display: "inline-flex", marginBottom: "1rem" }}>{notice}</p>}

      <section className="fpw-card" style={{ marginBottom: "1.2rem" }}>
        <div style={label}>MEIN HANGAR</div>
        {hangar === null ? (
          <p className="fpw-meta">Lade Hangar…</p>
        ) : hangar.length === 0 ? (
          <p className="fpw-meta">Noch keine Schiffe — unten im Katalog suchen und hinzufügen.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {hangar.map((s) => (
              <div key={s.id} className="fpw-seat" data-testid={`hangar-row-${s.id}`}>
                <span style={{ flex: 1, minWidth: 0, color: "var(--text-hi)" }}>
                  {s.nickname ? (
                    <>„{s.nickname}" <span className="fpw-meta" style={{ fontSize: "0.8rem" }}>· {s.name}</span></>
                  ) : (
                    s.name
                  )}
                </span>
                <span className="fpw-meta">{s.manufacturer} · {s.maxCrew} Crew</span>
                <button type="button" data-testid={`hangar-remove-${s.id}`} title="Aus Hangar entfernen" disabled={busy} onClick={() => run(() => removeHangarShip(s.id, csrf!))} style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(255,68,68,0.4)", background: "rgba(255,68,68,0.08)", color: "#ff6b6b", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <Ic name="x" size={12} sw={2} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="fpw-card">
        <div style={label}>SCHIFF HINZUFÜGEN</div>
        <input
          type="search"
          data-testid="profile-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Schiffsname suchen…"
          style={{ width: "100%", boxSizing: "border-box", background: "var(--bg3)", border: "1px solid rgba(0,212,255,0.14)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.95rem", padding: "0.55rem 0.7rem", borderRadius: 8, outline: "none" }}
        />
        {results.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.6rem" }}>
            {results.map((s) => (
              <div key={s.id} className="fpw-seat">
                <span style={{ color: "var(--text-hi)" }}>{s.name}</span>
                {owned.has(s.id) ? (
                  <span className="fpw-tag green" style={{ display: "inline-flex" }}>IM HANGAR</span>
                ) : (
                  <button type="button" data-testid={`hangar-add-${s.id}`} disabled={busy} onClick={() => run(() => addHangarShip(s.id, csrf!))} className="fpw-btn" style={{ padding: "0.3rem 0.6rem", fontSize: "0.68rem" }}>
                    <Ic name="plus" size={12} sw={2} /> Hinzufügen
                  </button>
                )}
                <span className="fpw-meta" style={{ flex: 1, textAlign: "right" }}>{s.manufacturer} · {s.maxCrew} Crew</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="fpw-card" style={{ marginTop: "1.2rem" }} data-testid="fleet-import">
        <div style={label}>FLOTTE IMPORTIEREN</div>
        <p className="fpw-meta" style={{ margin: "0 0 0.7rem", fontSize: "0.85rem" }}>
          CCU-Game-Flotten-Export (JSON) einfügen — passende Schiffe landen automatisch im Hangar.
        </p>
        <textarea
          data-testid="fleet-json"
          value={fleetJson}
          onChange={(e) => setFleetJson(e.target.value)}
          placeholder='[{"name":"Polaris", ...}]'
          rows={5}
          style={{ width: "100%", boxSizing: "border-box", background: "var(--bg3)", border: "1px solid rgba(0,212,255,0.14)", color: "var(--text)", fontFamily: "var(--mono)", fontSize: "0.82rem", padding: "0.55rem 0.7rem", borderRadius: 8, outline: "none", resize: "vertical" }}
        />
        <div style={{ marginTop: "0.6rem" }}>
          <button type="button" data-testid="fleet-import-submit" className="fpw-btn" disabled={busy || !csrf || fleetJson.trim().length === 0} onClick={runImport}>
            <Ic name="plus" size={12} sw={2} /> Importieren
          </button>
        </div>
        {importResult && (
          <div data-testid="import-result" style={{ marginTop: "0.8rem" }}>
            <p className="fpw-meta" style={{ margin: 0 }}>
              {importResult.added} neu · {importResult.already} bereits vorhanden
              {importResult.unmatched.length > 0 ? ` · ${importResult.unmatched.length} nicht zugeordnet` : ""}
            </p>
            {importResult.unmatched.length > 0 && (
              <div style={{ marginTop: "0.6rem" }}>
                <div style={{ ...label, fontSize: "0.6rem", marginBottom: "0.45rem" }}>NICHT ERKANNT — MANUELL ZUORDNEN</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  {importResult.unmatched.map((name) => (
                    <div key={name} data-testid={`unmatched-${name}`} style={{ border: "1px solid rgba(240,165,0,0.2)", background: "rgba(240,165,0,0.04)", borderRadius: 8, padding: "0.45rem 0.6rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: "0.86rem", color: "#eaf4fb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                        <button
                          type="button"
                          data-testid={`unmatched-assign-${name}`}
                          className="fpw-btn"
                          style={{ flexShrink: 0, padding: "0.28rem 0.6rem", fontSize: "0.68rem" }}
                          onClick={() => { const open = assignName === name; setAssignName(open ? null : name); setAssignQ(open ? "" : name); }}
                        >
                          {assignName === name ? "Abbrechen" : "Zuordnen"}
                        </button>
                      </div>
                      {assignName === name && (
                        <div style={{ marginTop: "0.5rem" }}>
                          <input
                            type="search"
                            data-testid="unmatched-search"
                            autoFocus
                            value={assignQ}
                            onChange={(e) => setAssignQ(e.target.value)}
                            placeholder="Katalog-Schiff suchen…"
                            style={{ width: "100%", boxSizing: "border-box", background: "#0e1926", border: "1px solid rgba(0,212,255,0.18)", color: "#ccdde8", fontFamily: "var(--body)", fontSize: "0.85rem", padding: "0.4rem 0.55rem", borderRadius: 7, outline: "none" }}
                          />
                          {assignResults.length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", marginTop: "0.4rem" }}>
                              {assignResults.map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  data-testid={`unmatched-pick-${s.id}`}
                                  disabled={busy}
                                  onClick={() => assignUnmatched(name, s.id)}
                                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", textAlign: "left", padding: "0.35rem 0.5rem", border: "1px solid rgba(0,212,255,0.2)", background: "rgba(0,212,255,0.04)", borderRadius: 6, cursor: "pointer", color: "inherit", fontFamily: "inherit" }}
                                >
                                  <span style={{ flex: 1, fontSize: "0.82rem", color: "#eaf4fb" }}>{s.name}</span>
                                  <span style={{ fontFamily: MONO, fontSize: "0.6rem", color: "#7e92a4" }}>{s.manufacturer}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
