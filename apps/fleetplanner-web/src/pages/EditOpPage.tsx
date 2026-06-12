import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, deleteOperation, editOperation, getOperation, setOperationStatus } from "../api/client";
import type { OperationDetail, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { NeedsEditor } from "../components/NeedsEditor";

const MONO = "var(--mono)";
const label: React.CSSProperties = { fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.12em", color: "#9fb1c2", marginBottom: "0.7rem" };
const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--bg3)",
  border: "1px solid rgba(0,212,255,0.14)", color: "var(--text)", fontFamily: "var(--body)",
  fontSize: "0.95rem", padding: "0.55rem 0.7rem", borderRadius: 8, outline: "none",
};

const OP_TYPES = ["combat", "mining", "salvage", "explore", "transport", "training", "social"];
const VISIBILITIES: Array<[string, string]> = [
  ["private", "Privat (nur eigene Guild)"],
  ["guild", "Guild"],
  ["partners", "Partner-Guilds"],
  ["public", "Öffentlich"],
];
const STATUSES: Array<[string, string]> = [
  ["draft", "Entwurf"], ["open", "Offen"], ["locked", "Gesperrt"], ["starting", "Startet"],
  ["in_progress", "Läuft"], ["completed", "Abgeschlossen"], ["cancelled", "Abgesagt"],
];

