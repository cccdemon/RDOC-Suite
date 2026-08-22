import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  addLeader,
  ApiError,
  answerQuestion,
  addCqbTeamMember,
  autoBundleCqb,
  dissolveCqbTeam,
  assignCqbSoldier,
  autoFillFighters,
  setCqbLateArrival,
  assignCqbTeamCarrier,
  assignSeat,
  assignUnitCarrier,
  assignUnitFormation,
  createFormation,
  decideUnit,
  deleteFormation,
  renameCqbTeam,
  renameFormation,
  getOperatorView,
  patchSeat,
  patchUnit,
  removeCqbSoldier,
  removeLeader,
  removeNeed,
  setFighterSquads,
  setGroupParent,
  setMemberSlot,
  unassignSeat,
  withdrawUnit,
} from "../api/client";
import type { FleetUnit, OperationDetail, OperatorView, ShipClass } from "../api/types";
import { OFFERABLE_ROLES, ROLE_LABEL, roleLabel } from "../shipRoles";
import { Ic } from "./Icons";
import { Avatar } from "./Avatar";
import { LateArrival } from "./LateArrival";
import { SaveDot, useFieldSave } from "./fieldSave";
import { tint } from "./ui";

const MONO = "var(--mono)";

const LANES = [
  { type: "ship", label: "SCHIFFE & CREW", icon: "ship", accent: "var(--cyan)" },
  { type: "fighter", label: "JÄGER", icon: "fighter", accent: "var(--cyan)" },
  { type: "squad", label: "BODENTRUPPEN", icon: "fps", accent: "var(--cyan)" },
  { type: "vehicle", label: "FAHRZEUGE", icon: "vehicle", accent: "var(--cyan)" },
] as const;

// Board lane for a unit. Fighter-class ships get their own lane (the user wants
// fighters as a distinct class, not lumped with capital ships); everything else
// buckets by unitType.
function laneOf(u: FleetUnit): string {
  if (u.unitType === "ship") return u.shipClass === "Fighter" ? "fighter" : "ship";
  return u.unitType;
}

