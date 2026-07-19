import { useEffect, useState, type ReactNode } from "react";
import {
  addLeader,
  ApiError,
  answerQuestion,
  addCqbTeamMember,
  assignCqbSoldier,
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
  getGuildSettings,
  getOperatorView,
  patchSeat,
  patchUnit,
  removeLeader,
  removeNeed,
  setFighterSquads,
  unassignSeat,
  withdrawUnit,
} from "../api/client";
import type { FleetUnit, GuildSettingsMember, OperationDetail, OperatorView } from "../api/types";
import { Ic } from "./Icons";
import { Avatar } from "./Avatar";
import { LateArrival } from "./LateArrival";
import { SaveDot, useFieldSave } from "./fieldSave";

const MONO = "var(--mono)";

const LANES = [
  { type: "ship", label: "SCHIFFE & CREW", icon: "ship", accent: "#00d4ff", rgb: "0,212,255" },
  { type: "fighter", label: "JÄGER", icon: "fighter", accent: "#a78bfa", rgb: "167,139,250" },
  { type: "squad", label: "BODENTRUPPEN", icon: "fps", accent: "#f0a500", rgb: "240,165,0" },
  { type: "vehicle", label: "FAHRZEUGE", icon: "vehicle", accent: "#ff7a45", rgb: "255,122,69" },
] as const;

// Board lane for a unit. Fighter-class ships get their own lane (the user wants
// fighters as a distinct class, not lumped with capital ships); everything else
// buckets by unitType.
function laneOf(u: FleetUnit): string {
  if (u.unitType === "ship") return u.shipClass === "Fighter" ? "fighter" : "ship";
  return u.unitType;
}

