import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, createRecurrence, deleteOperation, editOperation, getOperation, publishTemplate, setOperationStatus, stopRecurrence } from "../api/client";
import type { OperationDetail, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { NeedsEditor } from "../components/NeedsEditor";
import { CardHead, MONO, actionBar, btnGhost, btnPrimary, card, inp, lbl, segChip, ta } from "../components/ui";

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
  { key: "guild", label: "Guild", desc: "Mitglieder dieses Servers", icon: "server" },
  { key: "private", label: "Privat", desc: "Nur Operatoren", icon: "lock" },
  { key: "partners", label: "Partner", desc: "Verbündete Server sehen es", icon: "link" },
  { key: "public", label: "Öffentlich", desc: "Instanzweit sichtbar", icon: "globe" },
];
const SYSTEMS = ["Stanton", "Pyro", "Nyx"];
const STATUSES: Array<[string, string]> = [
  ["draft", "Entwurf"], ["open", "Offen"], ["locked", "Gesperrt"], ["starting", "Startet"],
  ["in_progress", "Läuft"], ["completed", "Abgeschlossen"], ["cancelled", "Abgesagt"],
];

function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function EditOpPage({ session }: { session: SessionResponse | null }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const csrf = session?.csrfToken ?? null;

  const [op, setOp] = useState<OperationDetail | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [form, setForm] = useState({ title: "", description: "", opType: "combat", scheduledAt: "", meetingSystem: "Stanton", meetingLocation: "", visibility: "guild" });
  const [saved, setSaved] = useState(form);
  const [status, setStatusValue] = useState("draft");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [tpl, setTpl] = useState({ name: "", summary: "", visibility: "guild" });
  const [recur, setRecur] = useState({ freq: "weekly", seriesCount: "", seriesEnd: "" });

  function reload() {
    if (!id) return;
    getOperation(id)
      .then((o) => {
        setOp(o);
        const next = { title: o.title, description: o.description ?? "", opType: o.opType, scheduledAt: isoToLocalInput(o.scheduledAt), meetingSystem: o.meetingSystem || "Stanton", meetingLocation: o.meetingLocation ?? "", visibility: o.visibility };
        setForm(next);
        setSaved(next);
        setStatusValue(o.status);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e : new ApiError(0, null)));
  }
  useEffect(reload, [id]);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  async function run(action: () => Promise<unknown>, msg: string) {
    if (!csrf || !id) return;
    setBusy(true); setNotice(null);
    try { await action(); setNotice(msg); reload(); }
    catch (e) { setNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  const save = () => run(() => editOperation(id!, csrf!, {
    title: form.title.trim(), description: form.description, opType: form.opType,
    meetingSystem: form.meetingSystem.trim(), meetingLocation: form.meetingLocation.trim(),
    scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined, visibility: form.visibility,
  }), "Gespeichert.");
  const changeStatus = (next: string) => run(() => setOperationStatus(id!, csrf!, next), `Status: ${next}.`);
  const publish = () => run(() => publishTemplate(id!, csrf!, { name: tpl.name.trim() || undefined, summary: tpl.summary.trim() || undefined, visibility: tpl.visibility }), "Als Vorlage veröffentlicht.");
  const makeSeries = () => run(() => createRecurrence(id!, csrf!, { freq: recur.freq, seriesCount: recur.seriesCount ? Number(recur.seriesCount) : undefined, seriesEnd: recur.seriesEnd ? new Date(recur.seriesEnd).toISOString() : undefined }), "Serie erstellt.");
  async function stopSeries() {
    if (!csrf || !id) return;
    setBusy(true); setNotice(null);
    try { const r = await stopRecurrence(id, csrf); setNotice(r.stopped ? "Serie gestoppt." : "Diese Operation ist keine Serie."); }
    catch (e) { setNotice(e instanceof ApiError ? e.message : "Stoppen fehlgeschlagen."); } finally { setBusy(false); }
  }
  async function remove() {
    if (!csrf || !id) return;
    setBusy(true); setNotice(null);
    try { await deleteOperation(id, csrf); navigate("/"); }
    catch (e) { setNotice(e instanceof ApiError ? e.message : "Löschen fehlgeschlagen."); setBusy(false); }
  }

  if (loadError)
    return <div className="fpw-state" data-testid="edit-error"><span style={lbl}>OPERATION {loadError.status === 404 ? "NICHT GEFUNDEN" : "NICHT LADBAR"}</span><Link className="fpw-btn" to="/">Zurück</Link></div>;
  if (session === null || !op) return <div className="fpw-state"><span style={lbl}>LADE…</span></div>;
  if (!op.canManage)
    return <div className="fpw-state" data-testid="edit-forbidden"><span style={lbl}>KEINE OPERATOR-RECHTE</span><Link className="fpw-btn" to={`/ops/${id}`}>Zur Operation</Link></div>;

  return (
    <div data-testid="edit-op-page" style={{ maxWidth: 1080, margin: "0 auto" }}>
      {/* header */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "0.6rem 1rem", marginBottom: "1.4rem" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.4rem" }}>
            <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="edit" size={17} sw={1.7} /></span>
            <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.14em", color: "var(--dim2)" }}>OPERATION // BEARBEITEN</span>
          </div>
          <h1 style={{ fontWeight: 700, fontSize: "1.7rem", lineHeight: 1.12, color: "var(--text-hi)", margin: "0 0 0.4rem" }}>{op.title}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--dim)", fontSize: "0.8rem", fontFamily: MONO }}><Ic name="server" size={13} sw={1.6} /> {op.guild.name} · OP-ID {op.id.slice(-6)}</div>
        </div>
        {dirty && <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.05em", padding: "3px 8px", borderRadius: 5, border: "1px solid rgba(240,165,0,0.4)", background: "rgba(240,165,0,0.1)", color: "var(--gold)", flexShrink: 0, marginTop: "0.2rem" }}>UNGESPEICHERT</span>}
      </div>

      {notice && <p className="fpw-tag gold" role="alert" data-testid="edit-notice" style={{ display: "inline-flex", marginBottom: "1rem" }}>{notice}</p>}

      <div className="fpw-edit-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1fr)", gap: "1rem", alignItems: "start" }}>
        {/* main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 }}>
          {/* Eckdaten */}
          <section style={card}>
            <CardHead icon="bolt" label="ECKDATEN" tone="cyan" />
            <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
              <div>
                <label style={lbl}>Operationstitel <span style={{ color: "var(--gold)" }}>*</span></label>
                <input data-testid="edit-title" type="text" maxLength={160} value={form.title} onChange={(e) => set({ title: e.target.value })} style={inp} />
              </div>
              <div>
                <label style={lbl}>Datum &amp; Zeit <span style={{ color: "var(--gold)" }}>*</span></label>
                <input data-testid="edit-scheduled" type="datetime-local" value={form.scheduledAt} onChange={(e) => set({ scheduledAt: e.target.value })} style={inp} />
              </div>
              <div>
                <label style={lbl}>Operationstyp</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {OP_TYPES.map((t) => <button key={t.key} type="button" data-testid={`edit-type-${t.key}`} onClick={() => set({ opType: t.key })} style={segChip(form.opType === t.key, t.color, t.rgb)}><Ic name={t.icon} size={14} sw={1.7} />{t.label}</button>)}
                </div>
              </div>
            </div>
          </section>

          {/* Treffpunkt */}
          <section style={card}>
            <CardHead icon="pin" label="TREFFPUNKT" tone="violet" />
            <div className="fpw-two" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.9rem" }}>
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

          {/* Briefing */}
          <section style={card}>
            <CardHead icon="doc" label="BRIEFING" tone="cyan" right={<span style={{ fontFamily: MONO, fontSize: "0.6rem", color: "var(--dim2)" }}>Markdown</span>} />
            <textarea data-testid="edit-description" value={form.description} maxLength={4000} onChange={(e) => set({ description: e.target.value })} placeholder={"## Missionsziel\n…\n\n## Einsatzregeln\n…"} style={ta} />
          </section>

          {/* Status */}
          <section style={card}>
            <CardHead icon="bolt" label={`STATUS · AKTUELL ${op.status.toUpperCase()}`} tone="green" />
            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
              <select data-testid="edit-status" value={status} onChange={(e) => setStatusValue(e.target.value)} style={{ ...inp, width: "auto", minWidth: 180 }}>
                {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button type="button" data-testid="edit-status-apply" style={btnPrimary} disabled={busy || !csrf || status === op.status} onClick={() => changeStatus(status)}>Status setzen</button>
            </div>
          </section>

          {/* Bedarfe */}
          {id && <NeedsEditor opId={id} csrf={csrf} />}

          {/* Admin: template + recurrence */}
          <section style={card}>
            <CardHead icon="board" label="ADMIN" tone="gold" />
            <div style={{ ...lbl, fontSize: "0.6rem", marginBottom: "0.5rem" }}>ALS VORLAGE VERÖFFENTLICHEN</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "1.2rem" }}>
              <input data-testid="tpl-name" type="text" maxLength={120} value={tpl.name} placeholder={`Name (Standard: ${op.title})`} onChange={(e) => setTpl((t) => ({ ...t, name: e.target.value }))} style={inp} />
              <input data-testid="tpl-summary" type="text" maxLength={500} value={tpl.summary} placeholder="Kurzbeschreibung" onChange={(e) => setTpl((t) => ({ ...t, summary: e.target.value }))} style={inp} />
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                <select data-testid="tpl-visibility" value={tpl.visibility} onChange={(e) => setTpl((t) => ({ ...t, visibility: e.target.value }))} style={{ ...inp, width: "auto", minWidth: 160 }}>
                  <option value="guild">Guild</option><option value="partners">Partner-Guilds</option><option value="public">Öffentlich</option>
                </select>
                <button type="button" data-testid="tpl-publish" style={btnPrimary} disabled={busy || !csrf} onClick={publish}><Ic name="board" size={13} sw={2} /> Veröffentlichen</button>
              </div>
            </div>
            <div style={{ ...lbl, fontSize: "0.6rem", marginBottom: "0.5rem" }}>WIEDERKEHRENDE SERIE</div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.6rem" }}>
              <select data-testid="recur-freq" value={recur.freq} onChange={(e) => setRecur((r) => ({ ...r, freq: e.target.value }))} style={{ ...inp, width: "auto", minWidth: 150 }}>
                <option value="weekly">Wöchentlich</option><option value="biweekly">Zweiwöchentlich</option><option value="monthly_nth">Monatlich</option><option value="yearly">Jährlich</option>
              </select>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "var(--dim)", fontSize: "0.82rem" }}>Anzahl<input data-testid="recur-count" type="number" min={1} max={365} value={recur.seriesCount} placeholder="∞" onChange={(e) => setRecur((r) => ({ ...r, seriesCount: e.target.value }))} style={{ ...inp, width: 80 }} /></label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "var(--dim)", fontSize: "0.82rem" }}>bis<input data-testid="recur-until" type="date" value={recur.seriesEnd} onChange={(e) => setRecur((r) => ({ ...r, seriesEnd: e.target.value }))} style={{ ...inp, width: 160 }} /></label>
              <button type="button" data-testid="recur-create" style={btnPrimary} disabled={busy || !csrf} onClick={makeSeries}>Serie erstellen</button>
            </div>
            <button type="button" data-testid="recurrence-stop" style={btnGhost} disabled={busy || !csrf} onClick={stopSeries}>Serie stoppen</button>
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

          {/* Gefahrenzone */}
          <div style={{ border: "1px solid rgba(255,68,68,0.25)", borderRadius: 13, background: "rgba(255,68,68,0.04)", padding: "1rem 1.1rem" }}>
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

      {/* sticky action bar */}
      <div style={actionBar}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--dim)", fontSize: "0.78rem" }}><span style={{ color: "var(--gold)" }}><Ic name="alert" size={14} sw={1.7} /></span><span style={{ color: "var(--gold)" }}>*</span> Pflichtfeld</div>
        <div style={{ flex: 1 }} />
        <Link to={`/ops/${id}`} style={{ ...btnGhost, textDecoration: "none" }}>Abbrechen</Link>
        <button type="button" data-testid="edit-save" style={{ ...btnPrimary, opacity: dirty ? 1 : 0.7 }} disabled={busy || !csrf} onClick={save}><Ic name="save" size={15} sw={1.8} /> Änderungen speichern</button>
      </div>

      <style>{`@media (max-width: 860px){.fpw-edit-grid{display:flex !important;flex-direction:column}.fpw-two{grid-template-columns:1fr !important}}`}</style>
    </div>
  );
}
