import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, createPoll } from "../api/client";
import type { CreatePollRequest, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";

const MONO = "var(--mono)";
type Visibility = "private" | "partners" | "public";
type Mode = "single" | "multiple";
type ResultsVis = "always" | "after_vote" | "after_close";

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--bg)", border: "1px solid var(--border)",
  borderRadius: 8, color: "var(--text-hi)", fontFamily: "var(--body)", fontSize: "0.98rem", padding: "0.6rem 0.75rem", outline: "none",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontFamily: MONO, fontSize: "0.64rem", letterSpacing: "0.1em", color: "var(--dim)", textTransform: "uppercase", marginBottom: "0.4rem",
};

export function PollCreatePage({ session }: { session: SessionResponse | null }) {
  const nav = useNavigate();
  const csrf = session?.csrfToken ?? null;
  const memberships = session?.memberships ?? [];
  // Partner/public scope needs the fleetoperator role; private is open to any member.
  const operatorGuildIds = useMemo(() => new Set(memberships.filter((m) => m.role === "fleetoperator").map((m) => m.guildId)), [memberships]);

  const [guildId, setGuildId] = useState<string>(memberships[0]?.guildId ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [mode, setMode] = useState<Mode>("single");
  const [maxChoices, setMaxChoices] = useState<string>("2");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [anonymous, setAnonymous] = useState(false);
  const [resultsVisibility, setResultsVisibility] = useState<ResultsVis>("always");
  const [allowAddOptions, setAllowAddOptions] = useState(false);
  const [closesAt, setClosesAt] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session?.user) return <p className="fpw-meta">Bitte einloggen, um eine Umfrage zu erstellen.</p>;
  if (memberships.length === 0) return <p className="fpw-meta">Du bist auf keinem Server Mitglied — Umfragen sind serverbezogen.</p>;

  const canPartnerPublic = operatorGuildIds.has(guildId);
  const validOptions = options.map((o) => o.trim()).filter(Boolean);
  const canSubmit = title.trim().length > 0 && validOptions.length >= 2 && !!guildId && !saving;

  function setOption(i: number, v: string) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));
  }
  function addOption() {
    setOptions((prev) => [...prev, ""]);
  }
  function removeOption(i: number) {
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  async function submit(draft: boolean) {
    if (!csrf || !canSubmit) return;
    setSaving(true);
    setError(null);
    const body: CreatePollRequest = {
      guildId,
      title: title.trim(),
      description: description.trim() || undefined,
      options: validOptions,
      mode,
      maxChoices: mode === "multiple" ? Math.min(30, Math.max(2, Number(maxChoices) || 2)) : undefined,
      visibility: canPartnerPublic ? visibility : "private",
      anonymous,
      resultsVisibility,
      allowAddOptions,
      closesAt: closesAt ? new Date(closesAt).toISOString() : undefined,
      status: draft ? "draft" : "open",
    };
    try {
      const r = await createPoll(csrf, body);
      nav(`/polls/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Konnte nicht gespeichert werden.");
      setSaving(false);
    }
  }

  const pill = (on: boolean): React.CSSProperties => ({
    flex: 1, minWidth: 150, padding: "0.7rem 0.8rem", borderRadius: 10, cursor: "pointer",
    border: `1px solid ${on ? "rgba(43, 49, 53, 0.4)" : "rgba(43, 49, 53, 0.16)"}`,
    background: on ? "rgba(43, 49, 53, 0.08)" : "var(--bg)",
  });
  const Toggle = ({ on, set, label, hint }: { on: boolean; set: (v: boolean) => void; label: string; hint: string }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.6rem 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontWeight: 600, color: "var(--text)" }}>{label}<small style={{ display: "block", color: "var(--dim2)", fontWeight: 400, fontSize: "0.82rem" }}>{hint}</small></span>
      <span
        onClick={() => set(!on)}
        style={{ width: 42, height: 24, borderRadius: 14, flexShrink: 0, cursor: "pointer", position: "relative", background: on ? "rgba(91, 185, 138,0.18)" : "var(--bg3)", border: `1px solid ${on ? "rgba(91, 185, 138,0.5)" : "rgba(43, 49, 53, 0.16)"}` }}
      >
        <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: on ? "var(--green)" : "var(--dim2)", transition: "left 0.15s", boxShadow: on ? "0 0 8px var(--green)" : "none" }} />
      </span>
    </div>
  );

  return (
    <div data-testid="poll-create-page" style={{ width: "100%", maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1.1rem" }}>
        <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="check" size={20} /></span>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", color: "var(--text-hi)", margin: 0 }}>Neue Umfrage</h1>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "1rem" }}>
        <div className="fpw-card">
          {memberships.length > 1 && (
            <div style={{ marginBottom: "1.1rem" }}>
              <label style={labelStyle}>Server</label>
              <select value={guildId} onChange={(e) => setGuildId(e.target.value)} style={inputStyle}>
                {memberships.map((m) => <option key={m.guildId} value={m.guildId}>{m.guildName}</option>)}
              </select>
            </div>
          )}
          <div style={{ marginBottom: "1.1rem" }}>
            <label style={labelStyle}>Titel</label>
            <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Worüber wird abgestimmt?" maxLength={200} />
          </div>
          <div style={{ marginBottom: "1.1rem" }}>
            <label style={labelStyle}>Beschreibung (optional)</label>
            <textarea style={{ ...inputStyle, minHeight: 84, resize: "vertical" }} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
          </div>
          <div>
            <label style={labelStyle}>Optionen (mind. 2)</label>
            {options.map((o, i) => (
              <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
                <input style={inputStyle} value={o} onChange={(e) => setOption(i, e.target.value)} placeholder={`Option ${i + 1}`} maxLength={200} />
                {options.length > 2 && (
                  <button onClick={() => removeOption(i)} title="Entfernen" style={{ color: "var(--red)", border: "1px solid rgba(228, 115, 106,0.3)", background: "rgba(228, 115, 106,0.06)", borderRadius: 7, padding: "0.5rem 0.6rem", cursor: "pointer" }}><Ic name="x" size={13} /></button>
                )}
              </div>
            ))}
            <button onClick={addOption} className="fpw-btn" style={{ fontSize: "0.72rem", padding: "0.45rem 0.7rem" }}><Ic name="plus" size={13} /> Option hinzufügen</button>
          </div>
        </div>

        <div className="fpw-card">
          <div style={{ marginBottom: "1.1rem" }}>
            <label style={labelStyle}>Modus</label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <div style={pill(mode === "single")} onClick={() => setMode("single")}>
                <div style={{ fontWeight: 700, color: "var(--text-hi)" }}>Einfachauswahl</div>
                <div style={{ fontSize: "0.82rem", color: "var(--dim)" }}>Eine Stimme pro Person</div>
              </div>
              <div style={pill(mode === "multiple")} onClick={() => setMode("multiple")}>
                <div style={{ fontWeight: 700, color: "var(--text-hi)" }}>Mehrfachauswahl</div>
                <div style={{ fontSize: "0.82rem", color: "var(--dim)" }}>Bis max. N Optionen</div>
              </div>
            </div>
            {mode === "multiple" && (
              <div style={{ marginTop: "0.7rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <span style={{ color: "var(--dim)", fontSize: "0.9rem" }}>Max. Auswahl:</span>
                <input type="number" min={2} max={30} value={maxChoices} onChange={(e) => setMaxChoices(e.target.value)} onBlur={(e) => setMaxChoices(String(Math.min(30, Math.max(2, Number(e.target.value) || 2))))} style={{ ...inputStyle, width: 90 }} />
              </div>
            )}
          </div>

          <div style={{ marginBottom: "1.1rem" }}>
            <label style={labelStyle}>Sichtbarkeit</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {([
                ["private", "Privat — Nur dein Server", "Mitglieder deiner Guild", true],
                ["partners", "Partner", "Deine Guild + alle aktiven Partner-Server", canPartnerPublic],
                ["public", "Öffentlich — Open", "Jeder eingeloggte Nutzer", canPartnerPublic],
              ] as const).map(([v, t, s, enabled]) => (
                <div
                  key={v}
                  onClick={() => enabled && setVisibility(v)}
                  style={{ ...pill(visibility === v && enabled), opacity: enabled ? 1 : 0.45, cursor: enabled ? "pointer" : "not-allowed" }}
                >
                  <div style={{ fontWeight: 700, color: "var(--text-hi)" }}>{t}</div>
                  <div style={{ fontSize: "0.82rem", color: "var(--dim)" }}>{s}{!enabled ? " · nur Fleetoperator" : ""}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: "0.4rem" }}>
            <label style={labelStyle}>Optionen</label>
            <Toggle on={anonymous} set={setAnonymous} label="Anonyme Abstimmung" hint="Wähler-Identitäten im Ergebnis verbergen" />
            <Toggle on={allowAddOptions} set={setAllowAddOptions} label="Eigene Optionen erlauben" hint="Wähler dürfen Optionen vorschlagen" />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.6rem 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontWeight: 600, color: "var(--text)" }}>Ergebnis sichtbar</span>
              <select value={resultsVisibility} onChange={(e) => setResultsVisibility(e.target.value as ResultsVis)} style={{ ...inputStyle, width: "auto" }}>
                <option value="always">immer</option>
                <option value="after_vote">nach eigener Stimme</option>
                <option value="after_close">nach Schluss</option>
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.6rem 0", gap: "0.6rem", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, color: "var(--text)" }}>Automatisch schließen (optional)</span>
              <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} style={{ ...inputStyle, width: "auto" }} />
            </div>
          </div>

          {error && <p className="fpw-meta" style={{ color: "var(--red)" }}>{error}</p>}
          <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.6rem", flexWrap: "wrap" }}>
            <button
              onClick={() => void submit(false)}
              disabled={!canSubmit}
              className="fpw-btn"
              style={{ borderColor: "rgba(91, 185, 138,0.5)", background: "rgba(91, 185, 138,0.12)", color: "var(--green)", opacity: canSubmit ? 1 : 0.4 }}
            >
              {saving ? "Speichere…" : "Umfrage erstellen"}
            </button>
            <button
              onClick={() => void submit(true)}
              disabled={!canSubmit}
              className="fpw-btn"
              style={{ borderColor: "rgba(118, 130, 141,0.3)", color: "var(--dim)", opacity: canSubmit ? 1 : 0.4 }}
            >
              Als Entwurf speichern
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
