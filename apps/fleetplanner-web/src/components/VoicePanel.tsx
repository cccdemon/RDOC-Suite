import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getSquadLink, getVoiceRecipients, setVoiceRecipients } from "../api/client";
import type { OperationDetail } from "../api/types";
import { Ic } from "./Icons";
import { Avatar } from "./Avatar";
import { card, MONO } from "./ui";
import { SaveDot, useFieldSave } from "./fieldSave";

const PURPLE = "rgba(160,100,255";

type Recipient = { id: string; name: string; role: string };

// Voice tab (SquadLink): the operator hands the CommandNet room link to assigned
// participants. Master toggle is shared with the header quick-switch + Eckdaten
// (op.squadLinkVoiceEnabled). The per-recipient grant list is persisted server-side
// (OperationVoiceRecipient) — granted users can fetch the link from /squadlink.
export function VoicePanel({
  op,
  csrf,
  voiceEnabled,
  onToggleVoice,
  onNotice,
}: {
  op: OperationDetail;
  csrf: string | null;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  onNotice?: (m: string) => void;
}) {
  const { touch, fail } = useFieldSave();
  const [links, setLinks] = useState<Record<string, boolean>>({});
  const [room, setRoom] = useState<string>("commandnet://rdoc/op/…?key=••••-••••");
  // Last server-confirmed grant set, for optimistic rollback on PUT failure.
  const confirmed = useRef<Record<string, boolean>>({});

  useEffect(() => {
    getSquadLink(op.id).then((r) => { if (r.link) setRoom(r.link); }).catch(() => undefined);
  }, [op.id]);

  // Load the persisted recipient grant list.
  useEffect(() => {
    getVoiceRecipients(op.id)
      .then((r) => { const m: Record<string, boolean> = {}; r.userIds.forEach((id) => { m[id] = true; }); setLinks(m); confirmed.current = m; })
      .catch(() => undefined);
  }, [op.id]);

  // Persist the whole grant set (replace semantics); optimistic with rollback.
  function persist(next: Record<string, boolean>, fieldIds: string[]) {
    if (!csrf) return;
    const userIds = Object.keys(next).filter((id) => next[id]);
    setVoiceRecipients(op.id, csrf, userIds)
      .then(() => { confirmed.current = next; fieldIds.forEach((f) => touch(f)); })
      .catch((e) => {
        setLinks(confirmed.current);
        fieldIds.forEach((f) => fail(f));
        onNotice?.(e instanceof ApiError ? e.message : "Empfänger speichern fehlgeschlagen.");
      });
  }

  // Candidates = everyone holding a seat + the op leaders, deduped, with a role.
  const recipients = useMemo<Recipient[]>(() => {
    const map = new Map<string, Recipient>();
    for (const l of op.leaders) map.set(l.id, { id: l.id, name: l.username, role: "Einsatzleitung" });
    for (const u of op.units) {
      if (u.status !== "accepted") continue;
      for (const s of u.seats) {
        if (s.claimedBy && !map.has(s.claimedBy.id)) {
          const role = s.order === 0 ? (u.unitType === "squad" ? "Squad-Lead" : "Captain") : "Crew";
          map.set(s.claimedBy.id, { id: s.claimedBy.id, name: s.claimedBy.username, role });
        }
      }
    }
    return [...map.values()];
  }, [op.leaders, op.units]);

  const assigned = recipients.filter((r) => links[r.id]).length;
  const toggle = (id: string) => { const next = { ...links, [id]: !links[id] }; setLinks(next); persist(next, ["voice-" + id]); };
  const assignAll = () => { const next = { ...links }; recipients.forEach((r) => { next[r.id] = true; }); setLinks(next); persist(next, recipients.map((r) => "voice-" + r.id)); };
  const copy = () => { try { navigator.clipboard?.writeText(room); } catch { /* noop */ } touch("voice-copy"); };

  const head = (icon: string, color: string, label: string, right?: React.ReactNode) => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.8rem" }}>
      <span style={{ color, display: "inline-flex" }}><Ic name={icon} size={15} /></span>
      <span style={{ fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.1em", color: "#9fb1c2" }}>{label}</span>
      {right && <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>{right}</span>}
    </div>
  );

  // ── header card with the master toggle ──
  const header = (
    <section style={{ ...card, border: `1px solid ${PURPLE},0.3)` }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.9rem", flexWrap: "wrap" }}>
        <span style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: `${PURPLE},0.14)`, border: `1px solid ${PURPLE},0.4)`, color: "var(--purple)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Ic name="mic" size={19} /></span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-hi)" }}>SquadLink Voice</div>
          <div style={{ fontSize: "0.8rem", color: "var(--dim)", lineHeight: 1.45, marginTop: 3 }}>Einsatzleitung &amp; zugewiesene Crew bekommen ab Op-Start einen Direktlink in den CommandNet-Sprachraum.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <button type="button" data-testid="voice-master-toggle" aria-pressed={voiceEnabled} onClick={onToggleVoice} style={{ display: "inline-flex", alignItems: "center", gap: "0.6rem", padding: "0.55rem 0.9rem", borderRadius: 10, cursor: "pointer", border: voiceEnabled ? "1px solid var(--purple)" : "1px solid rgba(255,255,255,0.14)", background: voiceEnabled ? `${PURPLE},0.12)` : "transparent", color: voiceEnabled ? "var(--purple)" : "var(--dim)", fontFamily: MONO, fontSize: "0.74rem", letterSpacing: "0.04em" }}>
            <span style={{ width: 34, height: 18, borderRadius: 10, background: voiceEnabled ? "var(--purple)" : "#23303f", position: "relative", flexShrink: 0, transition: "background .15s" }}>
              <span style={{ position: "absolute", top: 2, left: voiceEnabled ? 18 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
            </span>
            {voiceEnabled ? "AKTIV" : "DEAKTIVIERT"}
          </button>
          <SaveDot id="op-voice" />
        </div>
      </div>
    </section>
  );

  if (!voiceEnabled) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        {header}
        <div style={{ padding: "1.4rem 1rem", textAlign: "center", color: "var(--dim2)", fontFamily: MONO, fontSize: "0.8rem", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: 12 }}>SquadLink ist deaktiviert — oben aktivieren, um Sprach-Links zu vergeben.</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      {header}
      <section style={card}>
        {head("link", "var(--cyan)", "COMMANDNET-SPRACHRAUM")}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <code style={{ flex: "1 1 240px", minWidth: 0, fontFamily: MONO, fontSize: "0.8rem", color: "var(--cyan)", background: "var(--bg3)", border: "1px solid rgba(0,212,255,0.18)", borderRadius: 8, padding: "0.55rem 0.7rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{room}</code>
          <button type="button" data-testid="voice-copy" onClick={copy} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 0.8rem", border: "1px solid rgba(0,212,255,0.4)", background: "rgba(0,212,255,0.1)", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.7rem", borderRadius: 8, cursor: "pointer" }}><Ic name="copy" size={13} /> Kopieren</button>
          <SaveDot id="voice-copy" />
        </div>
      </section>

      <section style={{ ...card, border: `1px solid ${PURPLE},0.22)` }}>
        {head("users", "var(--purple)", "LINK-EMPFÄNGER", (
          <>
            <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "var(--dim2)" }}>{assigned}/{recipients.length}</span>
            <button type="button" data-testid="voice-assign-all" onClick={assignAll} style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.04em", padding: "0.25rem 0.55rem", borderRadius: 6, border: `1px solid ${PURPLE},0.4)`, background: `${PURPLE},0.08)`, color: "var(--purple)", cursor: "pointer" }}>ALLE ZUWEISEN</button>
          </>
        ))}
        {recipients.length === 0 ? (
          <div style={{ color: "var(--dim3)", fontSize: "0.8rem", fontFamily: MONO }}>Noch niemand eingeteilt.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {recipients.map((p) => {
              const has = !!links[p.id];
              return (
                <div key={p.id} data-testid={`voice-recipient-${p.id}`} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.5rem 0.65rem", borderRadius: 9, border: `1px solid ${has ? "rgba(0,255,136,0.22)" : "rgba(255,255,255,0.07)"}`, background: has ? "rgba(0,255,136,0.04)" : "transparent" }}>
                  <Avatar name={p.name} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: "0.86rem", color: "var(--text-hi)" }}>{p.name}</strong>
                    <div style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.04em", color: "var(--dim2)", marginTop: 1 }}>{p.role}</div>
                  </div>
                  <SaveDot id={"voice-" + p.id} />
                  <button type="button" data-testid={`voice-toggle-${p.id}`} onClick={() => toggle(p.id)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.4rem 0.7rem", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: "0.66rem", border: has ? "1px solid rgba(0,255,136,0.45)" : "1px solid rgba(255,255,255,0.14)", background: has ? "rgba(0,255,136,0.1)" : "transparent", color: has ? "var(--green)" : "var(--dim)" }}>
                    <Ic name={has ? "check" : "link"} size={13} /> {has ? "Link vergeben" : "Link senden"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
