import { useEffect, useState } from "react";
import { addHangarShip, getHangar, searchShips } from "../api/client";
import type { SessionResponse, ShipSummary } from "../api/types";
import { Ic } from "../components/Icons";
import { useSeo } from "../seo";
import { useT } from "../i18n";

const MONO = "var(--mono)";

export function ShipsPage({ session }: { session: SessionResponse | null }) {
  const tr = useT();
  useSeo({
    title: "Star-Citizen-Schiffe — Datenbank",
    description:
      "Star-Citizen-Schiffsdatenbank im RDOC Fleetplanner: Crew, Rolle und Größe aller Schiffe für die Flottenplanung.",
  });
  const [query, setQuery] = useState("");
  const [ships, setShips] = useState<ShipSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<string | null>(null);
  // Hangar quick-add: only for logged-in users; track owned ids + in-flight add.
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [addingId, setAddingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const csrf = session?.csrfToken ?? null;
  const canAdd = !!session?.user;
  const COLS = canAdd ? "44px 2fr 1.2fr 1fr 1fr 0.8fr 108px" : "44px 2fr 1.2fr 1fr 1fr 0.8fr";

  useEffect(() => {
    if (!canAdd) return;
    getHangar().then((r) => setOwned(new Set(r.ships.map((s) => s.id)))).catch(() => {});
  }, [canAdd]);

  async function addToHangar(shipId: string) {
    if (!csrf) return;
    setAddingId(shipId);
    setNotice(null);
    try {
      await addHangarShip(shipId, csrf);
      setOwned((prev) => new Set(prev).add(shipId));
    } catch {
      setNotice(tr("ships.addFailed"));
    } finally {
      setAddingId(null);
    }
  }

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
        <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="ship" size={20} /></span>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", color: "var(--text-hi)", margin: 0 }}>{tr("ships.title")}</h1>
      </div>
      <div style={{ color: "var(--dim)", fontSize: "0.9rem", marginBottom: "1.2rem" }}>{tr("ships.source")}</div>

      {notice && <p className="fpw-tag gold" role="alert" style={{ display: "inline-flex", marginBottom: "1rem" }}>{notice}</p>}

      <input
        type="search"
        data-testid="ships-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tr("ships.searchPlaceholder")}
        style={{ width: "100%", boxSizing: "border-box", background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.98rem", padding: "0.6rem 0.8rem", borderRadius: 8, outline: "none", marginBottom: "1rem" }}
      />

      {loading && ships.length === 0 ? (
        <p className="fpw-meta">{tr("common.loading")}</p>
      ) : ships.length === 0 ? (
        <p className="fpw-meta">{tr("ships.noHits")}</p>
      ) : (
        <div className="fpw-card fpw-table" data-card="work" data-testid="ships-table">
          <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 0, fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.08em", color: "var(--dim3)", padding: "0.7rem 1rem", borderBottom: "1px solid var(--border)" }}>
            <span /><span>{tr("ships.col.name")}</span><span>{tr("ships.col.manufacturer")}</span><span>{tr("ships.col.size")}</span><span>{tr("ships.col.role")}</span><span style={{ textAlign: "right" }}>{tr("ships.col.crew")}</span>{canAdd && <span />}
          </div>
          {ships.map((s) => (
            <div
              key={s.id}
              data-testid={`ship-${s.id}`}
              onClick={s.imageUrl ? () => setLightbox(s.imageUrl ?? null) : undefined}
              title={s.imageUrl ? tr("ships.zoomTitle") : undefined}
              style={{ display: "grid", gridTemplateColumns: COLS, gap: 0, padding: "0.6rem 1rem", borderBottom: "1px solid var(--wash)", alignItems: "center", fontSize: "0.9rem", cursor: s.imageUrl ? "zoom-in" : "default" }}
            >
              <span style={{ display: "inline-flex", alignItems: "center" }}>
                {s.imageUrl ? (
                  <img
                    src={s.imageUrl}
                    alt=""
                    loading="lazy"
                    onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = "none"; }}
                    style={{ width: 36, height: 24, objectFit: "cover", borderRadius: 4, border: "1px solid var(--border)", flex: "none" }}
                  />
                ) : (
                  <span style={{ color: "#3a4754", display: "inline-flex" }}><Ic name="ship" size={16} /></span>
                )}
              </span>
              <span style={{ color: "var(--text-hi)", fontWeight: 600 }}>{s.name}</span>
              <span className="fpw-meta">{s.manufacturer || "—"}</span>
              <span className="fpw-meta">{s.size || "—"}</span>
              <span className="fpw-meta">{s.role || "—"}</span>
              <span style={{ fontFamily: MONO, fontSize: "0.82rem", color: "var(--dim)", textAlign: "right" }}>{s.minCrew}–{s.maxCrew}</span>
              {canAdd && (
                <span style={{ display: "inline-flex", justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
                  {owned.has(s.id) ? (
                    <span className="fpw-tag green" style={{ display: "inline-flex", whiteSpace: "nowrap" }}>{tr("ships.inHangar")}</span>
                  ) : (
                    <button type="button" data-testid={`ship-add-${s.id}`} disabled={addingId === s.id} onClick={() => addToHangar(s.id)} className="fpw-btn" style={{ padding: "0.25rem 0.5rem", fontSize: "0.66rem", whiteSpace: "nowrap" }}>
                      <Ic name="plus" size={12} sw={2} /> {tr("ships.addToHangar")}
                    </button>
                  )}
                </span>
              )}
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
          <img src={lightbox} alt="" style={{ maxWidth: "92vw", maxHeight: "92vh", objectFit: "contain", borderRadius: 8, border: "1px solid var(--border)" }} />
        </div>
      )}
    </div>
  );
}
