import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, deleteOperation, editOperation } from "../api/client";
import type { OperationDetail } from "../api/types";
import { Ic } from "./Icons";
import { CardHead, MONO, actionBar, btnGhost, btnPrimary, card, inp, lbl, segChip, ta } from "./ui";

const OP_TYPES = [
  { key: "combat", label: "Kampf", color: "var(--red)", rgb: "255,68,68", icon: "fighter" },
  { key: "mining", label: "Mining", color: "var(--gold)", rgb: "240,165,0", icon: "bolt" },
  { key: "salvage", label: "Bergung", color: "var(--orange)", rgb: "255,122,69", icon: "swap" },
  { key: "explore", label: "Exploration", color: "var(--cyan)", rgb: "0,212,255", icon: "globe" },
  { key: "transport", label: "Transport", color: "var(--purple)", rgb: "160,100,255", icon: "vehicle" },
  { key: "training", label: "Training", color: "var(--green)", rgb: "0,255,136", icon: "lead" },
  { key: "social", label: "Sozial", color: "#ff70c8", rgb: "255,112,200", icon: "users" },
];
const VIS = [
  { key: "private", label: "Privat", desc: "Nur dein Server", icon: "lock" },
  { key: "partners", label: "Partner", desc: "Verbündete Server sehen es", icon: "link" },
  { key: "public", label: "Öffentlich", desc: "Instanzweit sichtbar", icon: "globe" },
];
const SYSTEMS = ["Stanton", "Pyro", "Nyx"];

