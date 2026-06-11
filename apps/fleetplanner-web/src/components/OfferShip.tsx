import { useEffect, useState } from "react";
import { ApiError, getHangar, registerShipUnit, searchShips } from "../api/client";
import type { ShipSummary } from "../api/types";

/** "Eigenes Schiff anbieten" — hangar pick or catalog search, note, submit.
 *  Ship units only; squads/vehicles keep using the SSR flow for now. */
export function OfferShip({
  opId,
  csrf,
  onDone,
  onError,
}: {
  opId: string;
  csrf: string;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hangar, setHangar] = useState<ShipSummary[] | null>(null);
  const [results, setResults] = useState<ShipSummary[]>([]);
  const [query, setQuery] = useState("");
  const [ownedShipId, setOwnedShipId] = useState<string | null>(null);
  const [catalogShipId, setCatalogShipId] = useState<string | null>(null);
  const [store, setStore] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || hangar !== null) return;
    getHangar()
      .then((r) => setHangar(r.ships))
      .catch(() => setHangar([]));
  }, [open, hangar]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchShips(q)
        .then((r) => setResults(r.ships.slice(0, 8)))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function submit() {
    const shipPicked = ownedShipId ?? catalogShipId;
    if (!shipPicked) {
      onError("Bitte ein Schiff wählen.");
      return;
    }
    setBusy(true);
    try {
      await registerShipUnit(opId, csrf, {
        ...(ownedShipId ? { ownedShipId } : { shipId: catalogShipId!, storeOwnedShip: store }),
        ...(note.trim() ? { captainNote: note.trim() } : {}),
      });
      setOpen(false);
      setOwnedShipId(null);
      setCatalogShipId(null);
      setNote("");
      onDone();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Anbieten fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="fpw-btn" data-testid="offer-ship-open" onClick={() => setOpen(true)}>
        Eigenes Schiff anbieten
      </button>
    );
  }

  return (
    <div data-testid="offer-ship-form" style={{ width: "100%", borderTop: "1px solid rgba(0,212,255,.12)", paddingTop: "0.9rem", marginTop: "0.4rem" }}>
      <div className="fpw-mono-label" style={{ marginBottom: "0.6rem" }}>AUS DEINEM HANGAR</div>
      {hangar === null ? (
        <p className="fpw-meta">Lade Hangar…</p>
      ) : hangar.length === 0 ? (
        <p className="fpw-meta">Hangar leer — unten im Katalog suchen.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.8rem" }}>
          {hangar.map((s) => (
            <label key={s.id} className="fpw-seat" style={{ cursor: "pointer" }}>
              <input
                type="radio"
                name="ownedShip"
                checked={ownedShipId === s.id}
                onChange={() => {
                  setOwnedShipId(s.id);
                  setCatalogShipId(null);
                }}
                style={{ accentColor: "var(--cyan)" }}
              />
              <span style={{ flex: 1, color: "var(--text-hi)" }}>{s.name}</span>
              <span className="fpw-meta">{s.manufacturer} · {s.maxCrew} Crew</span>
            </label>
          ))}
        </div>
      )}

      <div className="fpw-mono-label" style={{ margin: "0.6rem 0" }}>ODER IM KATALOG SUCHEN</div>
      <input
        type="search"
        value={query}
        data-testid="ship-search"
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Schiffsname…"
        style={{ width: "100%", boxSizing: "border-box", background: "var(--bg3)", border: "1px solid rgba(0,212,255,.14)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.95rem", padding: "0.55rem 0.7rem", borderRadius: 8, outline: "none" }}
      />
      {results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.5rem" }}>
          {results.map((s) => (
            <label key={s.id} className="fpw-seat" style={{ cursor: "pointer" }}>
              <input
                type="radio"
                name="catalogShip"
                checked={catalogShipId === s.id}
                onChange={() => {
                  setCatalogShipId(s.id);
                  setOwnedShipId(null);
                }}
                style={{ accentColor: "var(--cyan)" }}
              />
              <span style={{ flex: 1, color: "var(--text-hi)" }}>{s.name}</span>
              <span className="fpw-meta">{s.manufacturer} · {s.maxCrew} Crew</span>
            </label>
          ))}
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
            <input type="checkbox" checked={store} onChange={(e) => setStore(e.target.checked)} style={{ accentColor: "var(--cyan)" }} />
            <span className="fpw-meta">In meinen Hangar übernehmen</span>
          </label>
        </div>
      )}

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={280}
        placeholder="Notiz an den Operator (optional)…"
        style={{ width: "100%", boxSizing: "border-box", minHeight: 56, marginTop: "0.8rem", background: "var(--bg3)", border: "1px solid rgba(0,212,255,.14)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.92rem", padding: "0.55rem 0.7rem", borderRadius: 8, outline: "none", resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.8rem" }}>
        <button type="button" className="fpw-btn" data-testid="offer-ship-submit" disabled={busy} onClick={submit}>
          Schiff anbieten
        </button>
        <button
          type="button"
          className="fpw-btn"
          style={{ borderColor: "rgba(255,255,255,.18)", background: "transparent", color: "var(--dim)" }}
          onClick={() => setOpen(false)}
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}