// ISO ↔ <input type="datetime-local"> in the browser's local timezone.
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
  const [form, setForm] = useState({
    title: "", description: "", opType: "combat",
    scheduledAt: "", meetingSystem: "", meetingLocation: "", visibility: "guild",
  });
  const [status, setStatusValue] = useState("draft");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  function reload() {
    if (!id) return;
    getOperation(id)
      .then((o) => {
        setOp(o);
        setForm({
          title: o.title,
          description: o.description ?? "",
          opType: o.opType,
          scheduledAt: isoToLocalInput(o.scheduledAt),
          meetingSystem: o.meetingSystem ?? "",
          meetingLocation: o.meetingLocation ?? "",
          visibility: o.visibility,
        });
        setStatusValue(o.status);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e : new ApiError(0, null)));
  }
  useEffect(reload, [id]);

  async function save() {
    if (!csrf || !id) return;
    setBusy(true);
    setNotice(null);
    try {
      await editOperation(id, csrf, {
        title: form.title.trim(),
        description: form.description,
        opType: form.opType,
        meetingSystem: form.meetingSystem.trim(),
        meetingLocation: form.meetingLocation.trim(),
        scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : undefined,
        visibility: form.visibility,
      });
      setNotice("Gespeichert.");
      reload();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(next: string) {
    if (!csrf || !id) return;
    setBusy(true);
    setNotice(null);
    try {
      await setOperationStatus(id, csrf, next);
      setNotice(`Status: ${next}.`);
      reload();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Status nicht änderbar.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!csrf || !id) return;
    setBusy(true);
    setNotice(null);
    try {
      await deleteOperation(id, csrf);
      navigate("/");
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Löschen fehlgeschlagen.");
      setBusy(false);
    }
  }

  if (loadError) {
    const code = loadError.status === 404 ? "nicht gefunden" : "nicht ladbar";
    return <div className="fpw-state" data-testid="edit-error"><span style={label}>OPERATION {code.toUpperCase()}</span><Link className="fpw-btn" to="/">Zurück</Link></div>;
  }
  if (session === null || !op) return <div className="fpw-state"><span style={label}>LADE…</span></div>;
  if (!op.canManage)
    return (
      <div className="fpw-state" data-testid="edit-forbidden">
        <span style={label}>KEINE OPERATOR-RECHTE</span>
        <Link className="fpw-btn" to={`/ops/${id}`}>Zur Operation</Link>
      </div>
    );

  return (
    <div data-testid="edit-op-page" style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.4rem" }}>
        <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="board" size={20} /></span>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", color: "#eaf4fb", margin: 0 }}>Operation bearbeiten</h1>
      </div>
      <p className="fpw-meta" style={{ marginBottom: "1.5rem" }}>
        <Link to={`/ops/${id}`}>← {op.title}</Link>
      </p>

      {notice && <p className="fpw-tag gold" role="alert" data-testid="edit-notice" style={{ display: "inline-flex", marginBottom: "1rem" }}>{notice}</p>}

      <section className="fpw-card" style={{ marginBottom: "1.2rem" }}>
        <div style={label}>STATUS · AKTUELL {op.status.toUpperCase()}</div>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <select data-testid="edit-status" value={status} onChange={(e) => setStatusValue(e.target.value)} style={{ ...field, width: "auto", minWidth: 180 }}>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button type="button" data-testid="edit-status-apply" className="fpw-btn" disabled={busy || !csrf || status === op.status} onClick={() => changeStatus(status)}>
            Status setzen
          </button>
        </div>
      </section>

      <section className="fpw-card" style={{ marginBottom: "1.2rem" }}>
        <div style={label}>OPERATION</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <label style={{ display: "block" }}>
            <span style={label}>TITEL</span>
            <input data-testid="edit-title" type="text" maxLength={160} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} style={field} />
          </label>
          <div style={{ display: "flex", gap: "0.9rem", flexWrap: "wrap" }}>
            <label style={{ flex: "1 1 200px" }}>
              <span style={label}>TYP</span>
              <select data-testid="edit-optype" value={form.opType} onChange={(e) => setForm((f) => ({ ...f, opType: e.target.value }))} style={field}>
                {OP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label style={{ flex: "1 1 200px" }}>
              <span style={label}>SICHTBARKEIT</span>
              <select data-testid="edit-visibility" value={form.visibility} onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value }))} style={field}>
                {VISIBILITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
          <label style={{ display: "block" }}>
            <span style={label}>ZEITPUNKT</span>
            <input data-testid="edit-scheduled" type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))} style={field} />
          </label>
          <div style={{ display: "flex", gap: "0.9rem", flexWrap: "wrap" }}>
            <label style={{ flex: "1 1 200px" }}>
              <span style={label}>SYSTEM</span>
              <input data-testid="edit-system" type="text" maxLength={80} value={form.meetingSystem} onChange={(e) => setForm((f) => ({ ...f, meetingSystem: e.target.value }))} style={field} />
            </label>
            <label style={{ flex: "1 1 200px" }}>
              <span style={label}>TREFFPUNKT</span>
              <input data-testid="edit-location" type="text" maxLength={160} value={form.meetingLocation} onChange={(e) => setForm((f) => ({ ...f, meetingLocation: e.target.value }))} style={field} />
            </label>
          </div>
          <label style={{ display: "block" }}>
            <span style={label}>MISSIONSZIEL</span>
            <textarea data-testid="edit-description" rows={5} maxLength={4000} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} style={{ ...field, resize: "vertical", fontFamily: "var(--body)" }} />
          </label>
          <div>
            <button type="button" data-testid="edit-save" className="fpw-btn" disabled={busy || !csrf} onClick={save}>
              <Ic name="check" size={13} sw={2} /> Speichern
            </button>
          </div>
        </div>
      </section>

      {id && <NeedsEditor opId={id} csrf={csrf} />}

      <section className="fpw-card" style={{ border: "1px solid rgba(255,68,68,0.3)" }}>
        <div style={{ ...label, color: "#ff6b6b" }}>GEFAHRENZONE</div>
        {confirmDel ? (
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: "#ccdde8", fontSize: "0.9rem" }}>Operation unwiderruflich löschen?</span>
            <button type="button" data-testid="edit-delete-confirm" disabled={busy || !csrf} onClick={remove} style={{ padding: "0.4rem 0.8rem", borderRadius: 7, border: "1px solid rgba(255,68,68,0.5)", background: "rgba(255,68,68,0.12)", color: "#ff6b6b", cursor: "pointer", fontFamily: MONO, fontSize: "0.72rem" }}>
              Endgültig löschen
            </button>
            <button type="button" className="fpw-btn" disabled={busy} onClick={() => setConfirmDel(false)} style={{ padding: "0.4rem 0.8rem", fontSize: "0.72rem" }}>Abbrechen</button>
          </div>
        ) : (
          <button type="button" data-testid="edit-delete" disabled={busy} onClick={() => setConfirmDel(true)} style={{ padding: "0.4rem 0.8rem", borderRadius: 7, border: "1px solid rgba(255,68,68,0.4)", background: "rgba(255,68,68,0.08)", color: "#ff6b6b", cursor: "pointer", fontFamily: MONO, fontSize: "0.72rem" }}>
            <Ic name="x" size={12} sw={2} /> Operation löschen
          </button>
        )}
      </section>
    </div>
  );
}
