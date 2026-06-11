import { useEffect, useState } from "react";
import { ApiError, getHangar, registerUnit, searchShips } from "../api/client";
import type { ShipSummary } from "../api/types";

type Mode = "ship" | "squad" | "vehicle";

/** "Eigenes Schiff / Squad / Fahrzeug anbieten" — mode segments over the
 *  single POST /units mutation. Vehicle offers need a carrier ship unit. */
export function OfferShip({
  opId,
  csrf,
  carrierOptions,
  onDone,
  onCancel,
  onError,
}: {
  opId: string;
  csrf: string;
  /** Accepted ship units of the op (vehicle carriers). */
  carrierOptions: Array<{ id: string; name: string }>;
  onDone: () => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const open = true; // controlled by the parent (the Mitmachen entry card)
  const [mode, setMode] = useState<Mode>("ship");
  const [hangar, setHangar] = useState<ShipSummary[] | null>(null);
  const [results, setResults] = useState<ShipSummary[]>([]);
  const [query, setQuery] = useState("");
  const [ownedShipId, setOwnedShipId] = useState<string | null>(null);
  const [catalogShipId, setCatalogShipId] = useState<string | null>(null);
  const [store, setStore] = useState(true);
  const [squadName, setSquadName] = useState("");
  const [squadSize, setSquadSize] = useState(4);
  const [carrierUnitId, setCarrierUnitId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || mode !== "ship" || hangar !== null) return;
    getHangar()
      .then((r) => setHangar(r.ships))
      .catch(() => setHangar([]));
  }, [open, mode, hangar]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchShips(q)
        .then((r) => {
          const ships = mode === "vehicle"
            ? r.ships.filter((s) => s.size.toLowerCase() === "vehicle")
            : r.ships;
          setResults(ships.slice(0, 8));
        })
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, mode]);

  function reset() {
    setOwnedShipId(null);
    setCatalogShipId(null);
    setQuery("");
    setResults([]);
    setSquadName("");
    setNote("");
    setCarrierUnitId("");
  }

  async function submit() {
    setBusy(true);
    try {
      if (mode === "ship") {
        const picked = ownedShipId ?? catalogShipId;
        if (!picked) {
          onError("Bitte ein Schiff wählen.");
          return;
        }
        await registerUnit(opId, csrf, {
          unitType: "ship",
          ...(ownedShipId ? { ownedShipId } : { shipId: catalogShipId!, storeOwnedShip: store }),
          ...(note.trim() ? { captainNote: note.trim() } : {}),
        });
      } else if (mode === "squad") {
        if (!squadName.trim()) {
          onError("Bitte einen Squad-Namen angeben.");
          return;
        }
        await registerUnit(opId, csrf, {
          unitType: "squad",
          squadName: squadName.trim(),
          squadSize,
          ...(note.trim() ? { captainNote: note.trim() } : {}),
        });
      } else {
        if (!catalogShipId) {
          onError("Bitte ein Fahrzeug wählen.");
          return;
        }
        if (!carrierUnitId) {
          onError("Ein Fahrzeug braucht ein Trägerschiff.");
          return;
        }
        await registerUnit(opId, csrf, {
          unitType: "vehicle",
          shipId: catalogShipId,
          carrierUnitId,
          ...(note.trim() ? { captainNote: note.trim() } : {}),
        });
      }
      reset();
      onDone();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Anbieten fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  void open;

  const seg = (m: Mode, label: string) => (
    <button
      type="button"
      data-testid={`offer-mode-${m}`}
      onClick={() => {
        setMode(m);
        reset();
      }}
      className="fpw-btn"
      style={
        mode === m
          ? { background: "var(--cyan)", color: "#04060a", borderColor: "var(--cyan)" }
          : { background: "transparent", color: "var(--dim)", borderColor: "rgba(255,255,255,.18)" }
      }
    >
      {label}
    </button>
  );

  const shipPicker = (
    <>
      {mode === "ship" && (
        <>
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
        </>
      )}
      <div className="fpw-mono-label" style={{ margin: "0.6rem 0" }}>
        {mode === "vehicle" ? "FAHRZEUG IM KATALOG SUCHEN" : "ODER IM KATALOG SUCHEN"}
      </div>
      <input
        type="search"
        value={query}
        data-testid="ship-search"
        onChange={(e) => setQuery(e.target.value)}
        placeholder={mode === "vehicle" ? "Fahrzeugname…" : "Schiffsname…"}
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
          {mode === "ship" && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input type="checkbox" checked={store} onChange={(e) => setStore(e.target.checked)} style={{ accentColor: "var(--cyan)" }} />
              <span className="fpw-meta">In meinen Hangar übernehmen</span>
            </label>
          )}
        </div>
      )}
    </>
  );

  return (
    <div data-testid="offer-ship-form" style={{ width: "100%", borderTop: "1px solid rgba(0,212,255,.12)", paddingTop: "0.9rem", marginTop: "0.4rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.9rem", flexWrap: "wrap" }}>
        {seg("ship", "Schiff")}
        {seg("squad", "Squad")}
        {seg("vehicle", "Fahrzeug")}
      </div>

      {mode !== "squad" && shipPicker}

      {mode === "squad" && (
        <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="text"
            value={squadName}
            data-testid="squad-name"
            onChange={(e) => setSquadName(e.target.value)}
            maxLength={80}
            placeholder="Squad-Name…"
            style={{ flex: "1 1 200px", background: "var(--bg3)", border: "1px solid rgba(0,212,255,.14)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.95rem", padding: "0.55rem 0.7rem", borderRadius: 8, outline: "none" }}
          />
          <label className="fpw-meta" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
            Größe
            <select
              value={squadSize}
              data-testid="squad-size"
              onChange={(e) => setSquadSize(Number(e.target.value))}
              style={{ background: "var(--bg3)", border: "1px solid rgba(0,212,255,.14)", color: "var(--text)", padding: "0.45rem", borderRadius: 8 }}
            >
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {mode === "vehicle" && (
        <div style={{ marginTop: "0.8rem" }}>
          <div className="fpw-mono-label" style={{ marginBottom: "0.5rem" }}>TRÄGERSCHIFF (PFLICHT)</div>
          {carrierOptions.length === 0 ? (
            <p className="fpw-meta">Keine angenommenen Schiffe — ein Fahrzeug braucht ein Trägerschiff.</p>
          ) : (
            <select
              value={carrierUnitId}
              data-testid="carrier-select"
              onChange={(e) => setCarrierUnitId(e.target.value)}
              style={{ width: "100%", background: "var(--bg3)", border: "1px solid rgba(0,212,255,.14)", color: "var(--text)", padding: "0.55rem", borderRadius: 8 }}
            >
              <option value="">— Trägerschiff wählen —</option>
              {carrierOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
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
          Anbieten
        </button>
        <button
          type="button"
          className="fpw-btn"
          style={{ borderColor: "rgba(255,255,255,.18)", background: "transparent", color: "var(--dim)" }}
          onClick={onCancel}
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}