const card: React.CSSProperties = { border: "1px solid rgba(0,212,255,0.13)", borderRadius: 14, background: "#090f18", padding: "1.1rem 1.2rem" };
const railLabel: React.CSSProperties = { fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.12em", color: "#9fb1c2", marginBottom: "0.7rem" };
const opActBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "flex-start", padding: "0.6rem 0.8rem", fontFamily: MONO, fontSize: "0.74rem", letterSpacing: "0.03em", borderRadius: 8, cursor: "pointer", border: "1px solid rgba(0,212,255,0.18)", background: "rgba(0,212,255,0.04)", color: "#c2d2de", textDecoration: "none" };
const panelHead = (icon: string, color: string, label: string, right?: ReactNode) => (
  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.8rem" }}>
    <span style={{ color, display: "inline-flex" }}><Ic name={icon} size={15} /></span>
    <span style={{ fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.1em", color: color === "#f0a500" ? "#f0a500" : "#9fb1c2" }}>{label}</span>
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
  const [leaderPick, setLeaderPick] = useState(false);

  const [members, setMembers] = useState<GuildSettingsMember[] | null>(null);
  const [memberFilter, setMemberFilter] = useState("");
  // #5: per-CQB-team "add any person" picker — teamId whose picker is open + search.
  const [addMemberTeam, setAddMemberTeam] = useState<string | null>(null);
  const [addMemberFilter, setAddMemberFilter] = useState("");
  // Per-pending-unit chosen Bedarf at accept time (defaults to a suggested slot).
  const [acceptReq, setAcceptReq] = useState<Record<string, string>>({});
  const [newFormation, setNewFormation] = useState(""); // FR-B2 create-formation input

  function reload() {
    getOperatorView(op.id)
      .then(setView)
      .catch((e) => onError(e instanceof ApiError ? e.message : "Operator-Daten nicht ladbar."));
  }
  useEffect(reload, [op.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep the optimistic board copy in sync with server reloads.
  useEffect(() => { setUnits(op.units); }, [op]);

  // Guild members for the seat picker (assign anyone, not just flex signups).
  useEffect(() => {
    getGuildSettings(op.guild.id).then((r) => setMembers(r.members)).catch(() => setMembers([]));
  }, [op.guild.id]);

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

  // Assign a user to a seat, optimistically (board action).
  const assignSeatOptimistic = (seatId: string, userId: string, username: string) =>
    boardAct(`seat-${seatId}`, (us) => mapSeat(us, seatId, (x) => ({ ...x, claimedBy: { id: userId, username } })), () => assignSeat(op.id, seatId, userId, csrf));


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
  const flexWaiting = view?.crewRequests.length ?? 0;
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
      style={{ maxWidth: "100%", background: "#0e1926", border: "1px solid rgba(0,212,255,0.18)", color: "#ccdde8", fontFamily: MONO, fontSize: "0.66rem", padding: "0.25rem 0.4rem", borderRadius: 6, outline: "none" }}
    >
      <option value="">— kein Bedarf —</option>
      {reqChoices(u).map((r) => (
        <option key={r.id} value={r.id}>{r.label} ({r.filled}/{r.count})</option>
      ))}
    </select>
  );

  // ── operator seat row (board): place-mode target / picker / drop target ──
  const opSeatRow = (u: FleetUnit, s: FleetUnit["seats"][number]) => {
    const isTarget = (!!placing || !!dragUserId) && !s.claimedBy && s.active;
    return (
      <div key={s.id} style={{ border: isTarget ? "1px solid rgba(0,255,136,0.55)" : "1px solid rgba(0,212,255,0.06)", borderRadius: 9, overflow: "hidden", opacity: s.active ? 1 : 0.55, transition: "border-color .12s" }}>
        <div
          data-testid={!s.claimedBy && s.active ? `op-target-${s.id}` : undefined}
          onClick={() => {
            if (s.claimedBy || !s.active) return;
            if (placing) assignSeatOptimistic(s.id, placing.userId, placing.name);
            else setPicker(picker === s.id ? null : s.id);
          }}
          onDragOver={(e) => {
            if (!s.claimedBy && s.active && dragUserId) e.preventDefault();
          }}
          onDrop={(e) => {
            if (s.claimedBy || !s.active) return;
            e.preventDefault();
            // Only flex persons (CrewAssignmentRequest) drop onto seats. A pending
            // UNIT is a ship/squad whose captain auto-seats in its own seat on accept,
            // so it has no meaningful single-seat target — use "Annehmen" instead.
            let uid = dragUserId;
            if (!uid) { try { uid = e.dataTransfer.getData("text/plain") || null; } catch { uid = null; } }
            if (!uid) return;
            const name = view?.crewRequests.find((r) => r.userId === uid)?.username ?? "—";
            assignSeatOptimistic(s.id, uid, name);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.7rem",
            padding: "0.55rem 0.65rem",
            background: "rgba(255,255,255,0.013)",
            minWidth: 0,
            cursor: s.claimedBy ? "default" : "pointer",
            boxShadow: isTarget ? "0 0 0 1px rgba(0,255,136,0.5)" : "none",
          }}
        >
          <span style={{ width: 28, height: 28, borderRadius: 7, background: "#0e1926", border: "1px solid rgba(255,255,255,0.06)", color: "#9fb1c2", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Ic name={seatIcon(u, s.order)} size={15} sw={1.6} />
          </span>
          <input
            className="fpw-inline-edit"
            data-testid={`op-seat-label-${s.id}`}
            key={`${s.id}:${s.label}`}
            defaultValue={s.label}
            title="Sitz umbenennen (Enter)"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== s.label) boardAct(`seat-${s.id}`, (us) => mapSeat(us, s.id, (x) => ({ ...x, label: v })), () => patchSeat(op.id, s.id, csrf, { label: v })); }}
          />
          <span onClick={(e) => e.stopPropagation()}><SaveDot id={`seat-${s.id}`} /></span>
          {!s.claimedBy && (
            <button type="button" data-testid={`op-seat-toggle-${s.id}`} title={s.active ? "Sitz deaktivieren" : "Sitz aktivieren"} onClick={(e) => { e.stopPropagation(); boardAct(`seat-${s.id}`, (us) => mapSeat(us, s.id, (x) => ({ ...x, active: !x.active })), () => patchSeat(op.id, s.id, csrf, { active: !s.active })); }} style={{ flexShrink: 0, fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.05em", padding: "0.18rem 0.42rem", borderRadius: 5, cursor: "pointer", border: s.active ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(0,255,136,0.4)", background: s.active ? "transparent" : "rgba(0,255,136,0.08)", color: s.active ? "#7e92a4" : "#00ff88" }}>{s.active ? "AUS" : "AN"}</button>
          )}
          {s.claimedBy ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
              <Avatar name={s.claimedBy.username} />
              <span style={{ fontSize: "0.8rem", color: "#ccdde8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "6.5rem" }}>{s.claimedBy.username}</span>
              {s.order !== 0 && (
                <button type="button" data-testid={`op-free-${s.id}`} title="Platz freigeben" onClick={(e) => { e.stopPropagation(); boardAct(`seat-${s.id}`, (us) => mapSeat(us, s.id, (x) => ({ ...x, claimedBy: null })), () => unassignSeat(op.id, s.id, csrf)); }} style={{ flexShrink: 0, width: 21, height: 21, borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#7e92a4", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <Ic name="x" size={11} sw={2} />
                </button>
              )}
            </div>
          ) : isTarget ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, color: "#00ff88", fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.05em" }}>HIER <Ic name="arrow" size={13} sw={1.9} /></span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, color: "#00d4ff", fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.03em" }}><Ic name="plus" size={13} sw={1.9} /> Einteilen</span>
          )}
        </div>
        {picker === s.id && !s.claimedBy && !placing && (
          <div style={{ borderTop: "1px solid rgba(0,212,255,0.12)", padding: "0.6rem", display: "flex", flexDirection: "column", gap: "0.35rem", background: "#0a121c" }}>
            <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.1em", color: "#9fb1c2" }}>WER SOLL HIER REIN?</div>
            {view.crewRequests.length === 0 && <div style={{ color: "#5b6b7a", fontSize: "0.78rem" }}>Keine flexiblen Anmeldungen.</div>}
            {view.crewRequests.map((r) => (
              <button key={r.userId} type="button" data-testid={`op-pick-${r.userId}`} onClick={(e) => { e.stopPropagation(); assignSeatOptimistic(s.id, r.userId, r.username); }} style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", textAlign: "left", padding: "0.4rem 0.5rem", border: "1px solid rgba(240,165,0,0.28)", background: "rgba(240,165,0,0.05)", borderRadius: 7, cursor: "pointer", color: "inherit", fontFamily: "inherit" }}>
                <Avatar name={r.username} />
                <span style={{ flex: 1, fontSize: "0.84rem", color: "#eaf4fb" }}>{r.username}</span>
                <span style={{ fontFamily: MONO, fontSize: "0.6rem", color: "#f0a500" }}>FLEX</span>
              </button>
            ))}
            {/* assign ANY guild member (e.g. someone who confirmed by phone) */}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "0.4rem", marginTop: "0.1rem" }}>
              <input
                type="search"
                data-testid="op-pick-search"
                value={memberFilter}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setMemberFilter(e.target.value)}
                placeholder="Guild-Mitglied suchen…"
                style={{ width: "100%", boxSizing: "border-box", background: "#0e1926", border: "1px solid rgba(0,212,255,0.14)", color: "#ccdde8", fontFamily: "var(--body)", fontSize: "0.8rem", padding: "0.35rem 0.5rem", borderRadius: 7, outline: "none", marginBottom: "0.35rem" }}
              />
              {memberFilter.trim() && (members ?? [])
                .filter((m) => m.username.toLowerCase().includes(memberFilter.trim().toLowerCase()))
                .slice(0, 8)
                .map((m) => (
                  <button key={m.userId} type="button" data-testid={`op-pick-member-${m.userId}`} onClick={(e) => { e.stopPropagation(); assignSeatOptimistic(s.id, m.userId, m.username); }} style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", textAlign: "left", padding: "0.4rem 0.5rem", border: "1px solid rgba(0,212,255,0.2)", background: "rgba(0,212,255,0.04)", borderRadius: 7, cursor: "pointer", color: "inherit", fontFamily: "inherit", marginBottom: "0.25rem" }}>
                    <Avatar name={m.username} />
                    <span style={{ flex: 1, fontSize: "0.84rem", color: "#eaf4fb" }}>{m.username}</span>
                    <span style={{ fontFamily: MONO, fontSize: "0.6rem", color: "#00d4ff" }}>MITGLIED</span>
                  </button>
                ))}
            </div>
            <button type="button" onClick={(e) => { e.stopPropagation(); setPicker(null); }} style={{ padding: "0.4rem 0.6rem", border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#9fb1c2", fontFamily: MONO, fontSize: "0.64rem", borderRadius: 7, cursor: "pointer" }}>Schließen</button>
          </div>
        )}
      </div>
    );
  };

  // ── panels (shared between layouts) ──────────────────────────
  const flexPanel = (
    <section style={{ ...card, border: "1px solid rgba(240,165,0,0.22)" }}>
      {panelHead("swap", "#f0a500", "FLEXIBEL", <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.66rem", color: "#5b6b7a" }}>{flexWaiting} wartet</span>)}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {view.crewRequests.length === 0 ? (
          <div style={{ padding: "0.7rem", textAlign: "center", color: "#5b6b7a", fontSize: "0.8rem", fontFamily: MONO }}>Alle eingeteilt ✓</div>
        ) : (
          view.crewRequests.map((r) => {
            const isPlacing = placing?.userId === r.userId;
            return (
              <div
                key={r.userId}
                draggable
                onDragStart={(e) => { setDragUserId(r.userId); setPlacing(null); setPicker(null); try { e.dataTransfer.setData("text/plain", r.userId); e.dataTransfer.effectAllowed = "move"; } catch { /* noop */ } }}
                onDragEnd={() => setDragUserId(null)}
                style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.6rem 0.7rem", borderRadius: 9, cursor: "grab", opacity: dragUserId === r.userId ? 0.45 : 1, border: isPlacing ? "1px solid rgba(240,165,0,0.6)" : "1px solid rgba(255,255,255,0.06)", background: isPlacing ? "rgba(240,165,0,0.08)" : "transparent" }}
              >
                <Avatar name={r.username} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: "0.9rem", color: "#eaf4fb" }}>{r.username}</strong>
                  {r.note && <div style={{ color: "#7e92a4", fontSize: "0.76rem", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.note}</div>}
                </div>
                <button type="button" data-testid={`op-place-${r.userId}`} onClick={() => setPlacing(isPlacing ? null : { userId: r.userId, name: r.username })} style={{ flexShrink: 0, padding: "0.38rem 0.7rem", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.03em", border: isPlacing ? "1px solid rgba(255,68,68,0.45)" : "1px solid rgba(240,165,0,0.45)", background: isPlacing ? "rgba(255,68,68,0.08)" : "rgba(240,165,0,0.1)", color: isPlacing ? "#ff6b6b" : "#f0a500" }}>
                  {isPlacing ? "Abbrechen" : "Einteilen"}
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
    <section style={{ ...card, border: "1px solid rgba(88,166,255,0.22)" }} data-testid="interest-panel">
      {panelHead("users", "#58a6ff", "EVENT-INTERESSE", <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.62rem", color: "#5b6b7a" }}>{interests.length - interestUnknown} verknüpft · {interestUnknown} unbekannt</span>)}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
        {interests.map((e) => {
          const isPlacing = !!e.userId && placing?.userId === e.userId;
          return (
            <div key={e.id} data-testid={`interest-${e.id}`} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.5rem 0.65rem", borderRadius: 9, border: isPlacing ? "1px solid rgba(88,166,255,0.6)" : "1px solid rgba(255,255,255,0.06)", background: isPlacing ? "rgba(88,166,255,0.08)" : "transparent" }}>
              <Avatar name={e.displayName} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: "0.88rem", color: "#eaf4fb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{e.displayName}</strong>
                {!e.userId && <div style={{ fontFamily: MONO, fontSize: "0.58rem", color: "#7e92a4", marginTop: 1 }}>nicht verknüpft · muss sich einmal anmelden</div>}
              </div>
              {e.seated ? (
                <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, fontFamily: MONO, fontSize: "0.64rem", color: "#00ff88" }}><Ic name="check" size={12} sw={2} /> eingeteilt</span>
              ) : e.userId ? (
                <button type="button" data-testid={`interest-place-${e.id}`} onClick={() => setPlacing(isPlacing ? null : { userId: e.userId!, name: e.displayName })} style={{ flexShrink: 0, padding: "0.34rem 0.65rem", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: "0.68rem", border: isPlacing ? "1px solid rgba(255,68,68,0.45)" : "1px solid rgba(88,166,255,0.45)", background: isPlacing ? "rgba(255,68,68,0.08)" : "rgba(88,166,255,0.1)", color: isPlacing ? "#ff6b6b" : "#58a6ff" }}>{isPlacing ? "Abbrechen" : "Einteilen"}</button>
              ) : (
                <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: "0.6rem", color: "#5b6b7a", border: "1px solid rgba(255,255,255,0.1)", padding: "0.18rem 0.42rem", borderRadius: 5 }}>UNBEKANNT</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );

  const needsPanel = (
    <section style={card}>
      {panelHead("alert", "#00d4ff", "OFFENE BEDARFE", <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.66rem", color: "#5b6b7a" }}>{open} offen</span>)}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.42rem" }}>
        {lanes.flatMap((lane) =>
          lane.units
            .map((u) => ({ u, lane, openN: u.seats.filter((s) => !s.claimedBy && s.active).length }))
            .filter((x) => x.openN > 0)
            .map(({ u, lane, openN }) => (
              <div key={u.id} style={{ display: "flex", alignItems: "center", gap: "0.55rem", padding: "0.45rem 0.55rem", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: lane.accent, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.85rem", color: "#dce8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</div>
                  <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.04em", color: "#5b6b7a", marginTop: 1 }}>{lane.label}</div>
                </div>
                <span style={{ fontFamily: MONO, fontSize: "0.9rem", color: "#f0a500", flexShrink: 0 }}>{openN}</span>
              </div>
            )),
        )}
        {open === 0 && <div style={{ padding: "0.5rem", color: "#5b6b7a", fontSize: "0.8rem", fontFamily: MONO }}>Keine offenen Plätze ✓</div>}
      </div>
    </section>
  );

  const qaPanel = (
    <section style={card}>
      {panelHead("chat", "#00d4ff", "FRAGEN", openQ > 0 ? <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.58rem", color: "#f0a500", border: "1px solid rgba(240,165,0,0.4)", background: "rgba(240,165,0,0.08)", padding: "0.08rem 0.4rem", borderRadius: 10 }}>{openQ} offen</span> : undefined)}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {view.questions.length === 0 && <div style={{ color: "#5b6b7a", fontSize: "0.8rem", fontFamily: MONO }}>Keine Fragen.</div>}
        {view.questions.map((q) => (
          <div key={q.id} style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 9, padding: "0.6rem 0.65rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.4rem" }}><Avatar name={q.asker} /><strong style={{ fontSize: "0.82rem", color: "#eaf4fb" }}>{q.asker}</strong></div>
            <div style={{ color: "#c2d2de", fontSize: "0.84rem", lineHeight: 1.42, marginBottom: "0.5rem" }}>{q.body}</div>
            {q.answer ? (
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.45rem", padding: "0.45rem 0.55rem", border: "1px solid rgba(0,255,136,0.28)", background: "rgba(0,255,136,0.05)", borderRadius: 8 }}>
                <span style={{ color: "#00ff88", display: "inline-flex", flexShrink: 0, marginTop: 2 }}><Ic name="check" size={13} sw={2} /></span>
                <div style={{ minWidth: 0 }}><span style={{ fontFamily: MONO, fontSize: "0.6rem", color: "#00ff88" }}>{q.answeredBy ?? ""}</span><div style={{ color: "#c2d2de", fontSize: "0.82rem", lineHeight: 1.4 }}>{q.answer}</div></div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-end" }}>
                <textarea value={drafts[q.id] ?? ""} data-testid={`answer-input-${q.id}`} onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))} placeholder="Antwort…" style={{ flex: 1, minWidth: 0, minHeight: 36, background: "#0e1926", border: "1px solid rgba(0,212,255,0.14)", color: "#ccdde8", fontFamily: "var(--body)", fontSize: "0.84rem", padding: "0.42rem 0.55rem", borderRadius: 8, outline: "none", resize: "vertical" }} />
                <button type="button" data-testid={`answer-send-${q.id}`} disabled={!(drafts[q.id] ?? "").trim()} onClick={() => run(() => answerQuestion(op.id, q.id, drafts[q.id].trim(), csrf))} style={{ flexShrink: 0, padding: "0.5rem 0.65rem", border: "1px solid rgba(0,255,136,0.45)", background: "rgba(0,255,136,0.12)", color: "#00ff88", fontFamily: MONO, fontSize: "0.68rem", borderRadius: 8, cursor: "pointer" }}>Senden</button>
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
        <a href={`/fleetplanner/ops/${op.id}/manage?tab=overview`} style={opActBtn}><Ic name="board" size={14} /> Operation bearbeiten</a>
        <a href={`/fleetplanner/ops/${op.id}/manage?tab=fleet`} style={opActBtn}><Ic name="ship" size={14} /> Slots verwalten</a>
        <a href={`/fleetplanner/ops/${op.id}/manage?tab=needs`} style={opActBtn}><Ic name="alert" size={14} /> Bedarfe verwalten</a>
        <a href={`/fleetplanner/ops/${op.id}/manage?tab=admin`} style={opActBtn}><Ic name="bolt" size={14} /> Admin / Status</a>
      </div>
    </section>
  );

  const fillRingCard = (
    <section style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.9rem", marginBottom: bars.length ? "1rem" : 0 }}>
        <div style={{ width: 88, height: 88, borderRadius: "50%", flexShrink: 0, position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", background: `conic-gradient(#00ff88 ${fillPct * 3.6}deg, #0e1926 ${fillPct * 3.6}deg)` }}>
          <div style={{ position: "absolute", inset: 7, borderRadius: "50%", background: "#090f18", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: MONO, fontSize: "1.1rem", color: "#eaf4fb", lineHeight: 1 }}>{fillPct}%</span>
            <span style={{ fontFamily: MONO, fontSize: "0.48rem", letterSpacing: "0.1em", color: "#5b6b7a" }}>VOLL</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid rgba(0,255,136,0.4)", color: "#00ff88", background: "rgba(0,255,136,0.08)", fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.08em", padding: "0.16rem 0.45rem", borderRadius: 4, textTransform: "uppercase" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00ff88", boxShadow: "0 0 6px #00ff88" }} />{op.status}
          </span>
          <div style={{ fontWeight: 700, fontSize: "1rem", color: "#eaf4fb", marginTop: "0.4rem", lineHeight: 1.1 }}>{filled} / {total} Plätze</div>
          <div style={{ color: "#7e92a4", fontSize: "0.76rem", marginTop: 1 }}>{open} offen · {flexWaiting} flexibel</div>
        </div>
      </div>
      {bars.map((b) => (
        <div key={b.label} style={{ marginTop: "0.6rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.28rem" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", color: "#c2d2de" }}><span style={{ width: 8, height: 8, borderRadius: 2, background: b.accent }} />{b.label}</span>
            <span style={{ fontFamily: MONO, fontSize: "0.74rem", color: "#9fb1c2" }}>{b.f}/{b.t}</span>
          </div>
          <div style={{ height: 5, borderRadius: 4, background: "#0e1926", overflow: "hidden" }}><div style={{ height: "100%", width: `${b.pct}%`, background: b.accent, borderRadius: 4 }} /></div>
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
          <button type="button" data-testid="leader-add-toggle" onClick={() => setLeaderPick((v) => !v)} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, padding: "0.2rem 0.5rem", border: "1px solid rgba(0,212,255,0.28)", background: "rgba(0,212,255,0.05)", color: "#00d4ff", fontFamily: MONO, fontSize: "0.62rem", borderRadius: 6, cursor: "pointer" }}>
            <Ic name="plus" size={12} sw={2} /> Leiter
          </button>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {op.leaders.length === 0 && <div style={{ color: "#5b6b7a", fontSize: "0.8rem" }}>Keine Leiter ernannt.</div>}
        {op.leaders.map((l) => (
          <div key={l.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Avatar name={l.username} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.85rem", color: "#eaf4fb" }}>{l.username}</div>
              <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.04em", color: "#5b6b7a" }}>Leitung</div>
            </div>
            {canManageLeaders && (
              <button type="button" data-testid={`leader-remove-${l.id}`} title="Leiter entfernen" onClick={() => run(() => removeLeader(op.id, l.id, csrf))} style={{ flexShrink: 0, width: 21, height: 21, borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#7e92a4", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Ic name="x" size={11} sw={2} />
              </button>
            )}
          </div>
        ))}
      </div>
      {canManageLeaders && leaderPick && (
        <div style={{ marginTop: "0.7rem", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.1em", color: "#9fb1c2" }}>TEILNEHMER ERNENNEN</div>
          {leaderCandidates.length === 0 ? (
            <div style={{ color: "#5b6b7a", fontSize: "0.78rem" }}>Keine geeigneten Teilnehmer.</div>
          ) : (
            leaderCandidates.map((c) => (
              <button key={c.id} type="button" data-testid={`leader-cand-${c.id}`} onClick={() => run(() => addLeader(op.id, c.id, csrf))} style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", textAlign: "left", padding: "0.4rem 0.5rem", border: "1px solid rgba(0,212,255,0.2)", background: "rgba(0,212,255,0.04)", borderRadius: 7, cursor: "pointer", color: "inherit", fontFamily: "inherit" }}>
                <Avatar name={c.username} />
                <span style={{ flex: 1, fontSize: "0.84rem", color: "#eaf4fb" }}>{c.username}</span>
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
    <section style={{ ...card, marginBottom: "1.6rem", border: "1px solid rgba(240,165,0,0.22)" }} data-testid="pending-block">
      <div style={railLabel}>ANSTEHENDE EINHEITEN ({pendingUnits.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {pendingUnits.map((u) => {
          const sel = acceptReq[u.id] ?? suggestReqId(u);
          return (
          <div key={u.id} data-testid={`pending-${u.id}`} style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", padding: "0.6rem 0.7rem", background: "rgba(255,255,255,0.013)", border: "1px solid rgba(240,165,0,0.16)", borderRadius: 9 }}>
            <span style={{ flex: "1 1 160px", minWidth: 0, color: "#eaf4fb", fontWeight: 600 }}>{u.name} <span style={{ color: "#7e92a4", fontWeight: 400, fontSize: "0.84rem" }}>· {u.shipClass ?? u.unitType}{u.captain ? ` · ${u.captain.username}` : ""}</span></span>
            {requirements.length > 0 && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", color: "#9fb1c2", fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.04em" }}>
                BEDARF
                {reqSelect(u, sel, (id) => setAcceptReq((m) => ({ ...m, [u.id]: id })), `unit-bedarf-${u.id}`)}
              </label>
            )}
            <button type="button" data-testid={`accept-${u.id}`} onClick={() => boardAct(`pending-${u.id}`, (us) => us.map((x) => (x.id === u.id ? { ...x, status: "accepted" } : x)), () => decideUnit(op.id, u.id, "accept", csrf, sel || undefined))} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0.34rem 0.7rem", border: "1px solid rgba(0,255,136,0.45)", background: "rgba(0,255,136,0.1)", color: "#00ff88", fontFamily: MONO, fontSize: "0.66rem", borderRadius: 7, cursor: "pointer" }}><Ic name="check" size={12} sw={2} /> Annehmen</button>
            <button type="button" data-testid={`reject-${u.id}`} title="Ablehnen" onClick={() => run(() => decideUnit(op.id, u.id, "reject", csrf))} style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 6, border: "1px solid rgba(255,68,68,0.4)", background: "rgba(255,68,68,0.07)", color: "#ff6b6b", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Ic name="x" size={12} sw={2} /></button>
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
  const fighterSquads = view.fighterSquads;
  // Reusable "add any person" picker for a group (CQB team OR fighter squad).
  const memberPicker = (groupId: string) => {
    const alreadyIn = new Set(cqbSoldiers.filter((s) => s.assignedGroupId === groupId).map((s) => s.username.toLowerCase()));
    return (
      <div style={{ padding: "0.4rem 0.5rem", border: "1px solid rgba(240,165,0,0.25)", borderRadius: 8, background: "rgba(240,165,0,0.03)" }}>
        <input
          type="search"
          autoFocus
          data-testid={`add-member-search-${groupId}`}
          value={addMemberFilter}
          onChange={(e) => setAddMemberFilter(e.target.value)}
          placeholder="Person suchen (z.B. Sitz-Insasse einer Trägerin)…"
          style={{ width: "100%", boxSizing: "border-box", background: "#0e1926", border: "1px solid rgba(0,212,255,0.14)", color: "#ccdde8", fontFamily: "var(--body)", fontSize: "0.8rem", padding: "0.35rem 0.5rem", borderRadius: 7, outline: "none", marginBottom: "0.35rem" }}
        />
        {addMemberFilter.trim() && (members ?? [])
          .filter((m) => m.username.toLowerCase().includes(addMemberFilter.trim().toLowerCase()))
          .slice(0, 8)
          .map((m) => {
            const inTeam = alreadyIn.has(m.username.toLowerCase());
            return (
              <button key={m.userId} type="button" data-testid={`add-member-pick-${groupId}-${m.userId}`} disabled={inTeam} onClick={() => { setAddMemberTeam(null); setAddMemberFilter(""); run(() => addCqbTeamMember(op.id, groupId, m.userId, csrf)); }} style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", textAlign: "left", padding: "0.35rem 0.5rem", border: "1px solid rgba(240,165,0,0.22)", background: inTeam ? "transparent" : "rgba(240,165,0,0.05)", borderRadius: 7, cursor: inTeam ? "default" : "pointer", color: "inherit", fontFamily: "inherit", marginBottom: "0.25rem", opacity: inTeam ? 0.5 : 1 }}>
                <Avatar name={m.username} />
                <span style={{ flex: 1, fontSize: "0.84rem", color: "#eaf4fb" }}>{m.username}</span>
                <span style={{ fontFamily: MONO, fontSize: "0.58rem", color: inTeam ? "#5b6b7a" : "#f0a500" }}>{inTeam ? "DABEI" : "HINZUFÜGEN"}</span>
              </button>
            );
          })}
      </div>
    );
  };
  const cqbBlock = (cqbTeams.length > 0 || cqbSoldiers.length > 0) && (
    <section style={{ ...card, marginBottom: "1.6rem", border: "1px solid rgba(240,165,0,0.22)" }} data-testid="cqb-block">
      {panelHead("fps", "#f0a500", "CQB-TEAMS · SOLDATEN EINTEILEN", <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.64rem", color: "#5b6b7a" }}>{cqbSoldiers.filter((s) => s.assignedGroupId).length}/{cqbSoldiers.length} eingeteilt</span>)}
      {/* FR-B6 rename + FR-B3 carrier: list teams (carrier dropdown when ships exist). */}
      {cqbTeams.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginBottom: "0.9rem", paddingBottom: "0.8rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
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
                <button type="button" data-testid={`cqb-add-member-${tm.id}`} title="Person diesem Team zuweisen" onClick={() => { setAddMemberTeam(pickOpen ? null : tm.id); setAddMemberFilter(""); }} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, padding: "0.22rem 0.5rem", border: `1px solid ${pickOpen ? "rgba(240,165,0,0.6)" : "rgba(240,165,0,0.35)"}`, background: "rgba(240,165,0,0.08)", color: "#f0a500", fontFamily: MONO, fontSize: "0.62rem", borderRadius: 6, cursor: "pointer" }}><Ic name="plus" size={11} sw={2} /> Person</button>
                <span style={{ fontFamily: MONO, fontSize: "0.58rem", color: "#5b6b7a", flexShrink: 0 }}>FÄHRT IN</span>
                <select
                  data-testid={`cqb-team-carrier-${tm.id}`}
                  value={tm.carrierUnitId ?? ""}
                  onChange={(e) => { const cu = e.target.value || null; viewAct(`team-${tm.id}`, () => assignCqbTeamCarrier(op.id, tm.id, csrf, cu), (vw) => ({ ...vw, cqbTeams: vw.cqbTeams.map((x) => (x.id === tm.id ? { ...x, carrierUnitId: cu } : x)) })); }}
                  style={{ flexShrink: 0, maxWidth: "40%", background: "#0e1926", border: "1px solid rgba(255,122,69,0.28)", color: "#ccdde8", fontFamily: MONO, fontSize: "0.64rem", padding: "0.22rem 0.4rem", borderRadius: 6, outline: "none" }}
                >
                  <option value="">— eigenständig —</option>
                  {accepted.filter((c) => c.unitType === "ship").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {pickOpen && memberPicker(tm.id)}
            </div>
            );
          })}
        </div>
      )}
      {cqbSoldiers.length === 0 ? (
        <div style={{ color: "#5b6b7a", fontSize: "0.8rem", fontFamily: MONO }}>Noch keine CQB-Anmeldungen.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {cqbSoldiers.map((s) => {
            const team = cqbTeams.find((t) => t.id === s.assignedGroupId);
            return (
              <div key={s.id} data-testid={`cqb-soldier-${s.id}`} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.45rem 0.6rem", borderRadius: 8, border: `1px solid ${team ? "rgba(0,255,136,0.2)" : "rgba(240,165,0,0.2)"}`, background: team ? "rgba(0,255,136,0.04)" : "rgba(240,165,0,0.04)" }}>
                <Avatar name={s.username} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: "0.86rem", color: "#eaf4fb" }}>{s.username}</strong>
                  {s.note && <div style={{ color: "#7e92a4", fontSize: "0.74rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.note}</div>}
                </div>
                <LateArrival eta={s.lateEta} canEdit testid={`cqb-late-${s.id}`} onSet={(eta) => viewAct(`cqblate-${s.id}`, () => setCqbLateArrival(op.id, s.id, eta, csrf), (vw) => ({ ...vw, cqbSoldiers: vw.cqbSoldiers.map((x) => (x.id === s.id ? { ...x, lateEta: eta } : x)) }))} />
                <SaveDot id={`cqb-${s.id}`} />
                <select
                  data-testid={`cqb-assign-${s.id}`}
                  value={s.assignedGroupId ?? ""}
                  onChange={(e) => { const g = e.target.value || null; viewAct(`cqb-${s.id}`, () => assignCqbSoldier(op.id, s.id, csrf, g), (vw) => ({ ...vw, cqbSoldiers: vw.cqbSoldiers.map((x) => (x.id === s.id ? { ...x, assignedGroupId: g } : x)) })); }}
                  style={{ flexShrink: 0, maxWidth: "50%", background: "#0e1926", border: "1px solid rgba(240,165,0,0.28)", color: "#ccdde8", fontFamily: MONO, fontSize: "0.66rem", padding: "0.25rem 0.4rem", borderRadius: 6, outline: "none" }}
                >
                  <option value="">— kein Team —</option>
                  {cqbTeams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.targetSize ? ` (${cqbSoldiers.filter((x) => x.assignedGroupId === t.id).length}/${t.targetSize})` : ""}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      )}
      {cqbTeams.length === 0 && cqbSoldiers.length > 0 && (
        <p style={{ margin: "0.7rem 0 0", color: "#7e92a4", fontSize: "0.78rem" }}>Keine CQB-Teams definiert — lege unter „Bedarfe" CQB-Teams an, um Soldaten einzuteilen.</p>
      )}
    </section>
  );

  // Jäger-Staffeln: operator places pilots (persons, no ship needed) directly into
  // a fighter squad — mirrors CQB. Fighters with a ship bind via the board dropdown;
  // this manages the pilot roster + late-arrival.
  const fighterBlock = fighterSquads.length > 0 && (
    <section style={{ ...card, marginBottom: "1.6rem", border: "1px solid rgba(167,139,250,0.22)" }} data-testid="fighter-block">
      {panelHead("fighter", "#a78bfa", "JÄGER-STAFFELN · PILOTEN EINTEILEN", <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.64rem", color: "#5b6b7a" }}>{fighterSquads.length} Staffeln</span>)}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        {fighterSquads.map((sq) => {
          const mem = cqbSoldiers.filter((s) => s.assignedGroupId === sq.id);
          const pickOpen = addMemberTeam === sq.id;
          const shipPilots = accepted.filter((u) => u.formationId === sq.id).length;
          const filledF = shipPilots + mem.length;
          return (
            <div key={sq.id} data-testid={`fighter-squad-op-${sq.id}`} style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ color: "#a78bfa", display: "inline-flex", flexShrink: 0 }}><Ic name="fighter" size={14} sw={1.7} /></span>
                <strong style={{ flex: 1, minWidth: 0, fontSize: "0.85rem", color: "#eaf4fb" }}>{sq.name}</strong>
                <span style={{ fontFamily: MONO, fontSize: "0.64rem", color: "#5b6b7a", flexShrink: 0 }}>{filledF}/{sq.targetSize ?? "∞"}</span>
                <button type="button" data-testid={`fighter-add-member-${sq.id}`} title="Pilot dieser Staffel zuweisen" onClick={() => { setAddMemberTeam(pickOpen ? null : sq.id); setAddMemberFilter(""); }} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, padding: "0.22rem 0.5rem", border: `1px solid ${pickOpen ? "rgba(167,139,250,0.6)" : "rgba(167,139,250,0.35)"}`, background: "rgba(167,139,250,0.08)", color: "#a78bfa", fontFamily: MONO, fontSize: "0.62rem", borderRadius: 6, cursor: "pointer" }}><Ic name="plus" size={11} sw={2} /> Pilot</button>
              </div>
              {mem.map((s) => (
                <div key={s.id} data-testid={`fighter-pilot-op-${s.id}`} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.35rem 0.5rem", borderRadius: 7, border: "1px solid rgba(167,139,250,0.16)", background: "rgba(167,139,250,0.03)" }}>
                  <Avatar name={s.username} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: "0.82rem", color: "#dce8f0" }}>{s.username}</span>
                  <LateArrival eta={s.lateEta} canEdit testid={`fighter-late-${s.id}`} onSet={(eta) => viewAct(`cqblate-${s.id}`, () => setCqbLateArrival(op.id, s.id, eta, csrf), (vw) => ({ ...vw, cqbSoldiers: vw.cqbSoldiers.map((x) => (x.id === s.id ? { ...x, lateEta: eta } : x)) }))} />
                  <SaveDot id={`cqb-${s.id}`} />
                  <button type="button" title="Aus Staffel entfernen" onClick={() => viewAct(`cqb-${s.id}`, () => assignCqbSoldier(op.id, s.id, csrf, null), (vw) => ({ ...vw, cqbSoldiers: vw.cqbSoldiers.map((x) => (x.id === s.id ? { ...x, assignedGroupId: null } : x)) }))} style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 5, border: "1px solid rgba(255,68,68,0.35)", background: "rgba(255,68,68,0.07)", color: "#ff6b6b", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Ic name="x" size={10} sw={2} /></button>
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
    u.unitType === "ship" ? (u.shipClass === "Fighter" ? ["#a78bfa", "fighter"] : ["#00d4ff", "ship"])
      : u.unitType === "squad" ? ["#f0a500", "fps"]
        : u.unitType === "vehicle" ? ["#ff7a45", "vehicle"] : ["#9fb1c2", "board"];
  // Editable composition row: type icon + name + a formation (Verband) select.
  const compUnitRow = (u: FleetUnit) => {
    const [color, icon] = unitMeta(u);
    const teams = u.unitType === "ship" ? carriedTeams(u.id) : [];
    const vehicles = u.unitType === "ship" ? carriedVehicles(u.id) : [];
    return (
      <div key={u.id} style={{ marginBottom: "0.3rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0.5rem", borderRadius: 7, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.012)" }}>
          <span style={{ color, display: "inline-flex", flexShrink: 0 }}><Ic name={icon} size={13} sw={1.7} /></span>
          <span style={{ flex: 1, minWidth: 0, fontSize: "0.8rem", color: "#dce8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}{u.shipClass ? <span style={{ color: "#5b6b7a", fontFamily: MONO, fontSize: "0.6rem" }}> · {u.shipClass}</span> : null}</span>
          <SaveDot id={`unitfm-${u.id}`} />
          <select
            data-testid={`comp-formation-${u.id}`}
            value={u.formationId ?? ""}
            onChange={(e) => { const fid = e.target.value || null; boardAct(`unitfm-${u.id}`, (us) => us.map((x) => (x.id === u.id ? { ...x, formationId: fid } : x)), () => assignUnitFormation(op.id, u.id, csrf, fid)); }}
            style={{ flexShrink: 0, maxWidth: "9.5rem", background: "#0e1926", border: "1px solid rgba(167,139,250,0.3)", color: "#ccdde8", fontFamily: MONO, fontSize: "0.62rem", padding: "0.2rem 0.4rem", borderRadius: 6, outline: "none" }}
          >
            <option value="">— ohne Zuordnung —</option>
            {view.fighterSquads.length > 0 && (
              <optgroup label="Jäger-Staffeln">
                {view.fighterSquads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
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
              <div key={tm.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.76rem", color: "#9fb1c2" }}>
                <span style={{ color: "#f0a500" }}>⮡</span><Ic name="fps" size={11} sw={1.7} /> {tm.name} <span style={{ color: "#5b6b7a", fontSize: "0.62rem" }}>fährt mit</span>
              </div>
            ))}
            {vehicles.map((v) => (
              <div key={v.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.76rem", color: "#9fb1c2" }}>
                <span style={{ color: "#ff7a45" }}>⮡</span><Ic name="vehicle" size={11} sw={1.7} /> {v.name} <span style={{ color: "#5b6b7a", fontSize: "0.62rem" }}>verladen</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const formationBlock = (
    <section style={{ ...card, marginBottom: "1.6rem", border: "1px solid rgba(167,139,250,0.22)" }} data-testid="formation-block">
      {panelHead("board", "#a78bfa", "VERBÄNDE", <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.64rem", color: "#5b6b7a" }}>{view.formations.length}</span>)}
      {view.formations.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.8rem" }}>
          {view.formations.map((f) => {
            const count = accepted.filter((u) => u.formationId === f.id).length;
            return (
              <div key={f.id} data-testid={`formation-${f.id}`} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.45rem 0.6rem", borderRadius: 8, border: "1px solid rgba(167,139,250,0.2)", background: "rgba(167,139,250,0.04)" }}>
                <span style={{ color: "#a78bfa", display: "inline-flex" }}><Ic name="board" size={14} /></span>
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
                <span style={{ fontFamily: MONO, fontSize: "0.64rem", color: "#9fb1c2" }}>{count} Einheit{count === 1 ? "" : "en"}</span>
                <button type="button" data-testid={`formation-del-${f.id}`} title="Verband löschen" onClick={() => { setUnits((us) => us.map((x) => (x.formationId === f.id ? { ...x, formationId: null } : x))); viewAct(`fm-${f.id}`, () => deleteFormation(op.id, f.id, csrf), (vw) => ({ ...vw, formations: vw.formations.filter((x) => x.id !== f.id) })); }} style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(255,68,68,0.4)", background: "rgba(255,68,68,0.08)", color: "#ff6b6b", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Ic name="x" size={11} sw={2} /></button>
              </div>
            );
          })}
        </div>
      )}
      {/* ZUSAMMENSETZUNG — assign EVERY unit type (ship/fighter/squad/vehicle) to a Verband. */}
      {accepted.length > 0 && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "0.8rem", marginBottom: "0.9rem" }}>
          <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.1em", color: "#9fb1c2", marginBottom: "0.2rem" }}>ZUSAMMENSETZUNG — EINHEITEN ZUORDNEN</div>
          <div style={{ fontSize: "0.72rem", color: "#5b6b7a", marginBottom: "0.6rem" }}>Schiffe, Jäger, Fahrzeuge und Bodentruppen einem Verband zuordnen — sofort gespeichert.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
            {view.formations.map((f) => (
              <div key={f.id}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.3rem" }}>
                  <span style={{ color: "#a78bfa", display: "inline-flex" }}><Ic name="board" size={13} /></span>
                  <strong style={{ fontSize: "0.8rem", color: "#c9b8ff" }}>{f.name}</strong>
                  <span style={{ fontFamily: MONO, fontSize: "0.6rem", color: "#5b6b7a" }}>{formationUnits(f.id).length} Einheit{formationUnits(f.id).length === 1 ? "" : "en"}</span>
                </div>
                <div style={{ marginLeft: "0.4rem" }}>
                  {formationUnits(f.id).length > 0
                    ? formationUnits(f.id).map(compUnitRow)
                    : <div style={{ fontSize: "0.74rem", color: "#5b6b7a", fontStyle: "italic" }}>keine Einheiten</div>}
                </div>
              </div>
            ))}
            {ungroupedUnits.length > 0 && (
              <div>
                {view.formations.length > 0 && (
                  <div style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.06em", color: "#5b6b7a", marginBottom: "0.3rem" }}>OHNE VERBAND</div>
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
          style={{ flex: "1 1 200px", boxSizing: "border-box", background: "#0e1926", border: "1px solid rgba(167,139,250,0.28)", color: "#ccdde8", fontFamily: "var(--body)", fontSize: "0.86rem", padding: "0.4rem 0.55rem", borderRadius: 7, outline: "none" }}
        />
        <button type="button" data-testid="formation-add" disabled={!newFormation.trim()} onClick={() => { run(() => createFormation(op.id, csrf, newFormation.trim())); setNewFormation(""); }} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, padding: "0.4rem 0.7rem", border: "1px solid rgba(167,139,250,0.45)", background: "rgba(167,139,250,0.1)", color: "#a78bfa", fontFamily: MONO, fontSize: "0.7rem", borderRadius: 7, cursor: "pointer" }}><Ic name="plus" size={12} sw={2} /> Verband</button>
      </div>
    </section>
  );

  const boardBlock = (
    <>
      <div style={{ fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.14em", color: "#9fb1c2", marginBottom: "1rem" }}>
        FLOTTEN-BOARD <span style={{ color: "#5b6b7a" }}>· Platz anklicken oder Person draufziehen</span>
      </div>
      <div className="fpw-board" style={{ gap: "0.85rem" }}>
        {lanes.map((lane) => (
          <div key={lane.type} style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginBottom: "0.8rem", paddingBottom: "0.5rem", borderBottom: `1px solid rgba(${lane.rgb},0.4)` }}>
              <span style={{ color: lane.accent, display: "inline-flex", flexShrink: 0 }}><Ic name={lane.icon} size={15} /></span>
              <span style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: "0.68rem", letterSpacing: "0.06em", color: lane.accent, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lane.label}</span>
              <span style={{ fontFamily: MONO, fontSize: "0.72rem", color: "#9fb1c2", flexShrink: 0 }}>{lane.units.reduce((a, u) => a + u.seats.filter((s) => s.claimedBy).length, 0)}/{lane.units.reduce((a, u) => a + u.seats.filter((s) => s.active).length, 0)}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
              {lane.units.map((u) => (
                <div key={u.id} style={{ border: `1px solid rgba(${lane.rgb},0.16)`, borderRadius: 13, background: "#0b1019", padding: "1rem 1.1rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.7rem" }}>
                    <span style={{ width: 36, height: 36, borderRadius: 9, background: `rgba(${lane.rgb},0.1)`, border: `1px solid rgba(${lane.rgb},0.26)`, color: lane.accent, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic name={lane.icon} size={18} sw={1.6} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontWeight: 700, fontSize: "1.02rem", color: "#eaf4fb", lineHeight: 1.15 }}>{u.name}</strong>
                      <div style={{ color: "#7e92a4", fontSize: "0.78rem", marginTop: 1 }}>{u.shipClass ?? u.unitType}{u.captain ? ` · ${u.captain.username}` : ""}</div>
                    </div>
                    <span style={{ fontFamily: MONO, fontSize: "0.95rem", color: "#eaf4fb", flexShrink: 0 }}>{u.seats.filter((s) => s.claimedBy).length}<span style={{ color: "#5b6b7a", fontSize: "0.8rem" }}>/{u.seats.filter((s) => s.active).length}</span></span>
                    <button type="button" data-testid={`unit-remove-${u.id}`} title="Einheit entfernen" onClick={() => { if (window.confirm(`„${u.name}" aus der Operation entfernen?`)) run(() => withdrawUnit(op.id, u.id, csrf)); }} style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 6, border: "1px solid rgba(255,68,68,0.4)", background: "rgba(255,68,68,0.08)", color: "#ff6b6b", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Ic name="x" size={12} sw={2} /></button>
                  </div>
                  {(requirements.length > 0 || view.formations.length > 0 || u.unitType === "vehicle") && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
                      {requirements.length > 0 && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                          <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.06em", color: "#5b6b7a", flexShrink: 0 }}>BEDARF</span>
                          {reqSelect(u, u.requirementId ?? "", (id) => boardAct(`unitfm-${u.id}`, (us) => us.map((x) => (x.id === u.id ? { ...x, requirementId: id || null } : x)), () => patchUnit(op.id, u.id, csrf, { requirementId: id || null })), `unit-req-${u.id}`)}
                        </span>
                      )}
                      {/* Verband-Zuordnung für ALLE Einheitstypen (Schiffe/Jäger/Bodentruppen/Fahrzeuge). */}
                      {view.formations.length > 0 && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                          <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.06em", color: "#5b6b7a", flexShrink: 0 }}>VERBAND</span>
                          <select
                            data-testid={`unit-formation-${u.id}`}
                            value={u.formationId ?? ""}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => { const fid = e.target.value || null; boardAct(`unitfm-${u.id}`, (us) => us.map((x) => (x.id === u.id ? { ...x, formationId: fid } : x)), () => assignUnitFormation(op.id, u.id, csrf, fid)); }}
                            style={{ background: "#0e1926", border: "1px solid rgba(167,139,250,0.28)", color: "#ccdde8", fontFamily: MONO, fontSize: "0.66rem", padding: "0.25rem 0.4rem", borderRadius: 6, outline: "none" }}
                          >
                            <option value="">— kein —</option>
                            {view.formations.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                          <SaveDot id={`unitfm-${u.id}`} />
                        </span>
                      )}
                      {u.unitType === "vehicle" && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                          <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.06em", color: "#5b6b7a", flexShrink: 0 }}>TRÄGER</span>
                          <select
                            data-testid={`unit-carrier-${u.id}`}
                            value={u.carrierUnitId ?? ""}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => run(() => assignUnitCarrier(op.id, u.id, csrf, e.target.value || null))}
                            style={{ background: "#0e1926", border: "1px solid rgba(255,122,69,0.28)", color: "#ccdde8", fontFamily: MONO, fontSize: "0.66rem", padding: "0.25rem 0.4rem", borderRadius: 6, outline: "none" }}
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
                      <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.06em", color: "#5b6b7a", flexShrink: 0 }}>SQUAD</span>
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
                    <span style={{ color: "#f0a500", display: "inline-flex", flexShrink: 0 }}><Ic name="bolt" size={13} /></span>
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
                <div key={`ph-${lane.type}-${i}`} data-testid="need-slot" style={{ border: `1px dashed rgba(${lane.rgb},0.4)`, borderRadius: 13, background: "rgba(255,255,255,0.012)", padding: "0.9rem 1rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, background: `rgba(${lane.rgb},0.07)`, border: `1px dashed rgba(${lane.rgb},0.4)`, color: lane.accent, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic name={lane.icon} size={16} sw={1.5} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: "0.92rem", color: "#c2d2de" }}>{ph.label}</strong>
                    <div style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.08em", color: lane.accent, marginTop: 1 }}>BEDARF · UNERFÜLLT</div>
                  </div>
                  {ph.onRemove && (
                    <button type="button" data-testid={`need-remove-${ph.key}`} title="Bedarf entfernen" onClick={ph.onRemove} style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(255,68,68,0.4)", background: "rgba(255,68,68,0.08)", color: "#ff6b6b", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Ic name="x" size={11} sw={2} /></button>
                  )}
                </div>
              ))}
              {lane.units.length === 0 && lane.placeholders.length === 0 && (
                <div data-testid={`lane-empty-${lane.type}`} style={{ border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 13, background: "rgba(255,255,255,0.012)", padding: "1.3rem 1rem", textAlign: "center", fontFamily: MONO, fontSize: "0.64rem", letterSpacing: "0.08em", color: "#5b6b7a" }}>KEIN BEDARF</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );

  const toolsBlock = (
    <div style={{ marginTop: "1.2rem" }}>
      <button type="button" onClick={() => setToolsOpen((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.85rem", border: "1px solid rgba(0,212,255,0.16)", background: "rgba(0,212,255,0.03)", color: "#9fb1c2", fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.03em", borderRadius: 8, cursor: "pointer" }}>
        <span style={{ display: "inline-flex", transform: toolsOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}><Ic name="chevron" size={14} /></span>
        Werkzeuge / Aktivität
      </button>
      {toolsOpen && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "0.9rem" }}>
          <section style={{ ...card, flex: "1 1 300px", minWidth: 0 }}>
            <div style={railLabel}>AKTIVITÄT</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {view.auditLogs.length === 0 && <div style={{ color: "#5b6b7a", fontSize: "0.8rem" }}>—</div>}
              {view.auditLogs.slice(0, 12).map((a, i) => (
                <div key={i} style={{ display: "flex", gap: "0.6rem", padding: "0.32rem 0", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: "0.82rem" }}>
                  <span style={{ fontFamily: MONO, fontSize: "0.7rem", color: "#5b6b7a", flexShrink: 0 }}>{new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(a.createdAt))}</span>
                  <span style={{ color: "#c2d2de" }}><strong style={{ color: "#eaf4fb" }}>{a.actor}</strong> {a.action}{a.detail && <span style={{ color: "#7e92a4" }}> · {a.detail}</span>}</span>
                </div>
              ))}
            </div>
          </section>
          <section style={{ ...card, flex: "1 1 300px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}><span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="eye" size={15} /></span><span style={{ fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.12em", color: "#9fb1c2" }}>HANGAR-FREIGABEN</span></div>
            <p style={{ margin: "0 0 0.9rem", color: "#7e92a4", fontSize: "0.78rem" }}>Nur für Operatoren sichtbar.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
              {view.hangarShares.length === 0 && <div style={{ color: "#5b6b7a", fontSize: "0.8rem" }}>Noch keine Freigaben.</div>}
              {view.hangarShares.map((h) => (
                <div key={h.userId} style={{ border: "1px solid rgba(0,212,255,0.1)", borderRadius: 10, padding: "0.7rem 0.8rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: h.ships.length ? "0.55rem" : 0 }}><Avatar name={h.username} /><strong style={{ fontSize: "0.9rem", color: "#eaf4fb" }}>{h.username}</strong><span style={{ fontFamily: MONO, fontSize: "0.64rem", color: "#5b6b7a" }}>{h.ships.length} Schiffe</span></div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>{h.ships.map((sh) => <span key={sh.id} style={{ fontFamily: MONO, fontSize: "0.7rem", color: "#c2d2de", border: "1px solid rgba(0,212,255,0.16)", background: "#0e1926", padding: "0.22rem 0.5rem", borderRadius: 5 }}>{sh.name}</span>)}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );

  const placeBanner = placing && (
    <div style={{ position: "sticky", top: 58, zIndex: 60, display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.7rem 1rem", marginBottom: "1.1rem", border: "1px solid rgba(240,165,0,0.55)", background: "linear-gradient(90deg,rgba(240,165,0,0.16),rgba(240,165,0,0.04))", borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,0.45)" }}>
      <span style={{ color: "#f0a500", display: "inline-flex", flexShrink: 0 }}><Ic name="swap" size={17} sw={1.8} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.12em", color: "#f0a500" }}>EINTEILEN-MODUS</span>
        <div style={{ color: "#eaf4fb", fontSize: "0.92rem", marginTop: 1 }}><strong>{placing.name}</strong> — wähle unten einen offenen Platz <span style={{ color: "#f0c97a" }}>(grün markiert)</span></div>
      </div>
      <button type="button" onClick={() => setPlacing(null)} style={{ flexShrink: 0, padding: "0.42rem 0.8rem", border: "1px solid rgba(255,255,255,0.18)", background: "transparent", color: "#9fb1c2", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 7, cursor: "pointer" }}>Abbrechen</button>
    </div>
  );

  // Redesign: each console tab renders one section. "fleet" = board + right rail;
  // the rest are their own tabs (CQB / Verbände / Fragen).
  if (section === "cqb")
    return <div data-testid="operator-panel">{placeBanner}{pendingBlock}{fighterBlock}{cqbBlock || <section style={card}><div style={{ color: "#5b6b7a", fontSize: "0.8rem", fontFamily: MONO }}>Noch keine CQB-Anmeldungen.</div></section>}</div>;
  if (section === "formations")
    return <div data-testid="operator-panel">{formationBlock}</div>;
  if (section === "qa")
    return <div data-testid="operator-panel">{qaPanel}</div>;

  // section === "fleet"
  return (
    <div data-testid="operator-panel">
      {placeBanner}
      <div style={{ display: "flex", gap: "1.3rem", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 420px", minWidth: 0 }}>
          <section style={{ ...card, marginBottom: "1.3rem", padding: "1rem 1.2rem" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.7rem 1.4rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}><span style={{ fontFamily: MONO, fontSize: "1.5rem", color: "#eaf4fb", lineHeight: 1 }}>{fillPct}%</span><span style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.1em", color: "#5b6b7a" }}>BESETZT</span></div>
              <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {bars.map((b) => (
                  <div key={b.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.22rem" }}><span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.74rem", color: "#c2d2de" }}><span style={{ width: 8, height: 8, borderRadius: 2, background: b.accent }} />{b.label}</span><span style={{ fontFamily: MONO, fontSize: "0.72rem", color: "#9fb1c2" }}>{b.f}/{b.t}</span></div>
                    <div style={{ height: 5, borderRadius: 4, background: "#0e1926", overflow: "hidden" }}><div style={{ height: "100%", width: `${b.pct}%`, background: b.accent, borderRadius: 4 }} /></div>
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
