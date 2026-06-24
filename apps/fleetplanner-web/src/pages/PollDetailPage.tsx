import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  addPollOption,
  ApiError,
  closePoll,
  deletePoll,
  getPoll,
  updatePoll,
  votePoll,
  withdrawPollVote,
} from "../api/client";
import type { PollDetail, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { visibilityTag } from "./PollsPage";

const MONO = "var(--mono)";
type ResultsVis = "always" | "after_vote" | "after_close";
type EditState = {
  title: string;
  description: string;
  options: Array<{ id?: string; label: string }>;
  closesAt: string;
  allowAddOptions: boolean;
  resultsVisibility: ResultsVis;
  maxChoices: string;
};

// ISO → value for <input type="datetime-local"> (local wall-clock, no seconds).
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Tag({ label, color, bg, bd }: { label: string; color: string; bg: string; bd: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.08em", padding: "0.16rem 0.45rem", borderRadius: 4, border: `1px solid ${bd}`, background: bg, color, textTransform: "uppercase", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

export function PollDetailPage({ session }: { session: SessionResponse | null }) {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const csrf = session?.csrfToken ?? null;

  const [poll, setPoll] = useState<PollDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [newOption, setNewOption] = useState("");
  const [edit, setEdit] = useState<EditState | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getPoll(id)
      .then((p) => {
        setPoll(p);
        setSelected(new Set(p.yourOptionIds));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Umfrage nicht ladbar."))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="fpw-meta">Lade…</p>;
  if (error || !poll) return <p className="fpw-meta" style={{ color: "#ff7a7a" }}>{error ?? "Umfrage nicht gefunden."}</p>;

  const totalForBars = poll.options.reduce((s, o) => s + o.votes, 0);
  const maxVotes = Math.max(1, ...poll.options.map((o) => o.votes));

  function toggle(optionId: string) {
    if (!poll) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (poll.mode === "single") {
        next.clear();
        next.add(optionId);
      } else {
        if (next.has(optionId)) next.delete(optionId);
        else if (!poll.maxChoices || next.size < poll.maxChoices) next.add(optionId);
      }
      return next;
    });
  }

  async function run(fn: () => Promise<unknown>) {
    if (!csrf) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  function openEdit() {
    if (!poll) return;
    setError(null);
    setEdit({
      title: poll.title,
      description: poll.description ?? "",
      options: poll.options.map((o) => ({ id: o.id, label: o.label })),
      closesAt: poll.closesAt ? toLocalInput(poll.closesAt) : "",
      allowAddOptions: poll.allowAddOptions,
      resultsVisibility: poll.resultsVisibility as ResultsVis,
      maxChoices: poll.maxChoices ? String(poll.maxChoices) : "2",
    });
  }

  async function saveEdit() {
    if (!edit || !csrf) return;
    const opts = edit.options.map((o) => ({ id: o.id, label: o.label.trim() })).filter((o) => o.label.length > 0);
    if (edit.title.trim().length === 0 || opts.length < 2) {
      setError("Titel und mindestens zwei Optionen sind erforderlich.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updatePoll(poll!.id, csrf, {
        title: edit.title.trim(),
        description: edit.description.trim() || null,
        options: opts,
        closesAt: edit.closesAt ? new Date(edit.closesAt).toISOString() : null,
        allowAddOptions: edit.allowAddOptions,
        resultsVisibility: edit.resultsVisibility,
        maxChoices: poll!.mode === "multiple" ? Math.min(30, Math.max(2, Number(edit.maxChoices) || 2)) : undefined,
      });
      setEdit(null);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  const vt = visibilityTag(poll.visibility);
  const closesLabel = poll.closesAt
    ? new Date(poll.closesAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div data-testid="poll-detail-page" style={{ width: "100%", maxWidth: 760 }}>
      <button onClick={() => nav("/polls")} className="fpw-btn" style={{ fontSize: "0.72rem", padding: "0.4rem 0.7rem", marginBottom: "1rem", borderColor: "rgba(159,182,201,0.3)", color: "var(--dim)", background: "transparent" }}>
        <Ic name="back" size={13} /> Alle Umfragen
      </button>

      <div className="fpw-card">
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.7rem" }}>
          {poll.status === "open" ? (
            <Tag label="Offen" color="var(--green)" bg="rgba(0,255,136,0.08)" bd="rgba(0,255,136,0.4)" />
          ) : poll.status === "draft" ? (
            <Tag label="Entwurf" color="var(--gold)" bg="rgba(240,165,0,0.09)" bd="rgba(240,165,0,0.42)" />
          ) : (
            <Tag label="Geschlossen" color="#9fb6c9" bg="rgba(159,182,201,0.07)" bd="rgba(159,182,201,0.34)" />
          )}
          <Tag {...vt} />
          <Tag label={poll.mode === "multiple" ? `Mehrfach${poll.maxChoices ? ` · max ${poll.maxChoices}` : ""}` : "Einfach"} color="#9fb6c9" bg="rgba(159,182,201,0.07)" bd="rgba(159,182,201,0.34)" />
          {poll.anonymous && <Tag label="anonym" color="#9fb6c9" bg="rgba(159,182,201,0.07)" bd="rgba(159,182,201,0.34)" />}
        </div>

        <h1 data-testid="poll-title-display" style={{ fontWeight: 700, fontSize: "1.45rem", color: "#eaf4fb", margin: "0 0 0.5rem" }}>{poll.title}</h1>
        {poll.description && <p style={{ color: "#9fb1c2", fontSize: "0.95rem", whiteSpace: "pre-wrap", margin: "0 0 1rem" }}>{poll.description}</p>}

        {/* ── voting / options ── */}
        <div style={{ marginTop: "0.4rem" }}>
          {poll.options.map((o) => {
            const sel = selected.has(o.id);
            const youVoted = poll.yourOptionIds.includes(o.id);
            const pct = poll.showResults ? Math.round((o.votes / Math.max(1, totalForBars)) * 100) : 0;
            const win = poll.showResults && o.votes === maxVotes && maxVotes > 0;
            return (
              <div key={o.id} style={{ marginBottom: "0.6rem" }}>
                {poll.canVote ? (
                  <div
                    data-testid={`poll-option-${o.id}`}
                    onClick={() => !busy && toggle(o.id)}
                    style={{ display: "flex", alignItems: "center", gap: "0.8rem", padding: "0.7rem 0.8rem", border: `1px solid ${sel ? "rgba(0,255,136,0.5)" : "rgba(0,212,255,0.12)"}`, borderRadius: 10, background: sel ? "rgba(0,255,136,0.06)" : "rgba(255,255,255,0.013)", cursor: "pointer" }}
                  >
                    <span style={{ width: 20, height: 20, flexShrink: 0, border: `2px solid ${sel ? "var(--green)" : "rgba(159,182,201,0.5)"}`, borderRadius: poll.mode === "single" ? "50%" : 5, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--green)" }}>
                      {sel && (poll.mode === "single" ? <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--green)" }} /> : <Ic name="check" size={13} />)}
                    </span>
                    <span style={{ fontWeight: 600, color: "#dce8f0", flex: 1 }}>{o.label}</span>
                    {poll.showResults && <span style={{ fontFamily: MONO, fontSize: "0.8rem", color: "#9fb1c2" }}>{o.votes}</span>}
                  </div>
                ) : (
                  /* results-only row */
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.3rem" }}>
                      <span style={{ fontWeight: 600, color: "#dce8f0" }}>
                        {o.label}
                        {youVoted && <span style={{ fontFamily: MONO, fontSize: "0.55rem", color: "var(--green)", border: "1px solid rgba(0,255,136,0.4)", background: "rgba(0,255,136,0.08)", borderRadius: 4, padding: "0.05rem 0.3rem", marginLeft: "0.45rem", letterSpacing: "0.06em", textTransform: "uppercase" }}>deine Stimme</span>}
                      </span>
                      {poll.showResults && <span style={{ fontFamily: MONO, fontSize: "0.85rem", color: "#eaf4fb" }}>{pct}% <span style={{ color: "#7e92a4", fontSize: "0.7rem" }}>· {o.votes}</span></span>}
                    </div>
                    {poll.showResults && (
                      <div style={{ height: 9, borderRadius: 6, background: "var(--bg3)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 6, background: win ? "linear-gradient(90deg,var(--gold),#f5c451)" : "linear-gradient(90deg,var(--cyan),#5fe6ff)" }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!poll.showResults && (
          <p className="fpw-meta" style={{ fontSize: "0.82rem", marginTop: "0.5rem" }}>
            Ergebnis {poll.resultsVisibility === "after_close" ? "erst nach Schluss" : "nach deiner Stimme"} sichtbar.
          </p>
        )}

        {/* ── actions ── */}
        {poll.canVote && (
          <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem", flexWrap: "wrap" }}>
            <button
              data-testid="poll-vote-submit"
              onClick={() => void run(() => votePoll(poll.id, csrf!, [...selected]))}
              disabled={busy || selected.size === 0}
              className="fpw-btn"
              style={{ borderColor: "rgba(0,255,136,0.5)", background: "rgba(0,255,136,0.12)", color: "var(--green)", opacity: busy || selected.size === 0 ? 0.4 : 1 }}
            >
              {poll.viewerHasVoted ? "Auswahl aktualisieren" : "Stimme abgeben"}
            </button>
            {poll.viewerHasVoted && (
              <button data-testid="poll-vote-withdraw" onClick={() => void run(() => withdrawPollVote(poll.id, csrf!))} disabled={busy} className="fpw-btn" style={{ borderColor: "rgba(159,182,201,0.3)", color: "var(--dim)", background: "transparent" }}>
                Stimme zurückziehen
              </button>
            )}
          </div>
        )}
        {!session?.user && <p className="fpw-meta" style={{ marginTop: "0.8rem" }}>Melde dich an, um abzustimmen.</p>}

        {/* add option */}
        {poll.allowAddOptions && poll.canVote && (
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <input
              value={newOption}
              onChange={(e) => setNewOption(e.target.value)}
              placeholder="Eigene Option vorschlagen…"
              maxLength={200}
              style={{ flex: 1, boxSizing: "border-box", background: "var(--bg)", border: "1px solid rgba(0,212,255,0.16)", borderRadius: 8, color: "#eaf4fb", fontFamily: "var(--body)", fontSize: "0.95rem", padding: "0.55rem 0.7rem" }}
            />
            <button
              onClick={() => void run(async () => { await addPollOption(poll.id, csrf!, newOption.trim()); setNewOption(""); })}
              disabled={busy || newOption.trim().length === 0}
              className="fpw-btn"
              style={{ fontSize: "0.72rem", opacity: busy || newOption.trim().length === 0 ? 0.4 : 1 }}
            >
              <Ic name="plus" size={13} /> Hinzufügen
            </button>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem 1rem", flexWrap: "wrap", fontFamily: MONO, fontSize: "0.66rem", color: "#7e92a4", letterSpacing: "0.04em", marginTop: "1.2rem", paddingTop: "0.9rem", borderTop: "1px solid rgba(0,212,255,0.12)" }}>
          <span><Ic name="users" size={12} /> {poll.totalVotes} Stimmen</span>
          {closesLabel && <span><Ic name="clock" size={12} /> {poll.status === "closed" ? "beendet" : `schließt ${closesLabel}`}</span>}
          <span>{poll.guild.name} · von {poll.createdBy.username}</span>
        </div>
      </div>

      {/* ── manager controls ── */}
      {poll.canManage && (
        <div className="fpw-card" style={{ marginTop: "1rem" }}>
          <div style={{ fontFamily: MONO, fontSize: "0.64rem", letterSpacing: "0.1em", color: "#9fb1c2", textTransform: "uppercase", marginBottom: "0.7rem" }}>Verwaltung</div>

          {edit ? (
            <PollEditForm edit={edit} setEdit={setEdit} mode={poll.mode} busy={busy} onSave={() => void saveEdit()} onCancel={() => setEdit(null)} />
          ) : (
            <>
              <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                {poll.totalVotes === 0 && (
                  <button onClick={openEdit} disabled={busy} className="fpw-btn"><Ic name="edit" size={13} /> Bearbeiten</button>
                )}
                {poll.status === "open" && (
                  <button data-testid="poll-close" onClick={() => void run(() => closePoll(poll.id, csrf!))} disabled={busy} className="fpw-btn" style={{ borderColor: "rgba(240,165,0,0.5)", background: "rgba(240,165,0,0.1)", color: "var(--gold)" }}>
                    <Ic name="lock" size={13} /> Umfrage schließen
                  </button>
                )}
                <button
                  data-testid="poll-delete"
                  onClick={() => { if (window.confirm("Umfrage wirklich löschen? Das kann nicht rückgängig gemacht werden.")) void run(async () => { await deletePoll(poll.id, csrf!); nav("/polls"); }); }}
                  disabled={busy}
                  className="fpw-btn"
                  style={{ borderColor: "rgba(255,68,68,0.4)", background: "rgba(255,68,68,0.08)", color: "var(--red2)" }}
                >
                  <Ic name="x" size={13} /> Löschen
                </button>
              </div>
              {poll.totalVotes > 0 && (
                <p className="fpw-meta" style={{ fontSize: "0.82rem", marginTop: "0.7rem" }}>
                  Bearbeiten ist nicht mehr möglich — es wurden bereits Stimmen abgegeben. Du kannst die Umfrage nur noch schließen oder löschen.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const editInput: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--bg)", border: "1px solid rgba(0,212,255,0.16)",
  borderRadius: 8, color: "#eaf4fb", fontFamily: "var(--body)", fontSize: "0.95rem", padding: "0.55rem 0.7rem", outline: "none",
};
const editLabel: React.CSSProperties = {
  display: "block", fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.1em", color: "#9fb1c2", textTransform: "uppercase", marginBottom: "0.35rem",
};

function PollEditForm({
  edit, setEdit, mode, busy, onSave, onCancel,
}: {
  edit: EditState;
  setEdit: React.Dispatch<React.SetStateAction<EditState | null>>;
  mode: "single" | "multiple";
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const patch = (p: Partial<EditState>) => setEdit((e) => (e ? { ...e, ...p } : e));
  const setOpt = (i: number, label: string) => setEdit((e) => (e ? { ...e, options: e.options.map((o, idx) => (idx === i ? { ...o, label } : o)) } : e));
  const addOpt = () => setEdit((e) => (e ? { ...e, options: [...e.options, { label: "" }] } : e));
  const removeOpt = (i: number) => setEdit((e) => (e && e.options.length > 2 ? { ...e, options: e.options.filter((_, idx) => idx !== i) } : e));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <label style={editLabel}>Titel</label>
        <input style={editInput} value={edit.title} maxLength={200} onChange={(e) => patch({ title: e.target.value })} />
      </div>
      <div>
        <label style={editLabel}>Beschreibung</label>
        <textarea style={{ ...editInput, minHeight: 72, resize: "vertical" }} value={edit.description} maxLength={4000} onChange={(e) => patch({ description: e.target.value })} />
      </div>
      <div>
        <label style={editLabel}>Optionen</label>
        {edit.options.map((o, i) => (
          <div key={o.id ?? `new-${i}`} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
            <input style={editInput} value={o.label} maxLength={200} onChange={(e) => setOpt(i, e.target.value)} placeholder={`Option ${i + 1}`} />
            {edit.options.length > 2 && (
              <button onClick={() => removeOpt(i)} title="Entfernen" style={{ color: "var(--red)", border: "1px solid rgba(255,68,68,0.3)", background: "rgba(255,68,68,0.06)", borderRadius: 7, padding: "0.5rem 0.6rem", cursor: "pointer" }}><Ic name="x" size={13} /></button>
            )}
          </div>
        ))}
        <button onClick={addOpt} className="fpw-btn" style={{ fontSize: "0.72rem", padding: "0.45rem 0.7rem" }}><Ic name="plus" size={13} /> Option hinzufügen</button>
      </div>
      {mode === "multiple" && (
        <div>
          <label style={editLabel}>Max. Auswahl</label>
          <input type="number" min={2} max={30} value={edit.maxChoices} onChange={(e) => patch({ maxChoices: e.target.value })} onBlur={(e) => patch({ maxChoices: String(Math.min(30, Math.max(2, Number(e.target.value) || 2))) })} style={{ ...editInput, width: 100 }} />
        </div>
      )}
      <div>
        <label style={editLabel}>Ergebnis sichtbar</label>
        <select value={edit.resultsVisibility} onChange={(e) => patch({ resultsVisibility: e.target.value as ResultsVis })} style={{ ...editInput, width: "auto" }}>
          <option value="always">immer</option>
          <option value="after_vote">nach eigener Stimme</option>
          <option value="after_close">nach Schluss</option>
        </select>
      </div>
      <div>
        <label style={editLabel}>Automatisch schließen (optional)</label>
        <input type="datetime-local" value={edit.closesAt} onChange={(e) => patch({ closesAt: e.target.value })} style={{ ...editInput, width: "auto" }} />
      </div>
      <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", color: "#dce8f0", fontSize: "0.92rem", cursor: "pointer" }}>
        <input type="checkbox" checked={edit.allowAddOptions} onChange={(e) => patch({ allowAddOptions: e.target.checked })} />
        Eigene Optionen erlauben
      </label>
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
        <button onClick={onSave} disabled={busy} className="fpw-btn" style={{ borderColor: "rgba(0,255,136,0.5)", background: "rgba(0,255,136,0.12)", color: "var(--green)" }}><Ic name="save" size={13} /> Speichern</button>
        <button onClick={onCancel} disabled={busy} className="fpw-btn" style={{ borderColor: "rgba(159,182,201,0.3)", color: "var(--dim)", background: "transparent" }}>Abbrechen</button>
      </div>
    </div>
  );
}
