import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, addShipNeeds, createOperation, createRecurrence, setCqbTeams, setFighterSquads } from "../api/client";
import type { SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { OP_TYPES, VIS_OPTIONS as VIS, SYSTEMS, coreValid, coreOpBody } from "../components/opForm";
import { TemplatesPage } from "./TemplatesPage";

const MONO = "var(--mono)";

const RECUR = [
  { key: "", label: "Nie" },
  { key: "weekly", label: "Wöchentlich" },
  { key: "biweekly", label: "Alle 2 Wochen" },
  { key: "monthly_nth", label: "Monatlich" },
];
const SHIP_TYPES = [
  { slug: "any", label: "Any ship" },
  { slug: "capital", label: "Capital" },
  { slug: "subcapital", label: "Sub-capital" },
  { slug: "transport", label: "Transport / Cargo" },
  { slug: "support", label: "Support / Medical" },
  { slug: "mining", label: "Mining" },
  { slug: "salvage", label: "Salvage" },
  { slug: "exploration", label: "Exploration" },
];
const STEPS = ["Eckdaten", "Briefing", "Treffpunkt", "Flotte", "Prüfen", "Erstellen"];
const STEP_ICONS = ["plus", "chat", "pin", "ship", "board", "check"];

const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#0e1926", border: "1px solid rgba(0,212,255,0.14)", color: "#ccdde8", fontFamily: "var(--body)", fontSize: "0.95rem", padding: "0.55rem 0.7rem", borderRadius: 8, outline: "none" };
const lbl: React.CSSProperties = { fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.1em", color: "#9fb1c2", marginBottom: "0.4rem", display: "block" };

export function WizardPage({ session }: { session: SessionResponse | null }) {
  const nav = useNavigate();
  const operatorGuilds = (session?.memberships ?? []).filter((m) => m.role === "fleetoperator" || session?.user?.role === "superadmin");
  const csrf = session?.csrfToken ?? null;

  const [guildId, setGuildId] = useState(operatorGuilds[0]?.guildId ?? "");
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [freq, setFreq] = useState("");
  const [opType, setOpType] = useState("combat");
  const [description, setDescription] = useState("");
  const [meetingSystem, setMeetingSystem] = useState("Stanton");
  const [meetingLocation, setMeetingLocation] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [ships, setShips] = useState<string[]>([]);
  const [fighters, setFighters] = useState(0);
  const [cqb, setCqb] = useState(0);
  const [cqbSize, setCqbSize] = useState(4);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [picker, setPicker] = useState(false); // "Aus Vorlage starten" overlay

  useEffect(() => { if (!guildId && operatorGuilds[0]) setGuildId(operatorGuilds[0].guildId); }, [guildId, operatorGuilds]);

  const eckdatenDone = coreValid({ title, scheduledAt });
  const stepDone = useMemo(() => [eckdatenDone, true, true, true, true, false], [eckdatenDone]);

  if (session === null) return <div className="fpw-state"><span style={lbl}>LADE…</span></div>;
  if (operatorGuilds.length === 0)
    return (
      <div className="fpw-state" data-testid="create-denied">
        <span style={lbl}>KEINE BERECHTIGUNG</span>
        <p className="fpw-meta">Operationen erstellen können nur Fleet-Operatoren.</p>
        <Link className="fpw-btn" to="/">Zur Übersicht</Link>
      </div>
    );

  async function create() {
    if (!csrf || busy) return;
    if (!eckdatenDone) { setStep(0); setNotice("Name und Startzeit sind erforderlich."); return; }
    setBusy(true);
    setNotice(null);
    try {
      const r = await createOperation(csrf, {
        guildId,
        ...coreOpBody({ title, scheduledAt, opType, description, meetingSystem, meetingLocation, visibility }),
        scheduledAt: new Date(scheduledAt).toISOString(),
      });
      // Apply fleet needs + recurrence to the fresh op (best-effort, non-fatal).
      try {
        if (ships.length) await addShipNeeds(r.id, csrf, { shipTypes: ships });
        if (fighters > 0) await setFighterSquads(r.id, csrf, fighters);
        if (cqb > 0) await setCqbTeams(r.id, csrf, cqb, cqbSize);
        if (freq) await createRecurrence(r.id, csrf, { freq });
      } catch { /* op exists; needs/recurrence are optional add-ons */ }
      nav(`/ops/${r.id}`);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Erstellen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  const card: React.CSSProperties = { border: "1px solid rgba(0,212,255,0.16)", borderRadius: 14, background: "#090f18", padding: "1.3rem 1.4rem" };
  const cardHead: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.55rem", fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.06em", color: "#eaf4fb", marginBottom: "1.1rem" };
  const chip: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, background: "rgba(0,212,255,0.12)", border: "1px solid rgba(0,212,255,0.3)", color: "#00d4ff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
  const tag = (ok: boolean): React.CSSProperties => ({ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.05em", padding: "2px 7px", borderRadius: 4, border: `1px solid ${ok ? "#00ff88" : "#5b6b7a"}55`, background: `${ok ? "#00ff88" : "#5b6b7a"}14`, color: ok ? "#00ff88" : "#7e92a4" });

  const review: Array<[string, string]> = [
    ["Name", title || "—"],
    ["Typ", OP_TYPES.find((t) => t.key === opType)?.label ?? opType],
    ["Start", scheduledAt ? new Date(scheduledAt).toLocaleString("de-DE") : "—"],
    ["Wiederholung", RECUR.find((r) => r.key === freq)?.label ?? "Nie"],
    ["Treffpunkt", `${meetingSystem}${meetingLocation ? " · " + meetingLocation : ""}`],
    ["Sichtbarkeit", VIS.find((v) => v.key === visibility)?.label ?? visibility],
    ["Bedarfe", `${ships.length} Schiff(e) · ${fighters} Jäger · ${cqb} CQB`],
  ];

  return (
    <div data-testid="create-page" style={{ width: "100%" }}>
      <div style={{ marginBottom: "1.2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.4rem" }}>
          <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="plus" size={17} sw={1.7} /></span>
          <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.14em", color: "#5b6b7a" }}>OPERATION // ERSTELLUNGS-ASSISTENT</span>
          <button type="button" data-testid="templates-link" onClick={() => setPicker(true)} style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.66rem", color: "#00d4ff", background: "transparent", border: "1px solid rgba(0,212,255,0.3)", borderRadius: 7, padding: "0.3rem 0.7rem", cursor: "pointer" }}>Aus Vorlage starten</button>
        </div>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", lineHeight: 1.12, color: "#eaf4fb", margin: 0 }}>Neue Operation</h1>
      </div>
      {notice && <p className="fpw-tag gold" role="alert" data-testid="create-notice" style={{ display: "inline-flex", marginBottom: "1rem" }}>{notice}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,200px) minmax(0,1fr) minmax(0,240px)", gap: "1.2rem", alignItems: "start" }} className="fpw-wizard-grid">
        {/* step rail */}
        <aside style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          {STEPS.map((s, i) => {
            const active = i === step;
            return (
              <button key={s} type="button" data-testid={`wiz-step-${i}`} onClick={() => setStep(i)} style={{ display: "flex", alignItems: "center", gap: "0.55rem", padding: "0.55rem 0.65rem", borderRadius: 9, cursor: "pointer", textAlign: "left", border: active ? "1px solid rgba(0,212,255,0.4)" : "1px solid transparent", background: active ? "rgba(0,212,255,0.1)" : "transparent", color: active ? "#00d4ff" : "#9fb1c2", fontFamily: MONO, fontSize: "0.74rem" }}>
                <span style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.68rem", background: active ? "#00d4ff" : "rgba(255,255,255,0.06)", color: active ? "#04060a" : "#9fb1c2" }}>{i + 1}</span>
                <span style={{ flex: 1 }}>{s}</span>
                {stepDone[i] && i !== step && <span style={{ color: "#00ff88", display: "inline-flex" }}><Ic name="check" size={14} sw={2.2} /></span>}
              </button>
            );
          })}
        </aside>

        {/* step body */}
        <div style={{ minWidth: 0 }}>
          <section style={card}>
            <div style={cardHead}><span style={chip}><Ic name={STEP_ICONS[step]} size={15} sw={1.6} /></span>SCHRITT {step + 1} / 6 · {STEPS[step]}</div>

            {step === 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                {operatorGuilds.length > 1 && (
                  <div><label style={lbl}>GUILD</label><select data-testid="wiz-guild" value={guildId} onChange={(e) => setGuildId(e.target.value)} style={inp}>{operatorGuilds.map((g) => <option key={g.guildId} value={g.guildId}>{g.guildName}</option>)}</select></div>
                )}
                <div><label style={lbl}>Event-Name <span style={{ color: "#f0a500" }}>*</span></label><input data-testid="wiz-title" type="text" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Operation Darkstar" style={inp} /></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.9rem" }}>
                  <div><label style={lbl}>Startzeit <span style={{ color: "#f0a500" }}>*</span></label><input data-testid="wiz-when" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} style={inp} /></div>
                  <div><label style={lbl}>Wiederholung</label><select data-testid="wiz-recur" value={freq} onChange={(e) => setFreq(e.target.value)} style={inp}>{RECUR.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></div>
                </div>
                <div>
                  <label style={lbl}>Missionstyp</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    {OP_TYPES.map((t) => {
                      const on = opType === t.key;
                      return <button key={t.key} type="button" data-testid={`wiz-type-${t.key}`} onClick={() => setOpType(t.key)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.34rem 0.6rem", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: "0.7rem", border: on ? `1px solid rgb(${t.rgb})` : "1px solid rgba(255,255,255,0.12)", background: on ? `rgba(${t.rgb},0.13)` : "transparent", color: on ? `rgb(${t.rgb})` : "#9fb1c2" }}><Ic name={t.icon} size={14} sw={1.7} />{t.label}</button>;
                    })}
                  </div>
                </div>
              </div>
            )}

            {step === 1 && (
              <div>
                <label style={lbl}>Briefing (Markdown)</label>
                <textarea data-testid="wiz-briefing" value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} placeholder={"## Missionsziel\n…\n\n## Einsatzregeln\n…"} style={{ ...inp, minHeight: 200, resize: "vertical", fontFamily: MONO, fontSize: "0.85rem" }} />
              </div>
            )}

            {step === 2 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.9rem" }}>
                  <div><label style={lbl}>System</label><select data-testid="wiz-system" value={meetingSystem} onChange={(e) => setMeetingSystem(e.target.value)} style={inp}>{SYSTEMS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
                  <div><label style={lbl}>Treffpunkt</label><input data-testid="wiz-location" type="text" maxLength={160} value={meetingLocation} onChange={(e) => setMeetingLocation(e.target.value)} placeholder="z. B. HUR-L1" style={inp} /></div>
                </div>
                <div>
                  <label style={lbl}>Sichtbarkeit</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    {VIS.map((v) => {
                      const on = visibility === v.key;
                      return <button key={v.key} type="button" data-testid={`wiz-vis-${v.key}`} onClick={() => setVisibility(v.key)} style={{ padding: "0.34rem 0.7rem", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: "0.7rem", border: on ? "1px solid rgba(0,212,255,0.5)" : "1px solid rgba(255,255,255,0.12)", background: on ? "rgba(0,212,255,0.14)" : "transparent", color: on ? "#00d4ff" : "#9fb1c2" }}>{v.label}</button>;
                    })}
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <p style={{ fontSize: "0.82rem", color: "#9fb1c2", margin: 0, lineHeight: 1.5 }}>Lege fest, welche Einheiten gebraucht werden. Teilnehmer beanspruchen später Sitze.</p>
                <div>
                  <label style={lbl}>Schiffsbedarfe</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    {SHIP_TYPES.map((s) => {
                      const on = ships.includes(s.slug);
                      return <button key={s.slug} type="button" data-testid={`wiz-ship-${s.slug}`} onClick={() => setShips((p) => on ? p.filter((x) => x !== s.slug) : [...p, s.slug])} style={{ padding: "0.32rem 0.6rem", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: "0.68rem", border: on ? "1px solid rgba(0,212,255,0.55)" : "1px solid rgba(0,212,255,0.2)", background: on ? "rgba(0,212,255,0.14)" : "rgba(0,212,255,0.04)", color: on ? "#00d4ff" : "#9fb1c2" }}>{s.label}</button>;
                    })}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap" }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "#9fb1c2", fontSize: "0.82rem" }}>Jäger-Staffeln<input data-testid="wiz-fighters" type="number" min={0} max={50} value={fighters} onChange={(e) => setFighters(Number(e.target.value))} style={{ ...inp, width: 80 }} /></label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "#9fb1c2", fontSize: "0.82rem" }}>CQB-Teams<input data-testid="wiz-cqb" type="number" min={0} max={50} value={cqb} onChange={(e) => setCqb(Number(e.target.value))} style={{ ...inp, width: 80 }} /></label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "#9fb1c2", fontSize: "0.82rem" }}>Team-Größe<input data-testid="wiz-cqbsize" type="number" min={1} max={8} value={cqbSize} onChange={(e) => setCqbSize(Number(e.target.value))} style={{ ...inp, width: 80 }} /></label>
                </div>
              </div>
            )}

            {step === 4 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {review.map(([k, v]) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", padding: "0.5rem 0.7rem", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <span style={{ fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.04em", color: "#7e92a4" }}>{k}</span>
                    <span style={{ fontSize: "0.88rem", color: "#eaf4fb", textAlign: "right" }}>{v}</span>
                  </div>
                ))}
              </div>
            )}

            {step === 5 && (
              <div style={{ textAlign: "center", padding: "1rem 0.5rem" }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(0,255,136,0.1)", border: "1px solid rgba(0,255,136,0.3)", color: "#00ff88", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "0.9rem" }}><Ic name="check" size={24} sw={1.7} /></div>
                <div style={{ fontWeight: 700, fontSize: "1.2rem", color: "#eaf4fb", marginBottom: "0.4rem" }}>Bereit zum Erstellen</div>
                <p style={{ fontSize: "0.84rem", color: "#9fb1c2", maxWidth: "42ch", margin: "0 auto 1rem", lineHeight: 1.5 }}>Die Operation wird als Entwurf angelegt. Bedarfe und Wiederholung werden direkt übernommen.</p>
                <button type="button" data-testid="wiz-create" disabled={busy || !csrf} onClick={create} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0.6rem 1.4rem", border: "1px solid rgba(0,255,136,0.5)", background: "rgba(0,255,136,0.14)", color: "#00ff88", fontFamily: MONO, fontSize: "0.78rem", borderRadius: 10, cursor: "pointer" }}><Ic name="plus" size={15} sw={1.8} /> Operation erstellen</button>
              </div>
            )}
          </section>

          {/* nav */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "1rem" }}>
            <button type="button" data-testid="wiz-back" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0.55rem 1rem", border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: step === 0 ? "#5b6b7a" : "#9fb1c2", fontFamily: MONO, fontSize: "0.74rem", borderRadius: 9, cursor: step === 0 ? "default" : "pointer" }}><Ic name="back" size={14} sw={1.8} /> Zurück</button>
            <span style={{ flex: 1 }} />
            {step < 5 && <button type="button" data-testid="wiz-next" onClick={() => setStep((s) => Math.min(5, s + 1))} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0.55rem 1.2rem", border: "1px solid rgba(0,212,255,0.5)", background: "rgba(0,212,255,0.14)", color: "#00d4ff", fontFamily: MONO, fontSize: "0.74rem", borderRadius: 9, cursor: "pointer" }}>Weiter<Ic name="arrow" size={14} sw={1.8} /></button>}
          </div>
        </div>

        {/* summary */}
        <aside style={{ border: "1px solid rgba(0,212,255,0.13)", borderRadius: 14, background: "#090f18", padding: "1.1rem 1.2rem", position: "sticky", top: 80 }}>
          <div style={{ fontFamily: MONO, fontSize: "0.64rem", letterSpacing: "0.1em", color: "#5b6b7a", marginBottom: "0.8rem" }}>ZUSAMMENFASSUNG</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
            {[
              { label: "Eckdaten", ok: eckdatenDone },
              { label: "Briefing", ok: description.trim().length > 0 },
              { label: "Treffpunkt", ok: meetingLocation.trim().length > 0 },
              { label: "Flotte", ok: ships.length > 0 || fighters > 0 || cqb > 0 },
            ].map((r) => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.82rem", color: "#c2d2de" }}>{r.label}</span>
                <span style={tag(r.ok)}>{r.ok ? "OK" : "offen"}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
      <style>{`@media (max-width: 900px){.fpw-wizard-grid{display:flex !important;flex-direction:column}}`}</style>

      {/* IA merge F: "Aus Vorlage starten" — the marketplace as a picker overlay
          inside the op-editor (applying navigates to the created op). */}
      {picker && (
        <div role="dialog" data-testid="template-picker" style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(2,5,10,0.72)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "3vh 1rem" }} onClick={() => setPicker(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 1080, background: "var(--bg)", border: "1px solid var(--border-hi)", borderRadius: 14, padding: "1.4rem 1.5rem", boxShadow: "0 24px 70px rgba(0,0,0,0.6)" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: "0.6rem" }}>
              <span style={{ flex: 1, fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.14em", color: "#5b6b7a" }}>AUS VORLAGE STARTEN</span>
              <button type="button" data-testid="template-picker-close" onClick={() => setPicker(false)} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#9fb1c2", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Ic name="x" size={14} sw={2} /></button>
            </div>
            <TemplatesPage session={session} />
          </div>
        </div>
      )}
    </div>
  );
}
