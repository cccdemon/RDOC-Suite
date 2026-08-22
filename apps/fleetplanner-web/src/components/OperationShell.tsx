import type { ReactNode } from "react";
import type { OperationDetail } from "../api/types";
import type { OperationMode } from "../operationMode";
import { Breadcrumbs } from "./Breadcrumbs";
import { Ic } from "./Icons";
import { MONO } from "./ui";
import { statusMeta } from "./opStatus";

// Handoff §6.1 — the permanent object header.
//
// Both modes of an operation hang under this: the participant view and the
// management workspace. The header is what makes the second one navigable —
// without it a manager who switched to "Verwalten" would have no title, no
// date and no status on screen, and no obvious way back to what a participant
// sees. It is also the page's only h1, per §12.

function metaItem(icon: string, text: ReactNode, key: string) {
  return (
    <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--dim)", fontSize: "0.88rem" }}>
      <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name={icon} size={14} sw={1.6} /></span>
      {text}
    </span>
  );
}

/** A count that says what it counts — §12 forbids the bare number. */
function kpi(value: string, testid: string, tone = "var(--dim)") {
  return (
    <span
      data-testid={testid}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: "0.68rem", letterSpacing: "0.04em", color: tone, border: "1px solid var(--border)", background: "var(--wash)", borderRadius: 8, padding: "0.25rem 0.6rem" }}
    >
      {value}
    </span>
  );
}

export function OperationShell({
  op,
  mode,
  onMode,
  dateLabel,
  children,
}: {
  op: OperationDetail;
  mode: OperationMode;
  /** Absent for a viewer who cannot manage — then no switch is rendered at all. */
  onMode?: (next: OperationMode) => void;
  /** Already formatted in the operation's timezone by the caller. */
  dateLabel: string;
  children: ReactNode;
}) {
  const status = statusMeta(op.status);
  const canManage = !!onMode;

  // Open work, only meaningful to a manager: units still waiting for a decision
  // plus questions nobody has answered. Both are things that block other people.
  const pendingUnits = op.units.filter((u) => u.status === "pending").length;
  const openQuestions = op.questions.filter((q) => !q.answer).length;
  const openWork = pendingUnits + openQuestions;

  const statusChip = (
    <span
      data-testid="op-status-chip"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.08em", textTransform: "uppercase", color: status.color, border: `1px solid ${status.color}`, borderRadius: 8, padding: "0.24rem 0.6rem" }}
    >
      {/* Never colour alone (§10.2): the dot is decoration, the word carries it. */}
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: status.color }} />
      {status.label}
    </span>
  );

  const modeButton = (target: OperationMode, label: string, icon: string) => {
    const on = mode === target;
    return (
      <button
        type="button"
        data-testid={`op-mode-${target}`}
        aria-pressed={on}
        onClick={() => onMode?.(target)}
        style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0.4rem 0.9rem", borderRadius: 9, cursor: "pointer", fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.03em", whiteSpace: "nowrap", fontWeight: on ? 700 : 500, border: on ? "1px solid var(--cyan)" : "1px solid var(--border)", background: on ? "var(--cyan)" : "transparent", color: on ? "var(--bg)" : "var(--dim)" }}
      >
        <Ic name={icon} size={14} sw={1.7} /> {label}
      </button>
    );
  };

  return (
    <article>
      <Breadcrumbs items={[{ label: "Operationen", to: "/operationen" }, { label: op.title }]} />

      <header data-testid="op-header" style={{ marginBottom: "1.1rem" }}>
        <h1
          data-testid="op-title"
          style={{ fontWeight: 700, fontSize: "2.1rem", lineHeight: 1.12, color: "var(--text-hi)", margin: "0 0 0.5rem", letterSpacing: "0.01em" }}
        >
          {op.title}
        </h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem 1.2rem", marginBottom: "0.7rem" }}>
          {metaItem("server", op.guild.name, "guild")}
          {metaItem("clock", dateLabel, "when")}
          {metaItem("globe", op.meetingSystem, "system")}
          {metaItem("pin", op.meetingLocation, "where")}
        </div>

        {/* Status, the numbers and the mode switch stay reachable while scrolling.
            One low row, so it costs little height on a phone (§11). */}
        <div
          data-testid="op-context-bar"
          style={{ position: "sticky", top: 0, zIndex: 40, display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", padding: "0.55rem 0.7rem", borderRadius: 11, border: "1px solid var(--border)", background: "var(--bg2)" }}
        >
          {statusChip}
          {kpi(`${op.filledSeats}/${op.totalSeats} Plätze`, "op-kpi-seats")}
          {canManage && openWork > 0 &&
            kpi(
              openWork === 1 ? "1 offene Aufgabe" : `${openWork} offene Aufgaben`,
              "op-kpi-open-work",
              "var(--gold)",
            )}
          {canManage && (
            <div role="group" aria-label="Ansicht der Operation" style={{ marginLeft: "auto", display: "inline-flex", gap: "0.4rem" }}>
              {modeButton("view", "Operation ansehen", "eye")}
              {modeButton("manage", "Verwalten", "wrench")}
            </div>
          )}
        </div>
      </header>

      {children}
    </article>
  );
}
