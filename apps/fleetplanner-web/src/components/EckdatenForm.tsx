import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, deleteOperation, editOperation, searchLocations, type LocationHit } from "../api/client";
import type { OperationDetail } from "../api/types";
import { Ic } from "./Icons";
import { CardHead, MONO, card, inp, lbl, segChip, ta } from "./ui";
import { SaveDot, useDebouncer, useFieldSave } from "./fieldSave";
import { OP_TYPES, VIS_OPTIONS as VIS, SYSTEMS, normalizeVisibility } from "./opForm";

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

// The "Eckdaten" tab of the Operator console = the full op edit form. Redesign
// (Variante A): NO dirty-state, NO "Änderungen speichern" bar. Every field
// autosaves — text debounced 600 ms, toggles/selects immediately — and shows a
// per-field <SaveDot>. SquadLink-Voice is controlled by the console (shared with
// the header quick-switch + Voice tab) so the three stay in sync.
export function EckdatenForm({
  op,
  csrf,
  onNotice,
  voiceEnabled,
  onToggleVoice,
}: {
  op: OperationDetail;
  csrf: string | null;
  onNotice: (m: string) => void;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
}) {
  const navigate = useNavigate();
  const { touch, fail } = useFieldSave();
  const debounce = useDebouncer(600);

  const seed = () => ({
    title: op.title,
    description: op.description ?? "",
    opType: op.opType,
    scheduledAt: isoToLocalInput(op.scheduledAt),
    maxParticipants: op.maxParticipants != null ? String(op.maxParticipants) : "",
    meetingSystem: op.meetingSystem || "Stanton",
    meetingLocation: op.meetingLocation ?? "",
    visibility: normalizeVisibility(op.visibility),
  });
  const [form, setForm] = useState(seed);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [locHits, setLocHits] = useState<LocationHit[]>([]);

  // Rendezvous autocomplete from the synced location catalog, scoped to the system.
  useEffect(() => {
    const q = form.meetingLocation.trim();
    const t = setTimeout(() => {
      searchLocations(q, form.meetingSystem).then((r) => setLocHits(r.locations)).catch(() => setLocHits([]));
    }, 200);
    return () => clearTimeout(t);
  }, [form.meetingLocation, form.meetingSystem]);

  // Re-seed if the op identity changes (navigated to another op).
  useEffect(() => { setForm(seed()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [op.id]);

  // ── autosave: optimistic local state, then PATCH; no parent reload (no flicker).
  async function persist(fieldId: string, patch: Parameters<typeof editOperation>[2]) {
    if (!csrf) return;
    try {
      await editOperation(op.id, csrf, patch);
      touch(fieldId);
    } catch (e) {
      fail(fieldId);
      onNotice(e instanceof ApiError ? e.message : "Speichern fehlgeschlagen.");
    }
  }
  // Text fields: update local state, then save debounced (touch fires on save).
  const setText = (fieldId: string, patch: Partial<typeof form>, body: Parameters<typeof editOperation>[2]) => {
    setForm((f) => ({ ...f, ...patch }));
    debounce(fieldId, () => persist(fieldId, body));
  };
  // Toggles/selects: update local state + save immediately.
  const setNow = (fieldId: string, patch: Partial<typeof form>, body: Parameters<typeof editOperation>[2]) => {
    setForm((f) => ({ ...f, ...patch }));
    persist(fieldId, body);
  };

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
  // label + inline SaveDot
  const L = ({ children, id }: { children: React.ReactNode; id: string }) => (
    <label style={{ ...lbl, display: "flex", alignItems: "center", gap: "0.5rem", justifyContent: "space-between" }}>
      <span>{children}</span>
      <SaveDot id={id} />
    </label>
  );

  return (
    <div data-testid="edit-op-page">
      <div className="fpw-edit-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1fr)", gap: "1rem", alignItems: "start" }}>
        {/* main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 }}>
          <section style={card}>
            <CardHead icon="bolt" label="ECKDATEN · AUTOSAVE" tone="cyan" />
            <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
              <div>
                <L id="op-title">Operationstitel <span style={{ color: "var(--gold)" }}>*</span></L>
                <input data-testid="edit-title" type="text" maxLength={160} value={form.title} onChange={(e) => setText("op-title", { title: e.target.value }, { title: e.target.value.trim() })} style={inp} />
              </div>
              <div className="fpw-two" style={twoCol}>
                <div>
                  <L id="op-date">Datum &amp; Zeit{zone ? ` (${zone})` : ""} <span style={{ color: "var(--gold)" }}>*</span></L>
                  <input data-testid="edit-scheduled" type="datetime-local" value={form.scheduledAt} onChange={(e) => setNow("op-date", { scheduledAt: e.target.value }, { scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })} style={inp} />
                </div>
                <div>
                  <L id="op-max">Max. Teilnehmer</L>
                  <input data-testid="edit-maxparticipants" type="number" min={0} value={form.maxParticipants} placeholder="∞" onChange={(e) => setText("op-max", { maxParticipants: e.target.value }, { maxParticipants: e.target.value.trim() === "" ? null : Math.max(0, Number(e.target.value) || 0) })} style={inp} />
                </div>
              </div>
              <div>
                <L id="op-type">Operationstyp</L>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {OP_TYPES.map((t) => <button key={t.key} type="button" data-testid={`edit-type-${t.key}`} onClick={() => setNow("op-type", { opType: t.key }, { opType: t.key })} style={segChip(form.opType === t.key, t.color, t.rgb)}><Ic name={t.icon} size={14} sw={1.7} />{t.label}</button>)}
                </div>
              </div>
            </div>
          </section>

          <section style={card}>
            <CardHead icon="pin" label="TREFFPUNKT" tone="violet" />
            <div className="fpw-two" style={twoCol}>
              <div>
                <L id="op-system">System</L>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  {SYSTEMS.map((s) => <button key={s} type="button" data-testid={`edit-system-${s}`} onClick={() => setNow("op-system", { meetingSystem: s }, { meetingSystem: s })} style={{ ...segChip(form.meetingSystem === s, "var(--cyan)", "0,212,255"), flex: 1, justifyContent: "center" }}>{s}</button>)}
                </div>
              </div>
              <div>
                <L id="op-loc">Ort / Rendezvous</L>
                <input data-testid="edit-location" type="text" list="edit-loc-list" maxLength={160} value={form.meetingLocation} onChange={(e) => setText("op-loc", { meetingLocation: e.target.value }, { meetingLocation: e.target.value.trim() })} placeholder="z. B. HUR-L1" style={inp} />
                <datalist id="edit-loc-list">
                  {locHits.map((h) => <option key={`${h.system}/${h.name}`} value={h.name}>{h.system}</option>)}
                </datalist>
              </div>
            </div>
          </section>

          <section style={card}>
            <CardHead icon="doc" label="BRIEFING" tone="cyan" right={<span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}><SaveDot id="op-brief" /><span style={{ fontFamily: MONO, fontSize: "0.6rem", color: "var(--dim2)" }}>Markdown</span></span>} />
            <textarea data-testid="edit-description" value={form.description} maxLength={4000} onChange={(e) => setText("op-brief", { description: e.target.value }, { description: e.target.value.trim() })} placeholder={"## Missionsziel\n…\n\n## Einsatzregeln\n…"} style={ta} />
          </section>
        </div>

        {/* side column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 }}>
          <section style={card}>
            <CardHead icon="eye" label="SICHTBARKEIT" tone="green" right={<SaveDot id="op-vis" />} />
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {VIS.map((v) => {
                const active = form.visibility === v.key;
                return (
                  <button key={v.key} type="button" data-testid={`edit-vis-${v.key}`} onClick={() => setNow("op-vis", { visibility: v.key }, { visibility: normalizeVisibility(v.key) })} style={{ display: "flex", alignItems: "center", gap: "0.6rem", width: "100%", padding: "0.6rem 0.7rem", borderRadius: 9, cursor: "pointer", textAlign: "left", transition: "all .12s", border: active ? "1px solid rgba(0,212,255,0.45)" : "1px solid rgba(255,255,255,0.08)", background: active ? "rgba(0,212,255,0.07)" : "transparent", color: active ? "var(--cyan)" : "#9fb1c2" }}>
                    <Ic name={v.icon} size={15} sw={1.6} />
                    <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: "0.84rem", color: "var(--text-hi)" }}>{v.label}</span><span style={{ display: "block", fontSize: "0.72rem", color: "var(--dim)" }}>{v.desc}</span></span>
                    {active && <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="check" size={15} sw={2} /></span>}
                  </button>
                );
              })}
            </div>
          </section>

          <section style={card}>
            <CardHead icon="mic" label="VOICE" tone="violet" right={<SaveDot id="op-voice" />} />
            <button
              type="button"
              data-testid="edit-squadlink-toggle"
              aria-pressed={voiceEnabled}
              onClick={onToggleVoice}
              style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", width: "100%", padding: "0.6rem 0.7rem", borderRadius: 9, cursor: "pointer", textAlign: "left", transition: "all .12s", border: voiceEnabled ? "1px solid rgba(160,100,255,0.45)" : "1px solid rgba(255,255,255,0.08)", background: voiceEnabled ? "rgba(160,100,255,0.07)" : "transparent", color: voiceEnabled ? "var(--purple)" : "#9fb1c2" }}
            >
              <Ic name={voiceEnabled ? "check" : "mic"} size={15} sw={1.7} />
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: "0.84rem", color: "var(--text-hi)" }}>SquadLink Voice</span>
                <span style={{ display: "block", fontSize: "0.72rem", color: "var(--dim)" }}>Commandanten bekommen ab Op-Start einen Direktlink in den CommandNet-Sprachraum.</span>
              </span>
            </button>
          </section>

          <div className="danger">
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.06em", color: "#ff6b6b", marginBottom: "0.5rem" }}><Ic name="alert" size={14} sw={1.7} /> GEFAHRENZONE</div>
            {confirmDel ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <span style={{ color: "var(--text)", fontSize: "0.85rem" }}>Operation unwiderruflich löschen?</span>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" data-testid="edit-delete-confirm" disabled={busy || !csrf} onClick={remove} style={{ flex: 1, padding: "0.5rem", border: "1px solid rgba(255,68,68,0.5)", background: "rgba(255,68,68,0.12)", color: "var(--red)", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 8, cursor: "pointer" }}>Endgültig löschen</button>
                  <button type="button" disabled={busy} onClick={() => setConfirmDel(false)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.5rem 1.1rem", border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: "#9fb1c2", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 8, cursor: "pointer" }}>Abbrechen</button>
                </div>
              </div>
            ) : (
              <button type="button" data-testid="edit-delete" disabled={busy} onClick={() => setConfirmDel(true)} style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0.55rem", border: "1px solid rgba(255,68,68,0.4)", background: "rgba(255,68,68,0.07)", color: "var(--red)", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 8, cursor: "pointer" }}><Ic name="x" size={14} sw={1.8} /> Operation löschen</button>
            )}
          </div>
        </div>
      </div>

      <style>{`@media (max-width: 860px){.fpw-edit-grid{display:flex !important;flex-direction:column}.fpw-two{grid-template-columns:1fr !important}}`}</style>
    </div>
  );
}
