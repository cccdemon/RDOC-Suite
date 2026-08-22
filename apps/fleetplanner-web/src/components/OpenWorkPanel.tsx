import { useEffect, useState } from "react";
import { getOperatorView } from "../api/client";
import type { OperationDetail, OperatorView } from "../api/types";
import { Ic } from "./Icons";
import { MONO, card } from "./ui";

// Handoff §7.2 — "Offene Arbeit", the operator's landing place.
//
// The console showed inventory: how full the board is, how many seats exist. It
// never showed what was waiting for a decision, so an operator had to walk the
// tabs to find out whether anything needed them. This counts the things that
// block other people, and each row is a link into the tab that resolves it.
//
// It reads only. Everything here is done somewhere else, on purpose — a second
// place to accept a unit would be a second implementation of accepting a unit.

export type WorkItem = {
  key: string;
  count: number;
  /** Singular / plural, so a row never reduces to a bare number (§12). */
  label: (n: number) => string;
  hint: string;
  tab: string;
  icon: string;
  tone: string;
};

/** Pure so the counting can be tested without a DOM or a server. */
export function openWork(op: OperationDetail, view: OperatorView | null): WorkItem[] {
  const pendingUnits = op.units.filter((u) => u.status === "pending").length;
  const openQuestions = op.questions.filter((q) => !q.answer).length;
  // A seat on an accepted unit that nobody sits in is a hole in the roster.
  const emptySeats = op.units
    .filter((u) => u.status === "accepted")
    .flatMap((u) => u.seats)
    .filter((s) => s.active && !s.claimedBy).length;
  const flexible = view?.crewRequests.length ?? 0;
  // Someone who pressed "Interested" in Discord but holds no seat here.
  const interested = (view?.eventInterests ?? []).filter((i) => !i.seated).length;
  // ... and of those, the ones with no account to assign at all.
  const unlinked = (view?.eventInterests ?? []).filter((i) => !i.seated && i.userId === null).length;

  const all: WorkItem[] = [
    {
      key: "pending-units",
      count: pendingUnits,
      label: (n) => (n === 1 ? "1 Einheit wartet auf Entscheidung" : `${n} Einheiten warten auf Entscheidung`),
      hint: "Annehmen oder ablehnen — bis dahin weiß der Kapitän nicht, ob er dabei ist.",
      tab: "fleet",
      icon: "ship",
      tone: "var(--gold)",
    },
    {
      key: "flexible",
      count: flexible,
      label: (n) => (n === 1 ? "1 flexible Anmeldung" : `${n} flexible Anmeldungen`),
      hint: "Leute ohne eigenes Schiff, die auf einen Sitz warten.",
      tab: "fleet",
      icon: "users",
      tone: "var(--cyan)",
    },
    {
      key: "empty-seats",
      count: emptySeats,
      label: (n) => (n === 1 ? "1 freier Sitz" : `${n} freie Sitze`),
      hint: "Auf angenommenen Einheiten — besetzbar aus der Warteliste.",
      tab: "fleet",
      icon: "board",
      tone: "var(--cyan)",
    },
    {
      key: "interested",
      count: interested,
      label: (n) => (n === 1 ? "1 Discord-Interessent ohne Platz" : `${n} Discord-Interessenten ohne Platz`),
      hint: "Hat in Discord auf „Interessiert“ geklickt, sitzt hier aber nirgends.",
      tab: "fleet",
      icon: "chat",
      tone: "var(--purple)",
    },
    {
      key: "unlinked",
      count: unlinked,
      label: (n) => (n === 1 ? "1 davon ohne Fleetplanner-Konto" : `${n} davon ohne Fleetplanner-Konto`),
      hint: "Nicht zuweisbar, solange sie sich nicht anmelden.",
      tab: "fleet",
      icon: "alert",
      tone: "var(--dim)",
    },
    {
      key: "questions",
      count: openQuestions,
      label: (n) => (n === 1 ? "1 offene Frage" : `${n} offene Fragen`),
      hint: "Jemand wartet auf eine Antwort.",
      tab: "qa",
      icon: "chat",
      tone: "var(--gold)",
    },
  ];
  return all.filter((w) => w.count > 0);
}

export function OpenWorkPanel({ op, opId, onOpenTab }: { op: OperationDetail; opId: string; onOpenTab: (tab: string) => void }) {
  const [view, setView] = useState<OperatorView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getOperatorView(opId)
      .then((v) => live && setView(v))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [opId]);

  const items = openWork(op, view);

  return (
    <section style={card} data-testid="open-work">
      <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.9rem" }}>
        <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="alert" size={16} sw={1.7} /></span>
        <span style={{ fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.1em", color: "var(--text-hi)" }}>OFFENE ARBEIT</span>
      </div>

      {failed && (
        <p role="alert" data-testid="open-work-error" style={{ margin: "0 0 0.8rem", color: "var(--gold)", fontSize: "0.84rem" }}>
          Die Operator-Daten sind gerade nicht erreichbar — die Liste kann unvollständig sein.
        </p>
      )}

      {items.length === 0 ? (
        <p data-testid="open-work-empty" style={{ margin: 0, color: "var(--dim)", fontSize: "0.88rem", lineHeight: 1.55 }}>
          {view === null && !failed
            ? "Prüfe offene Vorgänge…"
            : "Nichts wartet auf dich. Keine offenen Einheiten, keine unbeantworteten Fragen, keine freien Sitze."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
          {items.map((w) => (
            <button
              key={w.key}
              type="button"
              data-testid={`open-work-${w.key}`}
              onClick={() => onOpenTab(w.tab)}
              style={{ display: "flex", alignItems: "center", gap: "0.7rem", textAlign: "left", padding: "0.6rem 0.7rem", borderRadius: 10, cursor: "pointer", border: "1px solid var(--border)", background: "var(--wash)", color: "var(--text)" }}
            >
              <span style={{ color: w.tone, display: "inline-flex", flexShrink: 0 }}><Ic name={w.icon} size={16} sw={1.7} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "0.9rem", color: "var(--text-hi)" }}>{w.label(w.count)}</span>
                <span style={{ display: "block", fontSize: "0.78rem", color: "var(--dim)", marginTop: 2 }}>{w.hint}</span>
              </span>
              <span style={{ color: "var(--dim2)", display: "inline-flex", flexShrink: 0 }}><Ic name="arrow" size={15} sw={1.7} /></span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
