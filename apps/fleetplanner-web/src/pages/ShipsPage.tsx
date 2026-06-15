import { useEffect, useState } from "react";
import { searchShips } from "../api/client";
import type { ShipSummary } from "../api/types";
import { Ic } from "../components/Icons";

const MONO = "var(--mono)";

export function ShipsPage() {
  const [query, setQuery] = useState("");
  const [ships, setShips] = useState<ShipSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const COLS = "44px 2fr 1.2fr 1fr 1fr 0.8fr";

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      searchShips(query.trim())
        .then((r) => setShips(r.ships))
        .catch(() => setShips([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div data-testid="ships-page" style={{ width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.3rem" }}>
        <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="ship" size={20} /></span>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", color: "#eaf4fb", margin: 0 }}>Schiffsdatenbank</h1>
      </div>
      <div style={{ color: "#9fb1c2", fontSize: "0.9rem", marginBottom: "1.2rem" }}>Quelle: star-citizen.wiki</div>

      <input
        type="search"
        data-testid="ships-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Schiffsname suchen…"
        style={{ width: "100%", boxSizing: "border-box", background: "var(--bg3)", border: "1px solid rgba(0,212,255,0.14)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.98rem", padding: "0.6rem 0.8rem", borderRadius: 8, outline: "none", marginBottom: "1rem" }}
      />

      {loading && ships.length === 0 ? (
        <p className="fpw-meta">Lade…</p>
      ) : ships.length === 0 ? (
        <p className="fpw-meta">Keine Treffer.</p>
      ) : (
        <div className="fpw-card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 0, fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.08em", color: "#5b6b7a", padding: "0.7rem 1rem", borderBottom: "1px solid rgba(0,212,255,0.12)" }}>
            <span /><span>NAME</span><span>HERSTELLER</span><span>GRÖSSE</span><span>ROLLE</span><span style={{ textAlign: "right" }}>CREW</span>
          </div>
          {ships.map((s) => (
            <div
              key={s.id}
              data-testid={`ship-${s.id}`}
              onClick={s.imageUrl ? () => setLightbox(s.imageUrl ?? null) : undefined}
              title={s.imageUrl ? "Bild vergrößern" : undefined}
              style={{ display: "grid", gridTemplateColumns: COLS, gap: 0, padding: "0.6rem 1rem", borderBottom: "1px solid rgba(255,255,255,0.04)", alignItems: "center", fontSize: "0.9rem", cursor: s.imageUrl ? "zoom-in" : "default" }}
            >
              <span style={{ display: "inline-flex", alignItems: "center" }}>
                {s.imageUrl ? (
                  <img
                    src={s.imageUrl}
                    alt=""
                    loading="lazy"
                    onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = "none"; }}
                    style={{ width: 36, height: 24, objectFit: "cover", borderRadius: 4, border: "1px solid rgba(0,212,255,0.18)", flex: "none" }}
                  />
                ) : (
                  <span style={{ color: "#3a4754", display: "inline-flex" }}><Ic name="ship" size={16} /></span>
                )}
              </span>
              <span style={{ color: "var(--text-hi)", fontWeight: 600 }}>{s.name}</span>
              <span className="fpw-meta">{s.manufacturer || "—"}</span>
              <span className="fpw-meta">{s.size || "—"}</span>
              <span className="fpw-meta">{s.role || "—"}</span>
              <span style={{ fontFamily: MONO, fontSize: "0.82rem", color: "#9fb1c2", textAlign: "right" }}>{s.minCrew}–{s.maxCrew}</span>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div
          data-testid="ship-lightbox"
          onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "zoom-out" }}
        >
          <img src={lightbox} alt="" style={{ maxWidth: "92vw", maxHeight: "92vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 0 40px rgba(0,0,0,0.6)" }} />
        </div>
      )}
    </div>
  );
}