function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function tzAbbr(tz: string | null): string {
  if (!tz) return "";
  try {
    const parts = new Intl.DateTimeFormat("de-DE", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

// The "Eckdaten" tab of Op-Management = the full op edit form (fused; the
// standalone edit screen is gone). Title/date/max/type/meeting/briefing/
// visibility + danger zone + sticky save bar.
export function EckdatenForm({ op, csrf, onSaved, onNotice }: { op: OperationDetail; csrf: string | null; onSaved: () => void; onNotice: (m: string) => void }) {
  const navigate = useNavigate();
  const initial = {
    title: op.title,
    description: op.description ?? "",
    opType: op.opType,
    scheduledAt: isoToLocalInput(op.scheduledAt),
    maxParticipants: op.maxParticipants != null ? String(op.maxParticipants) : "",
    meetingSystem: op.meetingSystem || "Stanton",
    meetingLocation: op.meetingLocation ?? "",
    visibility: (op.visibility === "guild" ? "private" : op.visibility) as string,
  };
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  // Re-seed when the op reloads (e.g. after save).
  useEffect(() => {
    const next = {
      title: op.title,
      description: op.description ?? "",
      opType: op.opType,
      scheduledAt: isoToLocalInput(op.scheduledAt),
      maxParticipants: op.maxParticipants != null ? String(op.maxParticipants) : "",
      meetingSystem: op.meetingSystem || "Stanton",
      meetingLocation: op.meetingLocation ?? "",
      visibility: (op.visibility === "guild" ? "private" : op.visibility) as string,
    };
    setForm(next);
    setSaved(next);
  }, [op]);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  async function save() {
    if (!csrf) return;
    setBusy(true);
    try {
      await editOperation(op.id, csrf, {
        title: form.title.trim(),
        description: form.description,
        opType: form.opType,
        meetingSystem: form.meetingSystem.trim(),
        meetingLocation: form.meetingLocation.trim(),
        scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined,
        visibility: form.visibility,
        maxParticipants: form.maxParticipants.trim() === "" ? null : Math.max(0, Number(form.maxParticipants) || 0),
      });
      onNotice("Gespeichert.");
      onSaved();
    } catch (e) {
      onNotice(e instanceof ApiError ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!csrf) return;
    setBusy(true);
    try {
      await deleteOperation(op.id, csrf);
      navigate("/");
    } catch (e) {
      onNotice(e instanceof ApiError ? e.message : "Löschen fehlgeschlagen.");
      setBusy(false);
    }
  }

  const zone = tzAbbr(op.guild.timezone);
  const twoCol: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.9rem" };

  return (
    <div data-testid="edit-op-page">
      {dirty && (
        <span data-testid="edit-dirty" className="tag tag-green" style={{ marginBottom: "1rem" }}>GEÄNDERT</span>
      )}
      <div className="fpw-edit-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1fr)", gap: "1rem", alignItems: "start" }}>
        {/* main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 }}>
          <section style={card}>
            <CardHead icon="bolt" label="ECKDATEN" tone="cyan" />
            <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
              <div>
                <label style={lbl}>Operationstitel <span style={{ color: "var(--gold)" }}>*</span></label>
                <input data-testid="edit-title" type="text" maxLength={160} value={form.title} onChange={(e) => set({ title: e.target.value })} style={inp} />
              </div>
              <div className="fpw-two" style={twoCol}>
                <div>
                  <label style={lbl}>Datum &amp; Zeit{zone ? ` (${zone})` : ""} <span style={{ color: "var(--gold)" }}>*</span></label>
                  <input data-testid="edit-scheduled" type="datetime-local" value={form.scheduledAt} onChange={(e) => set({ scheduledAt: e.target.value })} style={inp} />
                </div>
                <div>
                  <label style={lbl}>Max. Teilnehmer</label>
                  <input data-testid="edit-maxparticipants" type="number" min={0} value={form.maxParticipants} placeholder="∞" onChange={(e) => set({ maxParticipants: e.target.value })} style={inp} />
                </div>
              </div>
              <div>
                <label style={lbl}>Operationstyp</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {OP_TYPES.map((t) => <button key={t.key} type="button" data-testid={`edit-type-${t.key}`} onClick={() => set({ opType: t.key })} style={segChip(form.opType === t.key, t.color, t.rgb)}><Ic name={t.icon} size={14} sw={1.7} />{t.label}</button>)}
                </div>
              </div>
            </div>
          </section>

          <section style={card}>
            <CardHead icon="pin" label="TREFFPUNKT" tone="violet" />
            <div className="fpw-two" style={twoCol}>
              <div>
                <label style={lbl}>System</label>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  {SYSTEMS.map((s) => <button key={s} type="button" data-testid={`edit-system-${s}`} onClick={() => set({ meetingSystem: s })} style={{ ...segChip(form.meetingSystem === s, "var(--cyan)", "0,212,255"), flex: 1, justifyContent: "center" }}>{s}</button>)}
                </div>
              </div>
              <div>
                <label style={lbl}>Ort / Rendezvous</label>
                <input data-testid="edit-location" type="text" maxLength={160} value={form.meetingLocation} onChange={(e) => set({ meetingLocation: e.target.value })} placeholder="z. B. HUR-L1" style={inp} />
              </div>
            </div>
          </section>

          <section style={card}>
            <CardHead icon="doc" label="BRIEFING" tone="cyan" right={<span style={{ fontFamily: MONO, fontSize: "0.6rem", color: "var(--dim2)" }}>Markdown</span>} />
            <textarea data-testid="edit-description" value={form.description} maxLength={4000} onChange={(e) => set({ description: e.target.value })} placeholder={"## Missionsziel\n…\n\n## Einsatzregeln\n…"} style={ta} />
          </section>
        </div>

        {/* side column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 }}>
          <section style={card}>
            <CardHead icon="eye" label="SICHTBARKEIT" tone="green" />
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {VIS.map((v) => {
                const active = form.visibility === v.key;
                return (
                  <button key={v.key} type="button" data-testid={`edit-vis-${v.key}`} onClick={() => set({ visibility: v.key })} style={{ display: "flex", alignItems: "center", gap: "0.6rem", width: "100%", padding: "0.6rem 0.7rem", borderRadius: 9, cursor: "pointer", textAlign: "left", transition: "all .12s", border: active ? "1px solid rgba(0,212,255,0.45)" : "1px solid rgba(255,255,255,0.08)", background: active ? "rgba(0,212,255,0.07)" : "transparent", color: active ? "var(--cyan)" : "#9fb1c2" }}>
                    <Ic name={v.icon} size={15} sw={1.6} />
                    <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: "0.84rem", color: "var(--text-hi)" }}>{v.label}</span><span style={{ display: "block", fontSize: "0.72rem", color: "var(--dim)" }}>{v.desc}</span></span>
                    {active && <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="check" size={15} sw={2} /></span>}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="danger">
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.06em", color: "#ff6b6b", marginBottom: "0.5rem" }}><Ic name="alert" size={14} sw={1.7} /> GEFAHRENZONE</div>
            {confirmDel ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <span style={{ color: "var(--text)", fontSize: "0.85rem" }}>Operation unwiderruflich löschen?</span>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" data-testid="edit-delete-confirm" disabled={busy || !csrf} onClick={remove} style={{ flex: 1, padding: "0.5rem", border: "1px solid rgba(255,68,68,0.5)", background: "rgba(255,68,68,0.12)", color: "var(--red)", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 8, cursor: "pointer" }}>Endgültig löschen</button>
                  <button type="button" style={btnGhost} disabled={busy} onClick={() => setConfirmDel(false)}>Abbrechen</button>
                </div>
              </div>
            ) : (
              <button type="button" data-testid="edit-delete" disabled={busy} onClick={() => setConfirmDel(true)} style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0.55rem", border: "1px solid rgba(255,68,68,0.4)", background: "rgba(255,68,68,0.07)", color: "var(--red)", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 8, cursor: "pointer" }}><Ic name="x" size={14} sw={1.8} /> Operation löschen</button>
            )}
          </div>
        </div>
      </div>

      <div style={actionBar}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--dim)", fontSize: "0.78rem" }}><span style={{ color: "var(--gold)" }}><Ic name="alert" size={14} sw={1.7} /></span><span style={{ color: "var(--gold)" }}>*</span> Pflichtfeld</div>
        <div style={{ flex: 1 }} />
        <button type="button" data-testid="edit-save" style={{ ...btnPrimary, opacity: dirty ? 1 : 0.7 }} disabled={busy || !csrf} onClick={save}><Ic name="save" size={15} sw={1.8} /> Änderungen speichern</button>
      </div>

      <style>{`@media (max-width: 860px){.fpw-edit-grid{display:flex !important;flex-direction:column}.fpw-two{grid-template-columns:1fr !important}}`}</style>
    </div>
  );
}
