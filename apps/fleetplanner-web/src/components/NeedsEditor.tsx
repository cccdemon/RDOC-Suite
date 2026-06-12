import { useEffect, useState } from "react";
import { ApiError, addShipNeeds, getNeeds, removeNeed, setCqbTeams, setFighterSquads } from "../api/client";
import type { NeedsResponse } from "../api/types";
import { Ic } from "./Icons";

const MONO = "var(--mono)";
const label: React.CSSProperties = { fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.12em", color: "#9fb1c2", marginBottom: "0.7rem" };
const field: React.CSSProperties = {
  boxSizing: "border-box", background: "var(--bg3)", border: "1px solid rgba(0,212,255,0.14)",
  color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.95rem", padding: "0.5rem 0.6rem", borderRadius: 8, outline: "none",
};

export function NeedsEditor({ opId, csrf }: { opId: string; csrf: string | null }) {
  const [needs, setNeeds] = useState<NeedsResponse | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [needName, setNeedName] = useState("");
  const [fighters, setFighters] = useState(0);
  const [cqbCount, setCqbCount] = useState(0);
  const [cqbSize, setCqbSize] = useState(4);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    getNeeds(opId)
      .then((n) => {
        setNeeds(n);
        setFighters(n.fighterSquads);
        setCqbCount(n.cqbTeams.count);
        setCqbSize(n.cqbTeams.size);
      })
      .catch((e) => setNotice(e instanceof ApiError ? e.message : "Bedarfe nicht ladbar."));
  }
  useEffect(reload, [opId]);

  async function run(action: () => Promise<unknown>, after?: () => void) {
    if (!csrf) return;
    setBusy(true);
    setNotice(null);
    try {
      await action();
      after?.();
      reload();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  if (needs === null)
    return (
      <section className="fpw-card" data-testid="needs-editor" style={{ marginBottom: "1.2rem" }}>
        <div style={label}>BEDARFE</div>
        <p className="fpw-meta">Lade Bedarfe…</p>
      </section>
    );

  const togglePick = (slug: string) =>
    setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : [...p, slug]));

  return (
    <section className="fpw-card" data-testid="needs-editor" style={{ marginBottom: "1.2rem" }}>
      <div style={label}>BEDARFE</div>
      {notice && <p className="fpw-tag gold" role="alert" data-testid="needs-notice" style={{ display: "inline-flex", marginBottom: "0.8rem" }}>{notice}</p>}

      {/* Ship needs */}
      <div style={{ ...label, fontSize: "0.6rem", marginBottom: "0.5rem" }}>SCHIFFE</div>
      {needs.shipNeeds.length === 0 ? (
        <p className="fpw-meta" style={{ margin: "0 0 0.7rem" }}>Keine Schiffsbedarfe.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.8rem" }}>
          {needs.shipNeeds.map((s) => (
            <div key={s.id} className="fpw-seat" data-testid={`need-row-${s.id}`}>
              <span style={{ flex: 1, color: "var(--text-hi)" }}>{s.label}</span>
              <span className="fpw-meta">{s.shipType}</span>
              <button type="button" data-testid={`need-remove-${s.id}`} title="Bedarf entfernen" disabled={busy || !csrf} onClick={() => run(() => removeNeed(opId, s.id, csrf!))} style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(255,68,68,0.4)", background: "rgba(255,68,68,0.08)", color: "#ff6b6b", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Ic name="x" size={12} sw={2} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.5rem" }}>
        {needs.shipTypes.map((t) => (
          <button
            key={t.slug}
            type="button"
            data-testid={`shiptype-${t.slug}`}
            onClick={() => togglePick(t.slug)}
            style={{
              padding: "0.32rem 0.6rem", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: "0.68rem",
              border: picked.includes(t.slug) ? "1px solid rgba(0,212,255,0.55)" : "1px solid rgba(0,212,255,0.2)",
              background: picked.includes(t.slug) ? "rgba(0,212,255,0.14)" : "rgba(0,212,255,0.04)",
              color: picked.includes(t.slug) ? "#00d4ff" : "#9fb1c2",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.2rem" }}>
        <input data-testid="need-name" type="text" maxLength={80} value={needName} placeholder="Optionaler Name (z. B. Tank)" onChange={(e) => setNeedName(e.target.value)} style={{ ...field, flex: "1 1 200px" }} />
        <button type="button" data-testid="need-add" className="fpw-btn" disabled={busy || !csrf || picked.length === 0} onClick={() => run(() => addShipNeeds(opId, csrf!, { shipTypes: picked, name: needName.trim() || undefined }), () => { setPicked([]); setNeedName(""); })}>
          <Ic name="plus" size={12} sw={2} /> Bedarf hinzufügen
        </button>
      </div>

      {/* Fighter squads */}
      <div style={{ ...label, fontSize: "0.6rem", marginBottom: "0.5rem" }}>JÄGER-STAFFELN (je {needs.fighterSquadSize} Piloten)</div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1.2rem" }}>
        <input data-testid="fighters-count" type="number" min={0} max={50} value={fighters} onChange={(e) => setFighters(Number(e.target.value))} style={{ ...field, width: 90 }} />
        <button type="button" data-testid="fighters-save" className="fpw-btn" disabled={busy || !csrf || fighters === needs.fighterSquads} onClick={() => run(() => setFighterSquads(opId, csrf!, fighters))}>Speichern</button>
      </div>

      {/* CQB teams */}
      <div style={{ ...label, fontSize: "0.6rem", marginBottom: "0.5rem" }}>CQB-TEAMS (Größe 1–{needs.cqbTeamMax})</div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "#9fb1c2", fontSize: "0.82rem" }}>
          Anzahl
          <input data-testid="cqb-count" type="number" min={0} max={50} value={cqbCount} onChange={(e) => setCqbCount(Number(e.target.value))} style={{ ...field, width: 80 }} />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "#9fb1c2", fontSize: "0.82rem" }}>
          Größe
          <input data-testid="cqb-size" type="number" min={1} max={needs.cqbTeamMax} value={cqbSize} onChange={(e) => setCqbSize(Number(e.target.value))} style={{ ...field, width: 80 }} />
        </label>
        <button type="button" data-testid="cqb-save" className="fpw-btn" disabled={busy || !csrf || (cqbCount === needs.cqbTeams.count && cqbSize === needs.cqbTeams.size)} onClick={() => run(() => setCqbTeams(opId, csrf!, cqbCount, cqbSize))}>Speichern</button>
      </div>
    </section>
  );
}