const card: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg2)", padding: "1.1rem 1.2rem" };
const railLabel: React.CSSProperties = { fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.12em", color: "var(--dim)", marginBottom: "0.7rem" };
const opActBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "flex-start", padding: "0.6rem 0.8rem", fontFamily: MONO, fontSize: "0.74rem", letterSpacing: "0.03em", borderRadius: 8, cursor: "pointer", border: "1px solid var(--border)", background: "var(--wash)", color: "var(--text)", textDecoration: "none" };
const panelHead = (icon: string, color: string, label: string, right?: ReactNode) => (
  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.8rem" }}>
    <span style={{ color, display: "inline-flex" }}><Ic name={icon} size={15} /></span>
    <span style={{ fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.1em", color: color === "var(--gold)" ? "var(--gold)" : "var(--dim)" }}>{label}</span>
    {right}
  </div>
);

function seatIcon(u: FleetUnit, order: number): string {
  if (u.unitType === "squad") return "fps";
  return order === 0 ? "pilot" : "gunner";
}

export function OperatorPanel({
  op,
  csrf,
  onChanged,
  onError,
  embedded = false,
  section = "fleet",
}: {
  op: OperationDetail;
  csrf: string;
  onChanged: () => void;
  onError: (msg: string) => void;
  // When embedded in the Op-Management "Flotte & Warteliste" tab, the operator-
  // actions panel (links back to manage tabs) and the leaders panel are dropped —
  // manage already has a Commanders tab. Default layout = Triage (board + right
  // waitlist) to match the design's Flotte-tab.
  embedded?: boolean;
  // Redesign (Variante A): the fleet family is split across console tabs. Each
  // section renders only its block(s); "fleet" is the board + right rail.
  section?: "fleet" | "cqb" | "formations" | "qa";
}) {
  const { touch, fail } = useFieldSave();
  const [view, setView] = useState<OperatorView | null>(null);
  // Optimistic board copy: the board reads units from here so seat/unit actions
  // update instantly without a parent reload (no flicker, picker/scroll preserved).
  // Re-seeded from the server prop whenever the op reloads; rolled back on error.
  const [units, setUnits] = useState<FleetUnit[]>(op.units);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [placing, setPlacing] = useState<{ userId: string; name: string } | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [dragUserId, setDragUserId] = useState<string | null>(null);
  // Drag/place state model (UI audit §7.2). `dragOverSeat` is the seat the pointer
  // currently hovers, `pendingSeats` locks a seat while its assignment is in flight,
  // `seatError` keeps the failure next to the seat that caused it, and `live` feeds
  // the single polite live region so the flow works without seeing the highlight.
  const [dragOverSeat, setDragOverSeat] = useState<string | null>(null);
  const [pendingSeats, setPendingSeats] = useState<Record<string, true>>({});
  const [seatError, setSeatError] = useState<Record<string, string>>({});
  const [live, setLive] = useState("");
  const [leaderPick, setLeaderPick] = useState(false);

  const [memberFilter, setMemberFilter] = useState("");
  // #5: per-CQB-team "add any person" picker — teamId whose picker is open + search.
  const [addMemberTeam, setAddMemberTeam] = useState<string | null>(null);
  // Squad size the CQB auto-bundle uses; the backend clamps to 2..8 anyway.
  const [bundleSize, setBundleSize] = useState(4);
  const [addMemberFilter, setAddMemberFilter] = useState("");
  // Per-pending-unit chosen Bedarf at accept time (defaults to a suggested slot).
  const [acceptReq, setAcceptReq] = useState<Record<string, string>>({});
  const [newFormation, setNewFormation] = useState(""); // FR-B2 create-formation input

  function reload() {
    getOperatorView(op.id)
      .then(setView)
      .catch((e) => onError(e instanceof ApiError ? e.message : "Operator-Daten nicht ladbar."));
  }
  // Refetch the operator view whenever the PARENT op reloads (new object ref), not
  // just on op.id change. Needs/role/roster edits from other panels (NeedsEditor,
  // CommandersPanel, another operator via the page poll) flow through the parent's
  // load() → the board's requirements/assignable-people update live, no page reload.
  useEffect(reload, [op]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the optimistic board copy in sync with server reloads.
  useEffect(() => { setUnits(op.units); }, [op]);

  // §7.2 "Abbruch": Escape leaves place-mode, an active drag and the seat picker in
  // a clean state — the same key works for mouse, touch and keyboard users.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (!placing && !dragUserId && !picker) return;
      setPlacing(null); setDragUserId(null); setDragOverSeat(null); setPicker(null);
      setLive("Einteilen abgebrochen.");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placing, dragUserId, picker]);

  // People the operator may assign. Comes from the operator view, so a partner
  // event also lists the partner guilds' members — not just the host guild's.
  const members = view?.assignablePeople ?? [];

  // ── action helpers ──────────────────────────────────────────────
  // View-scoped action (cqb teams / formations list / questions / flex): optimistic
  // local `view` mutation, then API; field-status feedback; no parent reload. On
  // error, refetch the view to restore truth.
  function viewAct(fieldId: string, apiCall: () => Promise<unknown>, optimistic?: (v: OperatorView) => OperatorView) {
    setPlacing(null); setPicker(null); setDragUserId(null);
    if (optimistic) setView((v) => (v ? optimistic(v) : v));
    apiCall().then(() => touch(fieldId)).catch((e) => {
      fail(fieldId);
      onError(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
      reload();
    });
  }
  // Board action (seats / units): optimistic local `units` mutation, then API.
  // No parent onChanged() on success (kills flicker); on error roll back to the
  // server truth via onChanged() + local re-seed.
  function boardAct(fieldId: string, mutate: (units: FleetUnit[]) => FleetUnit[], apiCall: () => Promise<unknown>) {
    setPlacing(null); setPicker(null); setDragUserId(null);
    setUnits((prev) => mutate(prev));
    apiCall().then(() => touch(fieldId)).catch((e) => {
      fail(fieldId);
      onError(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
      setUnits(op.units);
      onChanged();
    });
  }
  // Legacy deliberate action (still reloads): used where a server-side reshuffle is
  // expected (withdraw / reject) and a clean refetch is preferable to optimism.
  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setPlacing(null); setPicker(null); setDragUserId(null);
      reload();
      onChanged();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    }
  }
  // Helper: map a single seat across the local units tree.
  const mapSeat = (units: FleetUnit[], seatId: string, fn: (s: FleetUnit["seats"][number]) => FleetUnit["seats"][number]) =>
    units.map((u) => ({ ...u, seats: u.seats.map((s) => (s.id === seatId ? fn(s) : s)) }));

  // Assign a user to a seat, optimistically. Unlike the generic boardAct this keeps
  // a per-seat pending lock (§7.2 "Speichern" — no second, conflicting drop while
  // the first is in flight), announces every transition, and on failure rolls the
  // board back AND leaves the reason at the seat that produced it.
  function assignSeatOptimistic(seatId: string, userId: string, username: string, seatLabel?: string) {
    if (pendingSeats[seatId]) return;
    const where = seatLabel ? ` auf ${seatLabel}` : "";
    setPlacing(null); setPicker(null); setDragUserId(null); setDragOverSeat(null);
    setSeatError((p) => { const n = { ...p }; delete n[seatId]; return n; });
    setPendingSeats((p) => ({ ...p, [seatId]: true }));
    setUnits((prev) => mapSeat(prev, seatId, (x) => ({ ...x, claimedBy: { id: userId, username } })));
    // Seated people are no longer waiting: drop the crew request right away so the
    // person leaves "Flexibel" with the same click that seats them. CQB-sourced
    // entries fall out on their own (they key off the seated set). reload() on
    // error puts the server truth back.
    setView((v) => (v ? { ...v, crewRequests: v.crewRequests.filter((r) => r.userId !== userId) } : v));
    setLive(`${username}${where} wird gespeichert…`);
    assignSeat(op.id, seatId, userId, csrf)
      .then(() => { touch(`seat-${seatId}`); setLive(`${username}${where} eingeteilt.`); })
      .catch((e) => {
        const msg = e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.";
        fail(`seat-${seatId}`);
        setSeatError((p) => ({ ...p, [seatId]: msg }));
        onError(msg);
        setLive(`Fehler: ${msg}`);
        setUnits(op.units);
        reload();
        onChanged();
      })
      .finally(() => setPendingSeats((p) => { const n = { ...p }; delete n[seatId]; return n; }));
  }


  const accepted = units.filter((u) => u.status === "accepted");
  const pendingUnits = units.filter((u) => u.status === "pending");
  // Roster = optimal lineup: open needs show as empty "unerfüllt" slots so every
  // category column appears even before a ship is offered (ship + fighter needs;
  // CQB lives in its own block). A lane shows when it has units OR open needs.
  const shipReqUnfilled = (view?.requirements ?? []).filter((r) => r.needType === "ship" && r.filled < r.count);
  const fighterReqO = (view?.requirements ?? []).find((r) => r.needType === "fighter_squad");
  const fighterEmptyO = fighterReqO ? Math.max(0, fighterReqO.count - fighterReqO.filled) : 0;
  type NeedSlot = { label: string; key: string; onRemove?: () => void };
  const lanes = LANES.map((l) => {
    const units = accepted.filter((u) => laneOf(u) === l.type);
    const placeholders: NeedSlot[] =
      l.type === "ship"
        ? shipReqUnfilled.map((r) => ({ label: r.label || r.category || "Schiff", key: r.id, onRemove: () => run(() => removeNeed(op.id, r.id, csrf)) }))
        : l.type === "fighter"
          ? Array.from({ length: fighterEmptyO }, (_, i) => ({ label: "Jäger", key: `fighter-${i}`, onRemove: () => run(() => setFighterSquads(op.id, csrf, Math.max(0, (fighterReqO?.count ?? 0) - 1))) }))
          : [];
    return { ...l, units, placeholders };
  });
  const filled = accepted.reduce((a, u) => a + u.seats.filter((s) => s.claimedBy).length, 0);
  const total = accepted.reduce((a, u) => a + u.seats.filter((s) => s.active).length, 0);
  const open = total - filled;
  const fillPct = total ? Math.round((filled / total) * 100) : 0;
  // "Flexibel angemeldet" arrives through two different tables: the crew-assignment
  // request, and a CQB signup with no group — which is what the roster's
  // "Flexibel anmelden" button actually writes. Reading only crewRequests made
  // everyone who used that button invisible to the operator. People who already
  // hold a seat are no longer waiting, so they drop out.
  const seatedUserIds = new Set(
    accepted.flatMap((u) => u.seats.map((s) => s.claimedBy?.id).filter((x): x is string => !!x)),
  );
  const flexPeople: { userId: string; username: string; note: string | null; createdAt?: string }[] = (() => {
    const out = new Map<string, { userId: string; username: string; note: string | null; createdAt?: string }>();
    for (const r of view?.crewRequests ?? []) out.set(r.userId, { userId: r.userId, username: r.username, note: r.note, createdAt: r.createdAt });
    for (const s of view?.cqbSoldiers ?? []) {
      if (s.assignedGroupId || seatedUserIds.has(s.userId) || out.has(s.userId)) continue;
      out.set(s.userId, { userId: s.userId, username: s.username, note: s.note });
    }
    return [...out.values()];
  })();
  const flexWaiting = flexPeople.length;
  const openQ = view?.questions.filter((q) => !q.answer).length ?? 0;

  const bars = LANES.map((l) => {
    const units = accepted.filter((u) => laneOf(u) === l.type);
    const f = units.reduce((a, u) => a + u.seats.filter((s) => s.claimedBy).length, 0);
    const t = units.reduce((a, u) => a + u.seats.filter((s) => s.active).length, 0);
    return { label: l.label, accent: l.accent, f, t, pct: t ? Math.round((f / t) * 100) : 0 };
  }).filter((b) => b.t > 0);

  if (!view)
    return <div className="fpw-state" data-testid="operator-loading"><span style={railLabel}>LADE OPERATOR-DATEN…</span></div>;

  // ── Fleet requirements (Bedarfe) — bind an offered unit to a slot ──────
  const requirements = view.requirements;
  // Light client-side category match (mirrors backend matchesCategory hint) to
  // preselect a sensible Bedarf when accepting a unit.
  const unitMatchesCat = (u: FleetUnit, cat: string): boolean => {
    const c = cat.toLowerCase();
    if (c === "any" || c === "") return true;
    if (c === "fps" || c === "ground") return u.unitType === "squad" || u.unitType === "vehicle";
    if (u.unitType !== "ship") return false;
    if (c === "fighter") return u.shipClass === "Fighter";
    return (u.shipClass ?? "").toLowerCase().includes(c) || c.includes((u.shipClass ?? "").toLowerCase());
  };
  const openReqs = () => requirements.filter((r) => r.filled < r.count);
  const suggestReqId = (u: FleetUnit): string => {
    const open = openReqs();
    return (open.find((r) => r.category.toLowerCase() !== "any" && unitMatchesCat(u, r.category))
      ?? open.find((r) => r.category.toLowerCase() === "any")
      ?? open[0])?.id ?? "";
  };
  // Dropdown of Bedarfe for a unit: open slots + the currently-bound one.
  const reqChoices = (u: FleetUnit) =>
    requirements.filter((r) => r.filled < r.count || r.id === u.requirementId);
  const reqSelect = (u: FleetUnit, value: string, onPick: (id: string) => void, testid: string) => (
    <select
      data-testid={testid}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onPick(e.target.value)}
      style={{ minWidth: 0, maxWidth: "100%", background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: MONO, fontSize: "0.66rem", padding: "0.25rem 0.4rem", borderRadius: 6, outline: "none" }}
    >
      <option value="">— kein Bedarf —</option>
      {reqChoices(u).map((r) => (
        <option key={r.id} value={r.id}>{r.label} ({r.filled}/{r.count})</option>
      ))}
    </select>
  );

  // ── operator seat row (board): place-mode target / picker / drop target ──
  const opSeatRow = (u: FleetUnit, s: FleetUnit["seats"][number]) => {
    // §7.2/§7.4: a seat is only a target when it is free, active and not already
    // saving. Everything else says WHY instead of swallowing the interaction.
    const busy = !!pendingSeats[s.id];
    const err = seatError[s.id];
    const free = !s.claimedBy && s.active;
    const isCaptainSeat = s.order === 0;
    // The "armed" person is whoever is currently being placed — via place-mode
    // (click / keyboard / touch) or via an active HTML5 drag. Both feed one model.
    const armed: { userId: string; name: string } | null =
      placing ?? (dragUserId ? { userId: dragUserId, name: flexPeople.find((r) => r.userId === dragUserId)?.username ?? "Person" } : null);
    const isTarget = !!armed && free && !busy;
    const isOver = isTarget && dragOverSeat === s.id;
    const reason = busy
      ? "Sitz wird gerade gespeichert"
      : s.claimedBy
        ? `Sitz belegt von ${s.claimedBy.username}`
        : !s.active
          ? "Sitz ist deaktiviert"
          : null;
    // Someone who already holds a seat is not moved by a second drop — that is an
    // ADDITIONAL assignment, and the target says so instead of pretending otherwise.
    const extra = !!armed && seatedUserIds.has(armed.userId);
    const verb = extra ? "zusätzlich einteilen" : "setzen";

    // One activation path for pointer, Enter and Space.
    const activate = () => {
      if (reason) { setLive(`${reason}.`); return; }
      if (placing) assignSeatOptimistic(s.id, placing.userId, placing.name, s.label);
      else setPicker(picker === s.id ? null : s.id);
    };

    return (
      <div key={s.id} style={{ border: isTarget ? "1px solid var(--edge-green)" : "1px solid var(--wash)", borderRadius: 9, overflow: "hidden", opacity: s.active ? 1 : 0.55, transition: "border-color .12s" }}>
        <div
          data-testid={free ? `op-target-${s.id}` : undefined}
          role={free ? "button" : undefined}
          tabIndex={free ? 0 : undefined}
          aria-disabled={busy || undefined}
          aria-label={
            free
              ? armed
                ? `${armed.name} auf ${s.label} ${verb}`
                : `Sitz ${s.label}${isCaptainSeat ? " (Kapitänssitz)" : ""} — Person einteilen`
              : `Sitz ${s.label} — ${reason ?? "belegt"}`
          }
          title={reason ?? (isCaptainSeat ? "Kapitänssitz — wird beim Annehmen der Einheit automatisch besetzt" : undefined)}
          onClick={activate}
          onKeyDown={(e) => {
            if (!free) return;
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
          }}
          onDragOver={(e) => {
            // No drop cursor over an invalid target (§7.2 "Über ungültigem Ziel").
            if (!isTarget) return;
            e.preventDefault();
            if (dragOverSeat !== s.id) setDragOverSeat(s.id);
          }}
          onDragLeave={() => { if (dragOverSeat === s.id) setDragOverSeat(null); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverSeat(null);
            if (reason) { setLive(`${reason}.`); return; }
            // Only flex persons (CrewAssignmentRequest) drop onto seats. A pending
            // UNIT is a ship/squad whose captain auto-seats in its own seat on accept,
            // so it has no meaningful single-seat target — use "Annehmen" instead.
            let uid = dragUserId;
            if (!uid) { try { uid = e.dataTransfer.getData("text/plain") || null; } catch { uid = null; } }
            if (!uid) return;
            const name = flexPeople.find((r) => r.userId === uid)?.username ?? "—";
            assignSeatOptimistic(s.id, uid, name, s.label);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.7rem",
            padding: "0.55rem 0.65rem",
            background: isOver ? "var(--tint-green)" : "var(--wash)",
            minWidth: 0,
            cursor: busy ? "progress" : s.claimedBy ? "default" : "pointer",
            boxShadow: isTarget ? "0 0 0 1px var(--edge-green)" : "none",
          }}
        >
          <span style={{ width: 28, height: 28, borderRadius: 7, background: "var(--bg3)", border: isCaptainSeat ? "1px solid var(--edge-gold)" : "1px solid var(--wash)", color: isCaptainSeat ? "var(--gold)" : "var(--dim)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Ic name={seatIcon(u, s.order)} size={15} sw={1.6} />
          </span>
          <input
            className="fpw-inline-edit"
            data-testid={`op-seat-label-${s.id}`}
            key={`${s.id}:${s.label}`}
            defaultValue={s.label}
            title="Sitz umbenennen (Enter)"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); }}
            onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== s.label) boardAct(`seat-${s.id}`, (us) => mapSeat(us, s.id, (x) => ({ ...x, label: v })), () => patchSeat(op.id, s.id, csrf, { label: v })); }}
          />
          {isCaptainSeat && (
            <span data-testid={`op-seat-captain-${s.id}`} title="Kapitänssitz" style={{ flexShrink: 0, fontFamily: MONO, fontSize: "0.52rem", letterSpacing: "0.08em", color: "var(--gold)", border: "1px solid var(--edge-gold)", borderRadius: 4, padding: "0.1rem 0.3rem" }}>KPT</span>
          )}
          <span onClick={(e) => e.stopPropagation()}><SaveDot id={`seat-${s.id}`} /></span>
          {!s.claimedBy && (
            <button type="button" data-testid={`op-seat-toggle-${s.id}`} title={s.active ? "Sitz deaktivieren" : "Sitz aktivieren"} onClick={(e) => { e.stopPropagation(); boardAct(`seat-${s.id}`, (us) => mapSeat(us, s.id, (x) => ({ ...x, active: !x.active })), () => patchSeat(op.id, s.id, csrf, { active: !s.active })); }} style={{ flexShrink: 0, fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.05em", padding: "0.18rem 0.42rem", borderRadius: 5, cursor: "pointer", border: s.active ? "1px solid var(--wash)" : "1px solid var(--edge-green)", background: s.active ? "transparent" : "var(--tint-green)", color: s.active ? "var(--dim2)" : "var(--green)" }}>{s.active ? "AUS" : "AN"}</button>
          )}
          {s.claimedBy ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
              <Avatar name={s.claimedBy.username} />
              <span style={{ fontSize: "0.8rem", color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "6.5rem" }}>{s.claimedBy.username}</span>
              {busy && <span data-testid={`op-seat-pending-${s.id}`} style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.05em", color: "var(--dim2)" }}>SPEICHERT…</span>}
              {!busy && s.order !== 0 && (
                <button type="button" data-testid={`op-free-${s.id}`} title="Platz freigeben" onClick={(e) => { e.stopPropagation(); boardAct(`seat-${s.id}`, (us) => mapSeat(us, s.id, (x) => ({ ...x, claimedBy: null })), () => unassignSeat(op.id, s.id, csrf)); }} style={{ flexShrink: 0, width: 21, height: 21, borderRadius: 6, border: "1px solid var(--wash)", background: "transparent", color: "var(--dim2)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <Ic name="x" size={11} sw={2} />
                </button>
              )}
            </div>
          ) : isOver && armed ? (
            <span data-testid={`op-drop-hint-${s.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, color: "var(--green)", fontFamily: MONO, fontSize: "0.63rem", letterSpacing: "0.02em", whiteSpace: "nowrap" }}>{armed.name} auf {s.label} {verb} <Ic name="arrow" size={13} sw={1.9} /></span>
          ) : isTarget && armed ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, color: "var(--green)", fontFamily: MONO, fontSize: "0.63rem", letterSpacing: "0.02em", whiteSpace: "nowrap" }}>{extra ? "zusätzlich" : "hier"} <Ic name="arrow" size={13} sw={1.9} /></span>
          ) : !s.active ? (
            <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.05em", color: "var(--dim3)" }}>DEAKTIVIERT</span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, color: "var(--cyan)", fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.03em" }}><Ic name="plus" size={13} sw={1.9} /> Einteilen</span>
          )}
        </div>
        {err && (
          <div data-testid={`op-seat-error-${s.id}`} role="alert" style={{ borderTop: "1px solid var(--edge-red)", background: "var(--tint-red)", color: "var(--red)", fontFamily: MONO, fontSize: "0.62rem", padding: "0.35rem 0.6rem" }}>{err}</div>
        )}
        {picker === s.id && !s.claimedBy && !placing && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "0.6rem", display: "flex", flexDirection: "column", gap: "0.35rem", background: "var(--bg2)" }}>
            <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.1em", color: "var(--dim)" }}>WER SOLL HIER REIN?</div>
            {flexPeople.length === 0 && <div style={{ color: "var(--dim3)", fontSize: "0.78rem" }}>Keine flexiblen Anmeldungen.</div>}
            {flexPeople.map((r) => (
              <button key={r.userId} type="button" data-testid={`op-pick-${r.userId}`} onClick={(e) => { e.stopPropagation(); assignSeatOptimistic(s.id, r.userId, r.username, s.label); }} style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", textAlign: "left", padding: "0.4rem 0.5rem", border: "1px solid var(--edge-gold)", background: "var(--tint-gold)", borderRadius: 7, cursor: "pointer", color: "inherit", fontFamily: "inherit" }}>
                <Avatar name={r.username} />
                <span style={{ flex: 1, fontSize: "0.84rem", color: "var(--text-hi)" }}>{r.username}</span>
                <span style={{ fontFamily: MONO, fontSize: "0.6rem", color: "var(--gold)" }}>FLEX</span>
              </button>
            ))}
            {/* assign ANY guild member (e.g. someone who confirmed by phone) */}
            <div style={{ borderTop: "1px solid var(--wash)", paddingTop: "0.4rem", marginTop: "0.1rem" }}>
              <input
                type="search"
                data-testid="op-pick-search"
                value={memberFilter}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setMemberFilter(e.target.value)}
                placeholder="Person suchen (auch Partner-Discord)…"
                style={{ width: "100%", boxSizing: "border-box", background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.8rem", padding: "0.35rem 0.5rem", borderRadius: 7, outline: "none", marginBottom: "0.35rem" }}
              />
              {memberFilter.trim() && (members ?? [])
                .filter((m) => m.username.toLowerCase().includes(memberFilter.trim().toLowerCase()))
                .slice(0, 8)
                .map((m) => (
                  <button key={m.userId} type="button" data-testid={`op-pick-member-${m.userId}`} onClick={(e) => { e.stopPropagation(); assignSeatOptimistic(s.id, m.userId, m.username, s.label); }} style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", textAlign: "left", padding: "0.4rem 0.5rem", border: "1px solid var(--border)", background: "var(--wash)", borderRadius: 7, cursor: "pointer", color: "inherit", fontFamily: "inherit", marginBottom: "0.25rem" }}>
                    <Avatar name={m.username} />
                    <span style={{ flex: 1, fontSize: "0.84rem", color: "var(--text-hi)" }}>{m.username}</span>
                    {/* Partner-guild members are labelled with their org so the
                        operator never mistakes them for their own crew. */}
                    <span style={{ fontFamily: MONO, fontSize: "0.6rem", color: m.isHost ? "var(--cyan)" : "var(--gold)" }}>{m.isHost ? "MITGLIED" : (m.guildName || "PARTNER").toUpperCase()}</span>
                  </button>
                ))}
            </div>
            <button type="button" onClick={(e) => { e.stopPropagation(); setPicker(null); }} style={{ padding: "0.4rem 0.6rem", border: "1px solid var(--wash)", background: "transparent", color: "var(--dim)", fontFamily: MONO, fontSize: "0.64rem", borderRadius: 7, cursor: "pointer" }}>Schließen</button>
          </div>
        )}
      </div>
    );
  };

  // ── panels (shared between layouts) ──────────────────────────
  // Origin of a flex person: assignablePeople carries the partner org, so a
  // partner member stays labelled as one in the waiting list too (§7.4).
  const originOf = (userId: string) => members.find((m) => m.userId === userId);

  const flexPanel = (
    <section style={{ ...card, border: "1px solid var(--edge-gold)" }}>
      {panelHead("swap", "var(--gold)", "FLEXIBEL", <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.66rem", color: "var(--dim3)" }}>{flexWaiting} wartet</span>)}
      {flexPeople.length > 0 && (
        <p id="flex-drag-hint" style={{ margin: "0 0 0.6rem", fontSize: "0.72rem", lineHeight: 1.45, color: "var(--dim2)" }}>
          Ziehen auf einen freien Platz — oder <strong style={{ color: "var(--gold)" }}>Einteilen</strong> drücken und den Platz wählen (geht auch per Tastatur und auf dem Handy). Escape bricht ab.
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {flexPeople.length === 0 ? (
          <div style={{ padding: "0.7rem", textAlign: "center", color: "var(--dim3)", fontSize: "0.8rem", fontFamily: MONO }}>Alle eingeteilt ✓</div>
        ) : (
          flexPeople.map((r) => {
            const isPlacing = placing?.userId === r.userId;
            const origin = originOf(r.userId);
            const alreadySeated = seatedUserIds.has(r.userId);
            return (
              <div
                key={r.userId}
                data-testid={`op-flex-${r.userId}`}
                draggable
                aria-describedby="flex-drag-hint"
                onDragStart={(e) => { setDragUserId(r.userId); setPlacing(null); setPicker(null); setLive(`${r.username} aufgenommen — freie Plätze sind markiert.`); try { e.dataTransfer.setData("text/plain", r.userId); e.dataTransfer.effectAllowed = "move"; } catch { /* noop */ } }}
                onDragEnd={() => { setDragUserId(null); setDragOverSeat(null); }}
                style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.6rem 0.7rem", borderRadius: 9, cursor: "grab", opacity: dragUserId === r.userId ? 0.45 : 1, border: isPlacing ? "1px solid var(--edge-gold)" : "1px solid var(--wash)", background: isPlacing ? "var(--tint-gold)" : "transparent" }}
              >
                {/* visible grab affordance (§7.2 "Ruhend") */}
                <span aria-hidden="true" title="Ziehen" style={{ flexShrink: 0, color: "var(--dim3)", display: "inline-flex", cursor: "grab" }}><Ic name="swap" size={13} sw={1.7} /></span>
                <Avatar name={r.username} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: "0.9rem", color: "var(--text-hi)" }}>{r.username}</strong>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", marginTop: 1 }}>
                    {origin && !origin.isHost && (
                      <span data-testid={`op-flex-origin-${r.userId}`} style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.05em", color: "var(--gold)" }}>{(origin.guildName || "PARTNER").toUpperCase()}</span>
                    )}
                    {alreadySeated && (
                      <span data-testid={`op-flex-seated-${r.userId}`} style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.05em", color: "var(--dim2)" }}>BEREITS EINGETEILT</span>
                    )}
                    {r.note && <span style={{ color: "var(--dim2)", fontSize: "0.76rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.note}</span>}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid={`op-place-${r.userId}`}
                  aria-pressed={isPlacing}
                  title={alreadySeated ? "Zusätzlich auf einen weiteren Platz einteilen" : "Platz auswählen"}
                  onClick={() => {
                    if (isPlacing) { setPlacing(null); setLive("Einteilen abgebrochen."); return; }
                    setPlacing({ userId: r.userId, name: r.username });
                    setDragUserId(null);
                    setPicker(null);
                    setLive(`${r.username} aufgenommen — wähle einen grün markierten Platz. Escape bricht ab.`);
                  }}
                  style={{ flexShrink: 0, padding: "0.38rem 0.7rem", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.03em", border: isPlacing ? "1px solid var(--edge-red)" : "1px solid var(--edge-gold)", background: isPlacing ? "var(--tint-red)" : "var(--tint-gold)", color: isPlacing ? "var(--red)" : "var(--gold)" }}
                >
                  {isPlacing ? "Abbrechen" : alreadySeated ? "Zusätzlich" : "Einteilen"}
                </button>
              </div>
            );
          })
        )}
      </div>
    </section>
  );

  // FR-E1: Discord "Interested" RSVPs. Linked users (have an app account) can be
  // placed onto a seat via place-mode; shadows (no account yet) only show as a
  // metric until they log in once. Withdrawn/converted aren't sent by the API.
  const interests = view.eventInterests;
  const interestUnknown = interests.filter((e) => !e.userId).length;
  const interestPanel = interests.length > 0 && (
    <section style={{ ...card, border: "1px solid rgba(121, 174, 220,0.22)" }} data-testid="interest-panel">
      {panelHead("users", "var(--info)", "EVENT-INTERESSE", <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.62rem", color: "var(--dim3)" }}>{interests.length - interestUnknown} verknüpft · {interestUnknown} unbekannt</span>)}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
        {interests.map((e) => {
          const isPlacing = !!e.userId && placing?.userId === e.userId;
          return (
            <div key={e.id} data-testid={`interest-${e.id}`} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.5rem 0.65rem", borderRadius: 9, border: isPlacing ? "1px solid rgba(121, 174, 220,0.6)" : "1px solid var(--wash)", background: isPlacing ? "rgba(121, 174, 220,0.08)" : "transparent" }}>
              <Avatar name={e.displayName} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: "0.88rem", color: "var(--text-hi)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{e.displayName}</strong>
                {!e.userId && <div style={{ fontFamily: MONO, fontSize: "0.58rem", color: "var(--dim2)", marginTop: 1 }}>nicht verknüpft · muss sich einmal anmelden</div>}
              </div>
              {e.seated ? (
                <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, fontFamily: MONO, fontSize: "0.64rem", color: "var(--green)" }}><Ic name="check" size={12} sw={2} /> eingeteilt</span>
              ) : e.userId ? (
                <button type="button" data-testid={`interest-place-${e.id}`} onClick={() => setPlacing(isPlacing ? null : { userId: e.userId!, name: e.displayName })} style={{ flexShrink: 0, padding: "0.34rem 0.65rem", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: "0.68rem", border: isPlacing ? "1px solid var(--edge-red)" : "1px solid rgba(121, 174, 220,0.45)", background: isPlacing ? "var(--tint-red)" : "rgba(121, 174, 220,0.1)", color: isPlacing ? "var(--red)" : "var(--info)" }}>{isPlacing ? "Abbrechen" : "Einteilen"}</button>
              ) : (
                <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: "0.6rem", color: "var(--dim3)", border: "1px solid var(--wash)", padding: "0.18rem 0.42rem", borderRadius: 5 }}>UNBEKANNT</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );

  const needsPanel = (
    <section style={card}>
      {panelHead("alert", "var(--cyan)", "OFFENE BEDARFE", <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.66rem", color: "var(--dim3)" }}>{open} offen</span>)}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.42rem" }}>
        {lanes.flatMap((lane) =>
          lane.units
            .map((u) => ({ u, lane, openN: u.seats.filter((s) => !s.claimedBy && s.active).length }))
            .filter((x) => x.openN > 0)
            .map(({ u, lane, openN }) => (
              <div key={u.id} style={{ display: "flex", alignItems: "center", gap: "0.55rem", padding: "0.45rem 0.55rem", border: "1px solid var(--wash)", borderRadius: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: lane.accent, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.85rem", color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</div>
                  <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.04em", color: "var(--dim3)", marginTop: 1 }}>{lane.label}</div>
                </div>
                <span style={{ fontFamily: MONO, fontSize: "0.9rem", color: "var(--gold)", flexShrink: 0 }}>{openN}</span>
              </div>
            )),
        )}
        {open === 0 && <div style={{ padding: "0.5rem", color: "var(--dim3)", fontSize: "0.8rem", fontFamily: MONO }}>Keine offenen Plätze ✓</div>}
      </div>
    </section>
  );

  const qaPanel = (
    <section style={card}>
      {panelHead("chat", "var(--cyan)", "FRAGEN", openQ > 0 ? <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.58rem", color: "var(--gold)", border: "1px solid var(--edge-gold)", background: "var(--tint-gold)", padding: "0.08rem 0.4rem", borderRadius: 10 }}>{openQ} offen</span> : undefined)}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {view.questions.length === 0 && <div style={{ color: "var(--dim3)", fontSize: "0.8rem", fontFamily: MONO }}>Keine Fragen.</div>}
        {view.questions.map((q) => (
          <div key={q.id} style={{ border: "1px solid var(--wash)", borderRadius: 9, padding: "0.6rem 0.65rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.4rem" }}><Avatar name={q.asker} /><strong style={{ fontSize: "0.82rem", color: "var(--text-hi)" }}>{q.asker}</strong></div>
            <div style={{ color: "var(--text)", fontSize: "0.84rem", lineHeight: 1.42, marginBottom: "0.5rem" }}>{q.body}</div>
            {q.answer ? (
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.45rem", padding: "0.45rem 0.55rem", border: "1px solid var(--edge-green)", background: "var(--tint-green)", borderRadius: 8 }}>
                <span style={{ color: "var(--green)", display: "inline-flex", flexShrink: 0, marginTop: 2 }}><Ic name="check" size={13} sw={2} /></span>
                <div style={{ minWidth: 0 }}><span style={{ fontFamily: MONO, fontSize: "0.6rem", color: "var(--green)" }}>{q.answeredBy ?? ""}</span><div style={{ color: "var(--text)", fontSize: "0.82rem", lineHeight: 1.4 }}>{q.answer}</div></div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-end" }}>
                <textarea value={drafts[q.id] ?? ""} data-testid={`answer-input-${q.id}`} onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))} placeholder="Antwort…" style={{ flex: 1, minWidth: 0, minHeight: 36, background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.84rem", padding: "0.42rem 0.55rem", borderRadius: 8, outline: "none", resize: "vertical" }} />
                <button type="button" data-testid={`answer-send-${q.id}`} disabled={!(drafts[q.id] ?? "").trim()} onClick={() => run(() => answerQuestion(op.id, q.id, drafts[q.id].trim(), csrf))} style={{ flexShrink: 0, padding: "0.5rem 0.65rem", border: "1px solid var(--edge-green)", background: "var(--tint-green)", color: "var(--green)", fontFamily: MONO, fontSize: "0.68rem", borderRadius: 8, cursor: "pointer" }}>Senden</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );

  const actionsPanel = (
    <section style={card}>
      <div style={railLabel}>OPERATOR-AKTIONEN</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {/* Router links, not absolute hrefs: production runs without a
            /fleetplanner prefix, so those pointed nowhere. Tab keys and wording
            follow the console (IA 2026-08-22). */}
        <Link to={`/ops/${op.id}?op=eckdaten`} style={opActBtn}><Ic name="edit" size={14} /> Eckdaten bearbeiten</Link>
        <Link to={`/ops/${op.id}?op=fleet`} style={opActBtn}><Ic name="ship" size={14} /> Board verwalten</Link>
        <Link to={`/ops/${op.id}?op=needs`} style={opActBtn}><Ic name="alert" size={14} /> Bedarfe verwalten</Link>
        <Link to={`/ops/${op.id}?op=admin`} style={opActBtn}><Ic name="bolt" size={14} /> Vorlage &amp; Serie</Link>
      </div>
    </section>
  );

  const fillRingCard = (
    <section style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.9rem", marginBottom: bars.length ? "1rem" : 0 }}>
        <div style={{ width: 88, height: 88, borderRadius: "50%", flexShrink: 0, position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", background: `conic-gradient(var(--green) ${fillPct * 3.6}deg, var(--bg3) ${fillPct * 3.6}deg)` }}>
          <div style={{ position: "absolute", inset: 7, borderRadius: "50%", background: "var(--bg2)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: MONO, fontSize: "1.1rem", color: "var(--text-hi)", lineHeight: 1 }}>{fillPct}%</span>
            <span style={{ fontFamily: MONO, fontSize: "0.48rem", letterSpacing: "0.1em", color: "var(--dim3)" }}>VOLL</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--edge-green)", color: "var(--green)", background: "var(--tint-green)", fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.08em", padding: "0.16rem 0.45rem", borderRadius: 4, textTransform: "uppercase" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }} />{op.status}
          </span>
          <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-hi)", marginTop: "0.4rem", lineHeight: 1.1 }}>{filled} / {total} Plätze</div>
          <div style={{ color: "var(--dim2)", fontSize: "0.76rem", marginTop: 1 }}>{open} offen · {flexWaiting} flexibel</div>
        </div>
      </div>
      {bars.map((b) => (
        <div key={b.label} style={{ marginTop: "0.6rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.28rem" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", color: "var(--text)" }}><span style={{ width: 8, height: 8, borderRadius: 2, background: b.accent }} />{b.label}</span>
            <span style={{ fontFamily: MONO, fontSize: "0.74rem", color: "var(--dim)" }}>{b.f}/{b.t}</span>
          </div>
          <div style={{ height: 5, borderRadius: 4, background: "var(--bg3)", overflow: "hidden" }}><div style={{ height: "100%", width: `${b.pct}%`, background: b.accent, borderRadius: 4 }} /></div>
        </div>
      ))}
    </section>
  );

  // Leadership management — any op manager (operator / creator / commander).
  const canManageLeaders = op.canManage;
  const leaderIds = new Set(op.leaders.map((l) => l.id));
  // candidate appointees = op participants (claimed a seat) not already leaders
  const leaderCandidates = (() => {
    const seen = new Map<string, string>();
    for (const u of accepted) for (const s of u.seats) if (s.claimedBy && !leaderIds.has(s.claimedBy.id)) seen.set(s.claimedBy.id, s.claimedBy.username);
    return [...seen.entries()].map(([id, username]) => ({ id, username }));
  })();

  const leadersPanel = (op.leaders.length > 0 || canManageLeaders) && (
    <section style={card}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: "0.7rem" }}>
        <span style={railLabel as React.CSSProperties}>LEITUNG</span>
        {canManageLeaders && (
          <button type="button" data-testid="leader-add-toggle" onClick={() => setLeaderPick((v) => !v)} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, padding: "0.2rem 0.5rem", border: "1px solid var(--border)", background: "var(--wash)", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.62rem", borderRadius: 6, cursor: "pointer" }}>
            <Ic name="plus" size={12} sw={2} /> Leiter
          </button>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {op.leaders.length === 0 && <div style={{ color: "var(--dim3)", fontSize: "0.8rem" }}>Keine Leiter ernannt.</div>}
        {op.leaders.map((l) => (
          <div key={l.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Avatar name={l.username} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.85rem", color: "var(--text-hi)" }}>{l.username}</div>
              <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.04em", color: "var(--dim3)" }}>Leitung</div>
            </div>
            {canManageLeaders && (
              <button type="button" data-testid={`leader-remove-${l.id}`} title="Leiter entfernen" onClick={() => run(() => removeLeader(op.id, l.id, csrf))} style={{ flexShrink: 0, width: 21, height: 21, borderRadius: 6, border: "1px solid var(--wash)", background: "transparent", color: "var(--dim2)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Ic name="x" size={11} sw={2} />
              </button>
            )}
          </div>
        ))}
      </div>
      {canManageLeaders && leaderPick && (
        <div style={{ marginTop: "0.7rem", borderTop: "1px solid var(--wash)", paddingTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.1em", color: "var(--dim)" }}>TEILNEHMER ERNENNEN</div>
          {leaderCandidates.length === 0 ? (
            <div style={{ color: "var(--dim3)", fontSize: "0.78rem" }}>Keine geeigneten Teilnehmer.</div>
          ) : (
            leaderCandidates.map((c) => (
              <button key={c.id} type="button" data-testid={`leader-cand-${c.id}`} onClick={() => run(() => addLeader(op.id, c.id, csrf))} style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", textAlign: "left", padding: "0.4rem 0.5rem", border: "1px solid var(--border)", background: "var(--wash)", borderRadius: 7, cursor: "pointer", color: "inherit", fontFamily: "inherit" }}>
                <Avatar name={c.username} />
                <span style={{ flex: 1, fontSize: "0.84rem", color: "var(--text-hi)" }}>{c.username}</span>
                <Ic name="plus" size={13} sw={2} />
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );

  // A pending unit is a ship/squad: "Annehmen" accepts it (its captain auto-seats
  // in its own seat 0) at the chosen Bedarf; "✕" rejects. (Dropping a unit onto a
  // single seat is meaningless here — flex persons cover seat drag-and-drop.)
  const pendingBlock = pendingUnits.length > 0 && (
    <section style={{ ...card, marginBottom: "1.6rem", border: "1px solid var(--edge-gold)" }} data-testid="pending-block">
      <div style={railLabel}>ANSTEHENDE EINHEITEN ({pendingUnits.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {pendingUnits.map((u) => {
          const sel = acceptReq[u.id] ?? suggestReqId(u);
          return (
          <div key={u.id} data-testid={`pending-${u.id}`} style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", padding: "0.6rem 0.7rem", background: "var(--wash)", border: "1px solid var(--tint-gold)", borderRadius: 9 }}>
            <span style={{ flex: "1 1 160px", minWidth: 0, color: "var(--text-hi)", fontWeight: 600 }}>{u.name} <span style={{ color: "var(--dim2)", fontWeight: 400, fontSize: "0.84rem" }}>· {u.shipClass ?? u.unitType}{u.captain ? ` · ${u.captain.username}` : ""}</span></span>
            {requirements.length > 0 && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", color: "var(--dim)", fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.04em" }}>
                BEDARF
                {reqSelect(u, sel, (id) => setAcceptReq((m) => ({ ...m, [u.id]: id })), `unit-bedarf-${u.id}`)}
              </label>
            )}
            <button type="button" data-testid={`accept-${u.id}`} onClick={() => boardAct(`pending-${u.id}`, (us) => us.map((x) => (x.id === u.id ? { ...x, status: "accepted" } : x)), () => decideUnit(op.id, u.id, "accept", csrf, sel || undefined))} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0.34rem 0.7rem", border: "1px solid var(--edge-green)", background: "var(--tint-green)", color: "var(--green)", fontFamily: MONO, fontSize: "0.66rem", borderRadius: 7, cursor: "pointer" }}><Ic name="check" size={12} sw={2} /> Annehmen</button>
            <button type="button" data-testid={`reject-${u.id}`} title="Ablehnen" onClick={() => run(() => decideUnit(op.id, u.id, "reject", csrf))} style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 6, border: "1px solid var(--edge-red)", background: "var(--tint-red)", color: "var(--red)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Ic name="x" size={12} sw={2} /></button>
            <SaveDot id={`pending-${u.id}`} />
          </div>
          );
        })}
      </div>
    </section>
  );

  // FR-B5: CQB soldier placement. The pool of soldiers is split into teams
  // (squad groups); the operator assigns/moves each via a team dropdown.
  const cqbTeams = view.cqbTeams;
  const cqbSoldiers = view.cqbSoldiers;
  // Jäger-Staffeln: the Bedarf-materialised fighter_squad groups PLUS the Verbände
  // operators build by hand and use as squadrons. Both kinds coexist in real ops,
  // so picking one list over the other hid half the squadrons from the operator.
  const fighterFormations = [...view.fighterSquads, ...view.formations];
  const verbaende = view.formations;

  // "Hängt unter Verband X" selector, shared by Trupps and Staffeln. Detaching is
  // always allowed; a Verband can't be nested into itself (backend rejects it too).
  const parentSelect = (groupId: string, parentId: string | null | undefined, testid: string) =>
    verbaende.length > 0 && (
      <>
        <span style={{ fontFamily: MONO, fontSize: "0.58rem", color: "var(--dim3)", flexShrink: 0 }}>VERBAND</span>
        <select
          data-testid={testid}
          value={parentId ?? ""}
          onChange={(e) => { const pid = e.target.value || null; viewAct(`parent-${groupId}`, () => setGroupParent(op.id, groupId, csrf, pid)); }}
          style={{ flexShrink: 0, maxWidth: "34%", background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: MONO, fontSize: "0.64rem", padding: "0.22rem 0.4rem", borderRadius: 6, outline: "none" }}
        >
          <option value="">— kein Verband —</option>
          {verbaende.filter((f) => f.id !== groupId).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </>
    );

  // Slot 0 of any group is the Captain. This promotes a member into it; whoever
  // held slot 0 trades places, so a group never shows two Captains.
  const captainButton = (kind: "unit" | "person", id: string, isCaptain: boolean, testid: string) => (
    <button
      type="button"
      data-testid={testid}
      title={isCaptain ? "Ist Captain (Slot 1)" : "Zum Captain machen (Slot 1)"}
      disabled={isCaptain}
      onClick={() => viewAct(`slot-${id}`, () => setMemberSlot(op.id, csrf, kind, id, 0))}
      style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, padding: "0.18rem 0.4rem", border: `1px solid ${isCaptain ? "var(--edge-gold)" : "var(--wash)"}`, background: isCaptain ? "var(--tint-gold)" : "transparent", color: isCaptain ? "var(--gold)" : "var(--dim2)", fontFamily: MONO, fontSize: "0.56rem", borderRadius: 5, cursor: isCaptain ? "default" : "pointer" }}
    >
      ★ {isCaptain ? "CAPTAIN" : "CPT"}
    </button>
  );

  // Reusable "add any person" picker for a group (CQB team OR fighter squad).
  const memberPicker = (groupId: string) => {
    const alreadyIn = new Set(cqbSoldiers.filter((s) => s.assignedGroupId === groupId).map((s) => s.username.toLowerCase()));
    return (
      <div style={{ padding: "0.4rem 0.5rem", border: "1px solid var(--edge-gold)", borderRadius: 8, background: "var(--tint-gold)" }}>
        <input
          type="search"
          autoFocus
          data-testid={`add-member-search-${groupId}`}
          value={addMemberFilter}
          onChange={(e) => setAddMemberFilter(e.target.value)}
          placeholder="Person suchen (z.B. Sitz-Insasse einer Trägerin)…"
          style={{ width: "100%", boxSizing: "border-box", background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.8rem", padding: "0.35rem 0.5rem", borderRadius: 7, outline: "none", marginBottom: "0.35rem" }}
        />
        {addMemberFilter.trim() && (members ?? [])
          .filter((m) => m.username.toLowerCase().includes(addMemberFilter.trim().toLowerCase()))
          .slice(0, 8)
          .map((m) => {
            const inTeam = alreadyIn.has(m.username.toLowerCase());
            return (
              <button key={m.userId} type="button" data-testid={`add-member-pick-${groupId}-${m.userId}`} disabled={inTeam} onClick={() => { setAddMemberTeam(null); setAddMemberFilter(""); run(() => addCqbTeamMember(op.id, groupId, m.userId, csrf)); }} style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", textAlign: "left", padding: "0.35rem 0.5rem", border: "1px solid var(--edge-gold)", background: inTeam ? "transparent" : "var(--tint-gold)", borderRadius: 7, cursor: inTeam ? "default" : "pointer", color: "inherit", fontFamily: "inherit", marginBottom: "0.25rem", opacity: inTeam ? 0.5 : 1 }}>
                <Avatar name={m.username} />
                <span style={{ flex: 1, fontSize: "0.84rem", color: "var(--text-hi)" }}>{m.username}</span>
                {!m.isHost && <span style={{ fontFamily: MONO, fontSize: "0.55rem", color: "var(--dim2)" }}>{(m.guildName || "PARTNER").toUpperCase()}</span>}
                <span style={{ fontFamily: MONO, fontSize: "0.58rem", color: inTeam ? "var(--dim3)" : "var(--gold)" }}>{inTeam ? "DABEI" : "HINZUFÜGEN"}</span>
              </button>
            );
          })}
      </div>
    );
  };
  const cqbBlock = (cqbTeams.length > 0 || cqbSoldiers.length > 0) && (
    <section style={{ ...card, marginBottom: "1.6rem", border: "1px solid var(--edge-gold)" }} data-testid="cqb-block">
      {panelHead("fps", "var(--gold)", "CQB-TEAMS · SOLDATEN EINTEILEN", (
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
          {/* Chunk everyone still unassigned into squads of the chosen size. The
              teams are ordinary CQB teams afterwards — rename, move, dissolve. */}
          <select
            data-testid="cqb-bundle-size"
            aria-label="Squad-Größe für das automatische Bündeln"
            value={bundleSize}
            onChange={(e) => setBundleSize(Number(e.target.value))}
            style={{ background: "var(--bg3)", border: "1px solid var(--edge-gold)", color: "var(--text)", fontFamily: MONO, fontSize: "0.6rem", padding: "0.18rem 0.3rem", borderRadius: 6, outline: "none" }}
          >
            {[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}er</option>)}
          </select>
          <button
            type="button"
            data-testid="cqb-auto-bundle"
            title="Alle noch nicht eingeteilten Soldaten in Squads der gewählten Größe aufteilen"
            disabled={cqbSoldiers.every((s) => s.assignedGroupId)}
            onClick={() => run(() => autoBundleCqb(op.id, csrf, bundleSize))}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "0.2rem 0.5rem", border: "1px solid var(--edge-gold)", background: "var(--tint-gold)", color: "var(--gold)", fontFamily: MONO, fontSize: "0.6rem", borderRadius: 6, cursor: "pointer" }}
          >
            <Ic name="swap" size={11} sw={2} /> Auto-Bündeln
          </button>
          <span style={{ fontFamily: MONO, fontSize: "0.64rem", color: "var(--dim3)" }}>{cqbSoldiers.filter((s) => s.assignedGroupId).length}/{cqbSoldiers.length} eingeteilt</span>
        </span>
      ))}
      {/* FR-B6 rename + FR-B3 carrier: list teams (carrier dropdown when ships exist). */}
      {cqbTeams.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginBottom: "0.9rem", paddingBottom: "0.8rem", borderBottom: "1px solid var(--wash)" }}>
          {cqbTeams.map((tm) => {
            const pickOpen = addMemberTeam === tm.id;
            return (
            <div key={tm.id} style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <div data-testid={`cqb-team-${tm.id}`} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input
                  className="fpw-inline-edit"
                  data-testid={`cqb-team-name-${tm.id}`}
                  key={`tmname:${tm.id}:${tm.name}`}
                  defaultValue={tm.name}
                  title="Squad umbenennen (Enter)"
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== tm.name) viewAct(`team-${tm.id}`, () => renameCqbTeam(op.id, tm.id, csrf, v), (vw) => ({ ...vw, cqbTeams: vw.cqbTeams.map((x) => (x.id === tm.id ? { ...x, name: v } : x)) })); }}
                  style={{ flex: 1, minWidth: 0, fontSize: "0.82rem" }}
                />
                <SaveDot id={`team-${tm.id}`} />
                <button type="button" data-testid={`cqb-add-member-${tm.id}`} title="Person diesem Team zuweisen" onClick={() => { setAddMemberTeam(pickOpen ? null : tm.id); setAddMemberFilter(""); }} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, padding: "0.22rem 0.5rem", border: `1px solid ${pickOpen ? "var(--edge-gold)" : "var(--edge-gold)"}`, background: "var(--tint-gold)", color: "var(--gold)", fontFamily: MONO, fontSize: "0.62rem", borderRadius: 6, cursor: "pointer" }}><Ic name="plus" size={11} sw={2} /> Person</button>
                <span style={{ fontFamily: MONO, fontSize: "0.58rem", color: "var(--dim3)", flexShrink: 0 }}>FÄHRT IN</span>
                <select
                  data-testid={`cqb-team-carrier-${tm.id}`}
                  value={tm.carrierUnitId ?? ""}
                  onChange={(e) => { const cu = e.target.value || null; viewAct(`team-${tm.id}`, () => assignCqbTeamCarrier(op.id, tm.id, csrf, cu), (vw) => ({ ...vw, cqbTeams: vw.cqbTeams.map((x) => (x.id === tm.id ? { ...x, carrierUnitId: cu } : x)) })); }}
                  style={{ flexShrink: 0, maxWidth: "40%", background: "var(--bg3)", border: "1px solid var(--edge-gold)", color: "var(--text)", fontFamily: MONO, fontSize: "0.64rem", padding: "0.22rem 0.4rem", borderRadius: 6, outline: "none" }}
                >
                  <option value="">— eigenständig —</option>
                  {accepted.filter((c) => c.unitType === "ship").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {parentSelect(tm.id, tm.parentId, `cqb-team-parent-${tm.id}`)}
                {/* Dissolving a team frees its members back into the pool — it
                    never removes anyone from the operation. */}
                <button
                  type="button"
                  data-testid={`cqb-team-dissolve-${tm.id}`}
                  title="Squad auflösen — die Soldaten gehen zurück in den Pool"
                  aria-label={`Squad ${tm.name} auflösen`}
                  onClick={() => run(() => dissolveCqbTeam(op.id, tm.id, csrf))}
                  style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 6, border: "1px solid var(--edge-red)", background: "var(--tint-red)", color: "var(--red)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                >
                  <Ic name="x" size={12} sw={2} />
                </button>
              </div>
              {pickOpen && memberPicker(tm.id)}
            </div>
            );
          })}
        </div>
      )}
      {cqbSoldiers.length === 0 ? (
        <div style={{ color: "var(--dim3)", fontSize: "0.8rem", fontFamily: MONO }}>Noch keine CQB-Anmeldungen.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {cqbSoldiers.map((s) => {
            const team = cqbTeams.find((t) => t.id === s.assignedGroupId);
            return (
              <div key={s.id} data-testid={`cqb-soldier-${s.id}`} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.45rem 0.6rem", borderRadius: 8, border: `1px solid ${team ? "var(--edge-green)" : "var(--edge-gold)"}`, background: team ? "var(--tint-green)" : "var(--tint-gold)" }}>
                <Avatar name={s.username} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: "0.86rem", color: "var(--text-hi)" }}>{s.username}</strong>
                  {s.note && <div style={{ color: "var(--dim2)", fontSize: "0.74rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.note}</div>}
                </div>
                {team && captainButton("person", s.id, s.slotIndex === 0, `cqb-captain-${s.id}`)}
                <LateArrival eta={s.lateEta} canEdit testid={`cqb-late-${s.id}`} onSet={(eta) => viewAct(`cqblate-${s.id}`, () => setCqbLateArrival(op.id, s.id, eta, csrf), (vw) => ({ ...vw, cqbSoldiers: vw.cqbSoldiers.map((x) => (x.id === s.id ? { ...x, lateEta: eta } : x)) }))} />
                <SaveDot id={`cqb-${s.id}`} />
                <select
                  data-testid={`cqb-assign-${s.id}`}
                  value={s.assignedGroupId ?? ""}
                  onChange={(e) => { const g = e.target.value || null; viewAct(`cqb-${s.id}`, () => assignCqbSoldier(op.id, s.id, csrf, g), (vw) => ({ ...vw, cqbSoldiers: vw.cqbSoldiers.map((x) => (x.id === s.id ? { ...x, assignedGroupId: g } : x)) })); }}
                  style={{ flexShrink: 0, maxWidth: "50%", background: "var(--bg3)", border: "1px solid var(--edge-gold)", color: "var(--text)", fontFamily: MONO, fontSize: "0.66rem", padding: "0.25rem 0.4rem", borderRadius: 6, outline: "none" }}
                >
                  <option value="">— kein Team —</option>
                  {cqbTeams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.targetSize ? ` (${cqbSoldiers.filter((x) => x.assignedGroupId === t.id).length}/${t.targetSize})` : ""}</option>)}
                </select>
                <button type="button" data-testid={`cqb-remove-${s.id}`} title="Aus CQB entfernen" onClick={() => run(() => removeCqbSoldier(op.id, s.id, csrf))} style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 6, border: "1px solid var(--edge-red)", background: "var(--tint-red)", color: "var(--red)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Ic name="x" size={12} sw={2} /></button>
              </div>
            );
          })}
        </div>
      )}
      {cqbTeams.length === 0 && cqbSoldiers.length > 0 && (
        <p style={{ margin: "0.7rem 0 0", color: "var(--dim2)", fontSize: "0.78rem" }}>Keine CQB-Teams definiert — lege unter „Bedarfe" CQB-Teams an, um Soldaten einzuteilen.</p>
      )}
    </section>
  );

  // Jäger-Staffeln: operator places pilots (persons, no ship needed) directly into
  // a fighter squad — mirrors CQB. Fighters with a ship bind via the board dropdown;
  // this manages the pilot roster + late-arrival.
  const fighterBlock = fighterFormations.length > 0 && (
    <section style={{ ...card, marginBottom: "1.6rem", border: "1px solid var(--border-hi)" }} data-testid="fighter-block">
      {panelHead("fighter", "var(--purple)", "JÄGER-STAFFELN · PILOTEN EINTEILEN", <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "0.6rem" }}><button type="button" data-testid="fighter-autofill" title="Alle noch nicht zugeteilten Jäger in die erste Staffel mit freiem Platz füllen" onClick={() => run(() => autoFillFighters(op.id, csrf))} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "0.2rem 0.5rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--purple)", fontFamily: MONO, fontSize: "0.6rem", borderRadius: 6, cursor: "pointer" }}><Ic name="swap" size={11} sw={2} /> Auto-Fill</button><span style={{ fontFamily: MONO, fontSize: "0.64rem", color: "var(--dim3)" }}>{fighterFormations.length} Staffeln</span></span>)}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        {fighterFormations.map((sq) => {
          const mem = cqbSoldiers.filter((s) => s.assignedGroupId === sq.id);
          const pickOpen = addMemberTeam === sq.id;
          const shipPilots = accepted.filter((u) => u.formationId === sq.id && u.shipClass === "Fighter").length;
          const filledF = shipPilots + mem.length;
          return (
            <div key={sq.id} data-testid={`fighter-squad-op-${sq.id}`} style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ color: "var(--purple)", display: "inline-flex", flexShrink: 0 }}><Ic name="fighter" size={14} sw={1.7} /></span>
                <strong style={{ flex: 1, minWidth: 0, fontSize: "0.85rem", color: "var(--text-hi)" }}>{sq.name}</strong>
                <span style={{ fontFamily: MONO, fontSize: "0.64rem", color: "var(--dim3)", flexShrink: 0 }}>{filledF} Jäger</span>
                {/* Legacy fallback groups (formations) have no parent. */}
                {parentSelect(sq.id, (sq as { parentId?: string | null }).parentId ?? null, `fighter-squad-parent-${sq.id}`)}
                <button type="button" data-testid={`fighter-add-member-${sq.id}`} title="Pilot dieser Staffel zuweisen" onClick={() => { setAddMemberTeam(pickOpen ? null : sq.id); setAddMemberFilter(""); }} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, padding: "0.22rem 0.5rem", border: `1px solid ${pickOpen ? "var(--border-hi)" : "var(--border-hi)"}`, background: "var(--wash)", color: "var(--purple)", fontFamily: MONO, fontSize: "0.62rem", borderRadius: 6, cursor: "pointer" }}><Ic name="plus" size={11} sw={2} /> Pilot</button>
              </div>
              {/* Fighters that came WITH a ship. Listed here too so the operator can
                  promote one to Staffel-Captain — the board only offers squad assignment. */}
              {accepted.filter((u) => u.formationId === sq.id && u.shipClass === "Fighter").map((u) => (
                <div key={u.id} data-testid={`fighter-unit-op-${u.id}`} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.35rem 0.5rem", borderRadius: 7, border: "1px solid var(--wash)", background: "var(--wash)" }}>
                  <span style={{ color: "var(--purple)", display: "inline-flex", flexShrink: 0 }}><Ic name="fighter" size={12} sw={1.7} /></span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: "0.82rem", color: "var(--text)" }}>{u.name}{u.captain ? ` · ${u.captain.username}` : ""}</span>
                  {captainButton("unit", u.id, u.formationSlot === 0, `fighter-unit-captain-${u.id}`)}
                  <SaveDot id={`slot-${u.id}`} />
                </div>
              ))}
              {mem.map((s) => (
                <div key={s.id} data-testid={`fighter-pilot-op-${s.id}`} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.35rem 0.5rem", borderRadius: 7, border: "1px solid var(--wash)", background: "var(--wash)" }}>
                  <Avatar name={s.username} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: "0.82rem", color: "var(--text)" }}>{s.username}</span>
                  {captainButton("person", s.id, s.slotIndex === 0, `fighter-captain-${s.id}`)}
                  <LateArrival eta={s.lateEta} canEdit testid={`fighter-late-${s.id}`} onSet={(eta) => viewAct(`cqblate-${s.id}`, () => setCqbLateArrival(op.id, s.id, eta, csrf), (vw) => ({ ...vw, cqbSoldiers: vw.cqbSoldiers.map((x) => (x.id === s.id ? { ...x, lateEta: eta } : x)) }))} />
                  <SaveDot id={`cqb-${s.id}`} />
                  <button type="button" title="Aus Staffel entfernen" onClick={() => viewAct(`cqb-${s.id}`, () => assignCqbSoldier(op.id, s.id, csrf, null), (vw) => ({ ...vw, cqbSoldiers: vw.cqbSoldiers.map((x) => (x.id === s.id ? { ...x, assignedGroupId: null } : x)) }))} style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 5, border: "1px solid var(--edge-red)", background: "var(--tint-red)", color: "var(--red)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Ic name="x" size={10} sw={2} /></button>
                </div>
              ))}
              {pickOpen && memberPicker(sq.id)}
            </div>
          );
        })}
      </div>
    </section>
  );

  // FR-B2: formations (Verbände) — create/delete; ships join via the per-unit
  // dropdown on the board. Counts show how many ships sit in each formation.
  // FR-B2/B3/B4: composition tree — show how it all fits together. Per formation
  // its ships, and under each ship what it carries (CQB teams that ride in it +
  // loaded vehicles). Ships without a formation list under "Ohne Verband".
  const carriedTeams = (shipId: string) => view.cqbTeams.filter((tm) => tm.carrierUnitId === shipId);
  const carriedVehicles = (shipId: string) => accepted.filter((u) => u.unitType === "vehicle" && u.carrierUnitId === shipId);
  // Verband-Zuordnung für ALLE Einheitstypen: group every accepted unit, not just ships.
  const formationUnits = (fid: string) => accepted.filter((u) => u.formationId === fid);
  const ungroupedUnits = accepted.filter((u) => !u.formationId);
  const unitMeta = (u: FleetUnit): [string, string] =>
    u.unitType === "ship" ? (u.shipClass === "Fighter" ? ["var(--purple)", "fighter"] : ["var(--cyan)", "ship"])
      : u.unitType === "squad" ? ["var(--gold)", "fps"]
        : u.unitType === "vehicle" ? ["var(--orange)", "vehicle"] : ["var(--dim)", "board"];
  // Editable composition row: type icon + name + a formation (Verband) select.
  const compUnitRow = (u: FleetUnit) => {
    const [color, icon] = unitMeta(u);
    const teams = u.unitType === "ship" ? carriedTeams(u.id) : [];
    const vehicles = u.unitType === "ship" ? carriedVehicles(u.id) : [];
    return (
      <div key={u.id} style={{ marginBottom: "0.3rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0.5rem", borderRadius: 7, border: "1px solid var(--wash)", background: "var(--wash)" }}>
          <span style={{ color, display: "inline-flex", flexShrink: 0 }}><Ic name={icon} size={13} sw={1.7} /></span>
          <span style={{ flex: 1, minWidth: 0, fontSize: "0.8rem", color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}{u.shipClass ? <span style={{ color: "var(--dim3)", fontFamily: MONO, fontSize: "0.6rem" }}> · {u.shipClass}</span> : null}</span>
          <SaveDot id={`unitfm-${u.id}`} />
          <select
            data-testid={`comp-formation-${u.id}`}
            value={u.formationId ?? ""}
            onChange={(e) => { const fid = e.target.value || null; boardAct(`unitfm-${u.id}`, (us) => us.map((x) => (x.id === u.id ? { ...x, formationId: fid } : x)), () => assignUnitFormation(op.id, u.id, csrf, fid)); }}
            style={{ flexShrink: 0, maxWidth: "9.5rem", background: "var(--bg3)", border: "1px solid var(--border-hi)", color: "var(--text)", fontFamily: MONO, fontSize: "0.62rem", padding: "0.2rem 0.4rem", borderRadius: 6, outline: "none" }}
          >
            <option value="">— ohne Staffel/Verband —</option>
            {view.fighterSquads.length > 0 && (
              <optgroup label="Staffeln">
                {view.fighterSquads.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </optgroup>
            )}
            {view.formations.length > 0 && (
              <optgroup label="Verbände">
                {view.formations.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        {(teams.length > 0 || vehicles.length > 0) && (
          <div style={{ marginLeft: "1.3rem", marginTop: "0.2rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
            {teams.map((tm) => (
              <div key={tm.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.76rem", color: "var(--dim)" }}>
                <span style={{ color: "var(--gold)" }}>⮡</span><Ic name="fps" size={11} sw={1.7} /> {tm.name} <span style={{ color: "var(--dim3)", fontSize: "0.62rem" }}>fährt mit</span>
              </div>
            ))}
            {vehicles.map((v) => (
              <div key={v.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.76rem", color: "var(--dim)" }}>
                <span style={{ color: "var(--orange)" }}>⮡</span><Ic name="vehicle" size={11} sw={1.7} /> {v.name} <span style={{ color: "var(--dim3)", fontSize: "0.62rem" }}>verladen</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const formationBlock = (
    <section style={{ ...card, marginBottom: "1.6rem", border: "1px solid var(--border-hi)" }} data-testid="formation-block">
      {panelHead("board", "var(--purple)", "VERBÄNDE", <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.64rem", color: "var(--dim3)" }}>{view.formations.length}</span>)}
      {view.formations.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.8rem" }}>
          {view.formations.map((f) => {
            const count = accepted.filter((u) => u.formationId === f.id).length;
            return (
              <div key={f.id} data-testid={`formation-${f.id}`} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.45rem 0.6rem", borderRadius: 8, border: "1px solid var(--border-hi)", background: "var(--wash)" }}>
                <span style={{ color: "var(--purple)", display: "inline-flex" }}><Ic name="board" size={14} /></span>
                <input
                  className="fpw-inline-edit"
                  data-testid={`formation-name-${f.id}`}
                  key={`fname:${f.id}:${f.name}`}
                  defaultValue={f.name}
                  title="Verband umbenennen (Enter)"
                  onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                  onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== f.name) viewAct(`fm-${f.id}`, () => renameFormation(op.id, f.id, csrf, v), (vw) => ({ ...vw, formations: vw.formations.map((x) => (x.id === f.id ? { ...x, name: v } : x)) })); }}
                  style={{ flex: 1, minWidth: 0, fontSize: "0.86rem" }}
                />
                <SaveDot id={`fm-${f.id}`} />
                <span style={{ fontFamily: MONO, fontSize: "0.64rem", color: "var(--dim)" }}>{count} Einheit{count === 1 ? "" : "en"}</span>
                <button type="button" data-testid={`formation-del-${f.id}`} title="Verband löschen" onClick={() => { setUnits((us) => us.map((x) => (x.formationId === f.id ? { ...x, formationId: null } : x))); viewAct(`fm-${f.id}`, () => deleteFormation(op.id, f.id, csrf), (vw) => ({ ...vw, formations: vw.formations.filter((x) => x.id !== f.id) })); }} style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, border: "1px solid var(--edge-red)", background: "var(--tint-red)", color: "var(--red)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Ic name="x" size={11} sw={2} /></button>
              </div>
            );
          })}
        </div>
      )}
      {/* ZUSAMMENSETZUNG — assign EVERY unit type (ship/fighter/squad/vehicle) to a Verband. */}
      {accepted.length > 0 && (
        <div style={{ borderTop: "1px solid var(--wash)", paddingTop: "0.8rem", marginBottom: "0.9rem" }}>
          <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.1em", color: "var(--dim)", marginBottom: "0.2rem" }}>ZUSAMMENSETZUNG — EINHEITEN ZUORDNEN</div>
          <div style={{ fontSize: "0.72rem", color: "var(--dim3)", marginBottom: "0.6rem" }}>Schiffe, Jäger, Fahrzeuge und Bodentruppen einer Staffel oder einem Verband zuordnen — sofort gespeichert.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
            {/* Both group kinds — otherwise units sitting in a Bedarf-Staffel show
                up as "ohne Zuordnung" here even though they are assigned. */}
            {[...view.fighterSquads, ...view.formations].map((f) => (
              <div key={f.id}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.3rem" }}>
                  <span style={{ color: "var(--purple)", display: "inline-flex" }}><Ic name="board" size={13} /></span>
                  <strong style={{ fontSize: "0.8rem", color: "var(--purple)" }}>{f.name}</strong>
                  <span style={{ fontFamily: MONO, fontSize: "0.6rem", color: "var(--dim3)" }}>{formationUnits(f.id).length} Einheit{formationUnits(f.id).length === 1 ? "" : "en"}</span>
                </div>
                <div style={{ marginLeft: "0.4rem" }}>
                  {formationUnits(f.id).length > 0
                    ? formationUnits(f.id).map(compUnitRow)
                    : <div style={{ fontSize: "0.74rem", color: "var(--dim3)", fontStyle: "italic" }}>keine Einheiten</div>}
                </div>
              </div>
            ))}
            {ungroupedUnits.length > 0 && (
              <div>
                {view.formations.length > 0 && (
                  <div style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.06em", color: "var(--dim3)", marginBottom: "0.3rem" }}>OHNE VERBAND</div>
                )}
                <div style={{ marginLeft: "0.4rem" }}>{ungroupedUnits.map(compUnitRow)}</div>
              </div>
            )}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input
          type="text"
          data-testid="formation-name"
          value={newFormation}
          maxLength={80}
          placeholder="Verbandsname (z. B. Task Force Alpha)"
          onChange={(e) => setNewFormation(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newFormation.trim()) { run(() => createFormation(op.id, csrf, newFormation.trim())); setNewFormation(""); } }}
          style={{ flex: "1 1 200px", boxSizing: "border-box", background: "var(--bg3)", border: "1px solid var(--border-hi)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.86rem", padding: "0.4rem 0.55rem", borderRadius: 7, outline: "none" }}
        />
        <button type="button" data-testid="formation-add" disabled={!newFormation.trim()} onClick={() => { run(() => createFormation(op.id, csrf, newFormation.trim())); setNewFormation(""); }} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, padding: "0.4rem 0.7rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--purple)", fontFamily: MONO, fontSize: "0.7rem", borderRadius: 7, cursor: "pointer" }}><Ic name="plus" size={12} sw={2} /> Verband</button>
      </div>
    </section>
  );

  const boardBlock = (
    <>
      <div style={{ fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.14em", color: "var(--dim)", marginBottom: "1rem" }}>
        FLOTTEN-BOARD <span style={{ color: "var(--dim3)" }}>· Platz anklicken oder Person draufziehen</span>
      </div>
      <div className="fpw-board" style={{ gap: "0.85rem" }}>
        {lanes.map((lane) => (
          <div key={lane.type} style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginBottom: "0.8rem", paddingBottom: "0.5rem", borderBottom: `1px solid ${tint(lane.accent, 40)}` }}>
              <span style={{ color: lane.accent, display: "inline-flex", flexShrink: 0 }}><Ic name={lane.icon} size={15} /></span>
              <span style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: "0.68rem", letterSpacing: "0.06em", color: lane.accent, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lane.label}</span>
              <span style={{ fontFamily: MONO, fontSize: "0.72rem", color: "var(--dim)", flexShrink: 0 }}>{lane.units.reduce((a, u) => a + u.seats.filter((s) => s.claimedBy).length, 0)}/{lane.units.reduce((a, u) => a + u.seats.filter((s) => s.active).length, 0)}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
              {lane.units.map((u) => (
                <div key={u.id} style={{ border: `1px solid ${tint(lane.accent, 16)}`, borderRadius: 13, background: "var(--row)", padding: "1rem 1.1rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.7rem" }}>
                    <span style={{ width: 36, height: 36, borderRadius: 9, background: tint(lane.accent, 10), border: `1px solid ${tint(lane.accent, 26)}`, color: lane.accent, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic name={lane.icon} size={18} sw={1.6} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontWeight: 700, fontSize: "1.02rem", color: "var(--text-hi)", lineHeight: 1.15 }}>{u.name}</strong>
                      <div style={{ color: "var(--dim2)", fontSize: "0.78rem", marginTop: 1 }}>{u.shipClass ?? u.unitType}{u.captain ? ` · ${u.captain.username}` : ""}</div>
                    </div>
                    <span style={{ fontFamily: MONO, fontSize: "0.95rem", color: "var(--text-hi)", flexShrink: 0 }}>{u.seats.filter((s) => s.claimedBy).length}<span style={{ color: "var(--dim3)", fontSize: "0.8rem" }}>/{u.seats.filter((s) => s.active).length}</span></span>
                    <button type="button" data-testid={`unit-remove-${u.id}`} title="Einheit entfernen" onClick={() => { if (window.confirm(`„${u.name}" aus der Operation entfernen?`)) run(() => withdrawUnit(op.id, u.id, csrf)); }} style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 6, border: "1px solid var(--edge-red)", background: "var(--tint-red)", color: "var(--red)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Ic name="x" size={12} sw={2} /></button>
                  </div>
                  {(requirements.length > 0 || view.formations.length > 0 || u.unitType === "vehicle") && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
                      {requirements.length > 0 && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", minWidth: 0, maxWidth: "100%" }}>
                          <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.06em", color: "var(--dim3)", flexShrink: 0 }}>BEDARF</span>
                          {reqSelect(u, u.requirementId ?? "", (id) => boardAct(`unitfm-${u.id}`, (us) => us.map((x) => (x.id === u.id ? { ...x, requirementId: id || null } : x)), () => patchUnit(op.id, u.id, csrf, { requirementId: id || null })), `unit-req-${u.id}`)}
                        </span>
                      )}
                      {/* Rolle in dieser Op. Überschreibt die Katalog-Ableitung und
                          verschiebt die Einheit damit auch zwischen den Board-Lanes. */}
                      {u.unitType === "ship" && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", minWidth: 0, maxWidth: "100%" }}>
                          <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.06em", color: "var(--dim3)", flexShrink: 0 }}>ROLLE</span>
                          <select
                            data-testid={`unit-role-${u.id}`}
                            value={u.roleOverride ?? ""}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => { const r = (e.target.value || null) as ShipClass | null; boardAct(`unitrole-${u.id}`, (us) => us.map((x) => (x.id === u.id ? { ...x, roleOverride: r, shipClass: r ?? x.shipClass } : x)), () => patchUnit(op.id, u.id, csrf, { roleOverride: r })); }}
                            style={{ minWidth: 0, maxWidth: "100%", background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: MONO, fontSize: "0.66rem", padding: "0.25rem 0.4rem", borderRadius: 6, outline: "none" }}
                          >
                            <option value="">— Katalog: {roleLabel(u.shipClass) || "unbekannt"} —</option>
                            {OFFERABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select>
                          <SaveDot id={`unitrole-${u.id}`} />
                        </span>
                      )}
                      {/* Staffel-/Verband-Zuordnung für ALLE Einheitstypen (Schiffe/Jäger/Bodentruppen/Fahrzeuge). */}
                      {(view.formations.length > 0 || view.fighterSquads.length > 0) && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", minWidth: 0, maxWidth: "100%" }}>
                          <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.06em", color: "var(--dim3)", flexShrink: 0 }}>STAFFEL / VERBAND</span>
                          <select
                            data-testid={`unit-formation-${u.id}`}
                            value={u.formationId ?? ""}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => { const fid = e.target.value || null; boardAct(`unitfm-${u.id}`, (us) => us.map((x) => (x.id === u.id ? { ...x, formationId: fid } : x)), () => assignUnitFormation(op.id, u.id, csrf, fid)); }}
                            style={{ minWidth: 0, maxWidth: "100%", background: "var(--bg3)", border: "1px solid var(--border-hi)", color: "var(--text)", fontFamily: MONO, fontSize: "0.66rem", padding: "0.25rem 0.4rem", borderRadius: 6, outline: "none" }}
                          >
                            <option value="">— kein —</option>
                            {/* Both kinds belong here: a fighter has to be assignable
                                to a Bedarf-Staffel, not just to a hand-built Verband. */}
                            {view.fighterSquads.length > 0 && (
                              <optgroup label="Staffeln">
                                {view.fighterSquads.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                              </optgroup>
                            )}
                            {view.formations.length > 0 && (
                              <optgroup label="Verbände">
                                {view.formations.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                              </optgroup>
                            )}
                          </select>
                          <SaveDot id={`unitfm-${u.id}`} />
                        </span>
                      )}
                      {u.unitType === "vehicle" && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", minWidth: 0, maxWidth: "100%" }}>
                          <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.06em", color: "var(--dim3)", flexShrink: 0 }}>TRÄGER</span>
                          <select
                            data-testid={`unit-carrier-${u.id}`}
                            value={u.carrierUnitId ?? ""}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => run(() => assignUnitCarrier(op.id, u.id, csrf, e.target.value || null))}
                            style={{ minWidth: 0, maxWidth: "100%", background: "var(--bg3)", border: "1px solid var(--edge-gold)", color: "var(--text)", fontFamily: MONO, fontSize: "0.66rem", padding: "0.25rem 0.4rem", borderRadius: 6, outline: "none" }}
                          >
                            <option value="">— eigenständig —</option>
                            {accepted.filter((c) => c.unitType === "ship").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </span>
                      )}
                    </div>
                  )}
                  {/* FR-A2: rename a squad + set a captain note (patchUnit). */}
                  {u.unitType === "squad" && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
                      <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.06em", color: "var(--dim3)", flexShrink: 0 }}>SQUAD</span>
                      <input
                        className="fpw-inline-edit"
                        data-testid={`unit-name-${u.id}`}
                        key={`name:${u.id}:${u.squadName ?? ""}`}
                        defaultValue={u.squadName ?? ""}
                        placeholder="Squad-Name"
                        title="Squad umbenennen (Enter)"
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                        onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== u.squadName) run(() => patchUnit(op.id, u.id, csrf, { squadName: v })); }}
                      />
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.6rem" }}>
                    <span style={{ color: "var(--gold)", display: "inline-flex", flexShrink: 0 }}><Ic name="bolt" size={13} /></span>
                    <input
                      className="fpw-inline-edit"
                      data-testid={`unit-note-${u.id}`}
                      key={`note:${u.id}:${u.captainNote ?? ""}`}
                      defaultValue={u.captainNote ?? ""}
                      maxLength={280}
                      placeholder="Captain-Notiz (z. B. Treffen an Gate 3)…"
                      title="Notiz setzen (Enter)"
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v !== (u.captainNote ?? "")) run(() => patchUnit(op.id, u.id, csrf, { captainNote: v || null })); }}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>{u.seats.map((s) => opSeatRow(u, s))}</div>
                </div>
              ))}
              {lane.placeholders.map((ph, i) => (
                <div key={`ph-${lane.type}-${i}`} data-testid="need-slot" style={{ border: `1px dashed ${tint(lane.accent, 40)}`, borderRadius: 13, background: "var(--wash)", padding: "0.9rem 1rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, background: tint(lane.accent, 7), border: `1px dashed ${tint(lane.accent, 40)}`, color: lane.accent, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic name={lane.icon} size={16} sw={1.5} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: "0.92rem", color: "var(--text)" }}>{ph.label}</strong>
                    <div style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.08em", color: lane.accent, marginTop: 1 }}>BEDARF · UNERFÜLLT</div>
                  </div>
                  {ph.onRemove && (
                    <button type="button" data-testid={`need-remove-${ph.key}`} title="Bedarf entfernen" onClick={ph.onRemove} style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, border: "1px solid var(--edge-red)", background: "var(--tint-red)", color: "var(--red)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Ic name="x" size={11} sw={2} /></button>
                  )}
                </div>
              ))}
              {lane.units.length === 0 && lane.placeholders.length === 0 && (
                <div data-testid={`lane-empty-${lane.type}`} style={{ border: "1px dashed var(--wash)", borderRadius: 13, background: "var(--wash)", padding: "1.3rem 1rem", textAlign: "center", fontFamily: MONO, fontSize: "0.64rem", letterSpacing: "0.08em", color: "var(--dim3)" }}>KEIN BEDARF</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );

  const toolsBlock = (
    <div style={{ marginTop: "1.2rem" }}>
      <button type="button" onClick={() => setToolsOpen((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.85rem", border: "1px solid var(--border)", background: "var(--wash)", color: "var(--dim)", fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.03em", borderRadius: 8, cursor: "pointer" }}>
        <span style={{ display: "inline-flex", transform: toolsOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}><Ic name="chevron" size={14} /></span>
        Werkzeuge / Aktivität
      </button>
      {toolsOpen && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "0.9rem" }}>
          <section style={{ ...card, flex: "1 1 300px", minWidth: 0 }}>
            <div style={railLabel}>AKTIVITÄT</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {view.auditLogs.length === 0 && <div style={{ color: "var(--dim3)", fontSize: "0.8rem" }}>—</div>}
              {view.auditLogs.slice(0, 12).map((a, i) => (
                <div key={i} style={{ display: "flex", gap: "0.6rem", padding: "0.32rem 0", borderBottom: "1px solid var(--wash)", fontSize: "0.82rem" }}>
                  <span style={{ fontFamily: MONO, fontSize: "0.7rem", color: "var(--dim3)", flexShrink: 0 }}>{new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(a.createdAt))}</span>
                  <span style={{ color: "var(--text)" }}><strong style={{ color: "var(--text-hi)" }}>{a.actor}</strong> {a.action}{a.detail && <span style={{ color: "var(--dim2)" }}> · {a.detail}</span>}</span>
                </div>
              ))}
            </div>
          </section>
          <section style={{ ...card, flex: "1 1 300px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}><span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="eye" size={15} /></span><span style={{ fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.12em", color: "var(--dim)" }}>HANGAR-FREIGABEN</span></div>
            <p style={{ margin: "0 0 0.9rem", color: "var(--dim2)", fontSize: "0.78rem" }}>Nur für Operatoren sichtbar.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
              {view.hangarShares.length === 0 && <div style={{ color: "var(--dim3)", fontSize: "0.8rem" }}>Noch keine Freigaben.</div>}
              {view.hangarShares.map((h) => (
                <div key={h.userId} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "0.7rem 0.8rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: h.ships.length ? "0.55rem" : 0 }}><Avatar name={h.username} /><strong style={{ fontSize: "0.9rem", color: "var(--text-hi)" }}>{h.username}</strong><span style={{ fontFamily: MONO, fontSize: "0.64rem", color: "var(--dim3)" }}>{h.ships.length} Schiffe</span></div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>{h.ships.map((sh) => <span key={sh.id} style={{ fontFamily: MONO, fontSize: "0.7rem", color: "var(--text)", border: "1px solid var(--border)", background: "var(--bg3)", padding: "0.22rem 0.5rem", borderRadius: 5 }}>{sh.name}</span>)}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );

  const placeBanner = placing && (
    <div style={{ position: "sticky", top: 58, zIndex: 60, display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.7rem 1rem", marginBottom: "1.1rem", border: "1px solid var(--edge-gold)", background: "var(--bg2)", borderRadius: 10 }}>
      <span style={{ color: "var(--gold)", display: "inline-flex", flexShrink: 0 }}><Ic name="swap" size={17} sw={1.8} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.12em", color: "var(--gold)" }}>EINTEILEN-MODUS</span>
        <div style={{ color: "var(--text-hi)", fontSize: "0.92rem", marginTop: 1 }}><strong>{placing.name}</strong> — wähle unten einen offenen Platz <span style={{ color: "var(--gold)" }}>(grün markiert)</span>. Tab springt von Platz zu Platz, Enter setzt, Escape bricht ab.</div>
      </div>
      <button type="button" data-testid="place-cancel" onClick={() => { setPlacing(null); setLive("Einteilen abgebrochen."); }} style={{ flexShrink: 0, padding: "0.42rem 0.8rem", border: "1px solid var(--wash)", background: "transparent", color: "var(--dim)", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 7, cursor: "pointer" }}>Abbrechen</button>
    </div>
  );

  // One polite live region per console: every place/drag transition, success and
  // failure is announced here (§7.3) — the highlight alone is not the message.
  const liveRegion = (
    <div className="fpw-sr-only" role="status" aria-live="polite" data-testid="board-live">{live}</div>
  );

  // Redesign: each console tab renders one section. "fleet" = board + right rail;
  // the rest are their own tabs (CQB / Verbände / Fragen).
  if (section === "cqb")
    return <div data-testid="operator-panel">{liveRegion}{placeBanner}{pendingBlock}{fighterBlock}{cqbBlock || <section style={card}><div style={{ color: "var(--dim3)", fontSize: "0.8rem", fontFamily: MONO }}>Noch keine CQB-Anmeldungen.</div></section>}</div>;
  if (section === "formations")
    return <div data-testid="operator-panel">{liveRegion}{formationBlock}</div>;
  if (section === "qa")
    return <div data-testid="operator-panel">{liveRegion}{qaPanel}</div>;

  // section === "fleet"
  return (
    <div data-testid="operator-panel">
      {liveRegion}
      {placeBanner}
      <div style={{ display: "flex", gap: "1.3rem", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 420px", minWidth: 0 }}>
          <section style={{ ...card, marginBottom: "1.3rem", padding: "1rem 1.2rem" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.7rem 1.4rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}><span style={{ fontFamily: MONO, fontSize: "1.5rem", color: "var(--text-hi)", lineHeight: 1 }}>{fillPct}%</span><span style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.1em", color: "var(--dim3)" }}>BESETZT</span></div>
              <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {bars.map((b) => (
                  <div key={b.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.22rem" }}><span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.74rem", color: "var(--text)" }}><span style={{ width: 8, height: 8, borderRadius: 2, background: b.accent }} />{b.label}</span><span style={{ fontFamily: MONO, fontSize: "0.72rem", color: "var(--dim)" }}>{b.f}/{b.t}</span></div>
                    <div style={{ height: 5, borderRadius: 4, background: "var(--bg3)", overflow: "hidden" }}><div style={{ height: "100%", width: `${b.pct}%`, background: b.accent, borderRadius: 4 }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </section>
          {pendingBlock}
          {boardBlock}
          {toolsBlock}
        </div>
        <aside style={{ flex: "0 0 332px", maxWidth: "100%", position: "sticky", top: 84, alignSelf: "flex-start", display: "flex", flexDirection: "column", gap: "1rem" }}>
          {flexPanel}
          {interestPanel}
          {needsPanel}
          {!embedded && actionsPanel}
        </aside>
      </div>
    </div>
  );
}
