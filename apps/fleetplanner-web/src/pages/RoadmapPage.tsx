import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getRoadmap } from "../api/client";
import type { RoadmapItem } from "../api/types";
import { Ic } from "../components/Icons";

const GROUPS: Array<{ key: RoadmapItem["status"]; label: string; cls: "gold" | "dim" | "cyan" | "green" }> = [
  { key: "planned", label: "Geplant", cls: "gold" },
  { key: "blocked", label: "Blockiert", cls: "dim" },
  { key: "rejected", label: "Abgelehnt", cls: "cyan" },
  { key: "done", label: "Erledigt", cls: "green" },
];

export function RoadmapPage() {
  const [items, setItems] = useState<RoadmapItem[] | null>(null);

  useEffect(() => {
    getRoadmap().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);

  return (
    <div data-testid="roadmap-page" style={{ maxWidth: 860, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.3rem" }}>
        <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="board" size={20} /></span>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", color: "#eaf4fb", margin: 0 }}>Roadmap</h1>
      </div>
      <p className="fpw-meta" style={{ marginBottom: "1.5rem" }}>
        Was kommt, was hängt, was verworfen wurde. Wünsche?{" "}
        <Link to="/feedback">Feedback</Link>.
      </p>

      {items === null ? (
        <p className="fpw-meta">Lade…</p>
      ) : (
        GROUPS.map((g) => {
          const list = items.filter((i) => i.status === g.key);
          if (list.length === 0) return null;
          return (
            <section key={g.key} style={{ marginBottom: "1.8rem" }}>
              <div className="fpw-mono-label" style={{ marginBottom: "0.8rem" }}>
                {g.label.toUpperCase()} ({list.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                {list.map((r, i) => (
                  <div key={i} className="fpw-card" data-testid={`roadmap-${g.key}-${i}`}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
                      <span style={{ flex: 1, fontWeight: 700, fontSize: "1.05rem", color: "#eaf4fb" }}>{r.title}</span>
                      <span className={`fpw-tag ${g.cls}`}>{g.label}</span>
                    </div>
                    <p style={{ margin: 0, color: "#c2d2de", fontSize: "0.95rem", lineHeight: 1.5 }}>{r.desc}</p>
                    {r.note && <p className="fpw-meta" style={{ margin: "0.4rem 0 0", fontSize: "0.84rem" }}>{r.note}</p>}
                    {r.reason && (
                      <div style={{ margin: "0.5rem 0 0", borderLeft: "2px solid var(--red)", paddingLeft: "0.8rem" }}>
                        {r.reason.split("\n\n").map((p, j) => (
                          <p key={j} className="fpw-meta" style={{ margin: j === 0 ? 0 : "0.4rem 0 0", fontSize: "0.86rem" }}>{p}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
