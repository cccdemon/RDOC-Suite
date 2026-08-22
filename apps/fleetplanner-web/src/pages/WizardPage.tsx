import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { announceOperation, ApiError, addResourceLink, addShipNeeds, createOperation, createRecurrence, getGuildChannels, getPartnerships, setCqbTeams, setFighterSquads } from "../api/client";
import type { SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { CoverPanel } from "../components/CoverPanel";
import { DocumentsPanel } from "../components/DocumentsPanel";
import { OP_TYPES, VIS_OPTIONS as VIS, SYSTEMS, coreValid, coreOpBody } from "../components/opForm";
import { useT } from "../i18n";
import { TemplatesPage } from "./TemplatesPage";
import { ChoiceTile, tint } from "../components/ui";
import { Breadcrumbs } from "../components/Breadcrumbs";

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
// Steps are named after what the operator is doing, not after the form section
// (UI audit §10). Step 2 also carries visibility + partner distribution, step 5
// creates AND offers the share/cover follow-ups.
const STEPS = ["Eckdaten", "Briefing", "Treffpunkt & Freigabe", "Bedarf", "Prüfen", "Erstellen & Teilen"];
const STEP_ICONS = ["plus", "chat", "pin", "ship", "board", "check"];
// Which step owns which summary/review row — every row jumps back to its step.
const ROW_STEP: Record<string, number> = {
  Name: 0, Typ: 0, Start: 0, Wiederholung: 0, "Stream-Event": 0,
  Briefing: 1,
  Treffpunkt: 2, Sichtbarkeit: 2, "Partner-Discords": 2,
  Bedarfe: 3, Flotte: 3,
};

// §10 "Entwurf bleibt erhalten": the unsent form lives in localStorage until the
// op is created. Partner targets are deliberately NOT stored — they are re-derived
// per guild and must never leak across a guild switch.
const DRAFT_KEY = "fpw.wizard.draft.v1";
type WizardDraft = {
  guildId: string; title: string; scheduledAt: string; freq: string; opType: string;
  description: string; meetingSystem: string; meetingLocation: string; visibility: string;
  isStreamEvent: boolean; ships: string[]; fighters: number; cqb: number; cqbSize: number;
};
function readDraft(): WizardDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<WizardDraft>;
    const has = !!(d.title?.trim() || d.description?.trim() || d.meetingLocation?.trim() || d.scheduledAt || (d.ships?.length ?? 0) || d.fighters || d.cqb);
    if (!has) return null;
    return {
      guildId: d.guildId ?? "", title: d.title ?? "", scheduledAt: d.scheduledAt ?? "", freq: d.freq ?? "",
      opType: d.opType ?? "combat", description: d.description ?? "", meetingSystem: d.meetingSystem ?? "Stanton",
      meetingLocation: d.meetingLocation ?? "", visibility: d.visibility ?? "private", isStreamEvent: !!d.isStreamEvent,
      ships: Array.isArray(d.ships) ? d.ships : [], fighters: Number(d.fighters) || 0, cqb: Number(d.cqb) || 0,
      cqbSize: Number(d.cqbSize) || 4,
    };
  } catch { return null; }
}
function clearDraft() { try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ } }

const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.95rem", padding: "0.55rem 0.7rem", borderRadius: 8, outline: "none" };
const lbl: React.CSSProperties = { fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.1em", color: "var(--dim)", marginBottom: "0.4rem", display: "block" };

export function WizardPage({ session }: { session: SessionResponse | null }) {
  const nav = useNavigate();
  const t = useT();
  const operatorGuilds = (session?.memberships ?? []).filter((m) => m.role === "fleetoperator");
  const csrf = session?.csrfToken ?? null;

  // Read the stored draft exactly once, before the first render seeds the fields.
  const draft = useMemo(readDraft, []);
  const [restored, setRestored] = useState(!!draft);

  const [guildId, setGuildId] = useState(
    draft?.guildId && operatorGuilds.some((g) => g.guildId === draft.guildId) ? draft.guildId : operatorGuilds[0]?.guildId ?? "",
  );
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState(draft?.title ?? "");
  const [scheduledAt, setScheduledAt] = useState(draft?.scheduledAt ?? "");
  const [freq, setFreq] = useState(draft?.freq ?? "");
  const [opType, setOpType] = useState(draft?.opType ?? "combat");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [meetingSystem, setMeetingSystem] = useState(draft?.meetingSystem ?? "Stanton");
  const [meetingLocation, setMeetingLocation] = useState(draft?.meetingLocation ?? "");
  const [visibility, setVisibility] = useState(draft?.visibility ?? "private");
  const [isStreamEvent, setIsStreamEvent] = useState(!!draft?.isStreamEvent);
  // FR-P1: active partners of the selected guild + the host-picked subset to
  // distribute to. Default empty → nothing auto-posts to partner Discords.
  const [partners, setPartners] = useState<Array<{ guildId: string; name: string }>>([]);
  const [partnerTargets, setPartnerTargets] = useState<string[]>([]);
  const [ships, setShips] = useState<string[]>(draft?.ships ?? []);
  const [fighters, setFighters] = useState(draft?.fighters ?? 0);
  const [cqb, setCqb] = useState(draft?.cqb ?? 0);
  const [cqbSize, setCqbSize] = useState(draft?.cqbSize ?? 4);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [picker, setPicker] = useState(false); // "Aus Vorlage starten" overlay
  const [createdId, setCreatedId] = useState<string | null>(null); // FR-C1: hold after create for the cover step
  // §10: after creating, opening the op and post-processing it are two named ways,
  // not one long page — the follow-up panels only appear once they are chosen.
  const [postMode, setPostMode] = useState<"decide" | "edit">("decide");
  // Per-field validation of the current step; cleared whenever the field changes.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const whenRef = useRef<HTMLInputElement>(null);
  // §10: the template picker is a modal dialog, so it needs Escape, a focus trap
  // and the focus handed back to the button that opened it.
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerOpenerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (!guildId && operatorGuilds[0]) setGuildId(operatorGuilds[0].guildId); }, [guildId, operatorGuilds]);

  // Load the guild's ACTIVE partners for the distribution picker; reset the
  // selection whenever the guild changes so targets never leak across guilds.
  useEffect(() => {
    setPartnerTargets([]);
    if (!guildId) { setPartners([]); return; }
    let live = true;
    getPartnerships(guildId)
      .then((r) => {
        if (!live) return;
        setPartners(
          r.partnerships
            .filter((p) => p.status === "active" && p.partnerGuildId)
            .map((p) => ({ guildId: p.partnerGuildId as string, name: p.partnerGuildName ?? p.partnerGuildId as string })),
        );
      })
      .catch(() => { if (live) setPartners([]); });
    return () => { live = false; };
  }, [guildId]);

  const sharesToPartners = visibility === "partners" || visibility === "public";

  const eckdatenDone = coreValid({ title, scheduledAt });
  const stepDone = useMemo(() => [eckdatenDone, true, true, true, true, false], [eckdatenDone]);

  // §10: "Weiter" validates the current step. Only step 0 carries required fields;
  // the rest are optional by design, and that stays explicit here rather than
  // implicit in the absence of a check.
  type FieldIssue = { field: "title" | "when"; msg: string };
  function stepIssues(i: number): FieldIssue[] {
    if (i !== 0) return [];
    const out: FieldIssue[] = [];
    if (!title.trim()) out.push({ field: "title", msg: "Event-Name ist ein Pflichtfeld." });
    if (!scheduledAt) out.push({ field: "when", msg: "Startzeit ist ein Pflichtfeld." });
    return out;
  }
  // A step is reachable when every step before it validates — a jump can never
  // skip an incomplete required step unnoticed.
  function reachable(i: number): boolean {
    for (let k = 0; k < i; k++) if (stepIssues(k).length > 0) return false;
    return true;
  }
  function goStep(i: number) {
    if (!reachable(i)) {
      setNotice("Zuerst die Eckdaten ausfüllen — Name und Startzeit fehlen.");
      setErrors(Object.fromEntries(stepIssues(0).map((x) => [x.field, x.msg])));
      setStep(0);
      titleRef.current?.focus();
      return;
    }
    setErrors({});
    setStep(i);
  }
  function goNext() {
    const issues = stepIssues(step);
    if (issues.length > 0) {
      setErrors(Object.fromEntries(issues.map((x) => [x.field, x.msg])));
      setNotice(issues.map((x) => x.msg).join(" "));
      (issues[0].field === "title" ? titleRef : whenRef).current?.focus();
      return;
    }
    setErrors({});
    setNotice(null);
    setStep((v) => Math.min(5, v + 1));
  }

  useEffect(() => {
    if (!picker) return;
    const box = pickerRef.current;
    // No offsetParent check: jsdom has no layout, so it would report every element
    // as hidden and the trap would have nothing to hold on to.
    const focusable = () =>
      Array.from(box?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])
        .filter((el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true");
    focusable()[0]?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); setPicker(false); return; }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !box?.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      pickerOpenerRef.current?.focus();
    };
  }, [picker]);

  // Anything typed but not yet created is worth protecting.
  const dirty =
    !createdId &&
    (title.trim() !== "" || scheduledAt !== "" || description.trim() !== "" || meetingLocation.trim() !== "" ||
      ships.length > 0 || fighters > 0 || cqb > 0 || freq !== "" || isStreamEvent);

  // Keep the draft in localStorage while the form is dirty; drop it as soon as the
  // form is empty again or the op exists.
  useEffect(() => {
    if (createdId) { clearDraft(); return; }
    if (!dirty) { clearDraft(); return; }
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
        guildId, title, scheduledAt, freq, opType, description, meetingSystem, meetingLocation,
        visibility, isStreamEvent, ships, fighters, cqb, cqbSize,
      } satisfies WizardDraft));
    } catch { /* private mode: the unload guard still warns */ }
  }, [dirty, createdId, guildId, title, scheduledAt, freq, opType, description, meetingSystem, meetingLocation, visibility, isStreamEvent, ships, fighters, cqb, cqbSize]);

  // Second line of defence for a hard reload / tab close.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  function discardDraft() {
    clearDraft();
    setRestored(false);
    setTitle(""); setScheduledAt(""); setFreq(""); setOpType("combat"); setDescription("");
    setMeetingSystem("Stanton"); setMeetingLocation(""); setVisibility("private"); setIsStreamEvent(false);
    setShips([]); setFighters(0); setCqb(0); setCqbSize(4);
    setErrors({}); setNotice(null); setStep(0);
  }

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
    const issues = stepIssues(0);
    if (issues.length > 0) {
      setStep(0);
      setErrors(Object.fromEntries(issues.map((x) => [x.field, x.msg])));
      setNotice(issues.map((x) => x.msg).join(" "));
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const r = await createOperation(csrf, {
        guildId,
        ...coreOpBody({ title, scheduledAt, opType, description, meetingSystem, meetingLocation, visibility, isStreamEvent }),
        scheduledAt: new Date(scheduledAt).toISOString(),
        // Only send targets that are still valid partners for this visibility.
        partnerTargetGuildIds: sharesToPartners ? partnerTargets.filter((id) => partners.some((p) => p.guildId === id)) : [],
      });
      // Apply fleet needs + recurrence to the fresh op (best-effort, non-fatal).
      try {
        if (ships.length) await addShipNeeds(r.id, csrf, { shipTypes: ships });
        if (fighters > 0) await setFighterSquads(r.id, csrf, fighters);
        if (cqb > 0) await setCqbTeams(r.id, csrf, cqb, cqbSize);
        if (freq) await createRecurrence(r.id, csrf, { freq });
      } catch { /* op exists; needs/recurrence are optional add-ons */ }
      // FR-C1: stay on the wizard's final step so the operator can optionally add a
      // mission cover (the cover editor needs the new op id). "Zur Operation" leaves.
      setCreatedId(r.id);
      setPostMode("decide");
      clearDraft();
      setRestored(false);
      setNotice(t("cover.created"));
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Erstellen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  const card: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg2)", padding: "1.3rem 1.4rem" };
  const cardHead: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.55rem", fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.06em", color: "var(--text-hi)", marginBottom: "1.1rem" };
  const chip: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, background: "var(--wash)", border: "1px solid var(--border-hi)", color: "var(--cyan)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
  const tag = (ok: boolean): React.CSSProperties => ({ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.05em", padding: "2px 7px", borderRadius: 4, border: `1px solid ${ok ? "var(--green)" : "var(--dim3)"}55`, background: `${ok ? "var(--green)" : "var(--dim3)"}14`, color: ok ? "var(--green)" : "var(--dim2)" });

  const review: Array<[string, string]> = [
    ["Name", title || "—"],
    ["Typ", OP_TYPES.find((t) => t.key === opType)?.label ?? opType],
    ["Start", scheduledAt ? new Date(scheduledAt).toLocaleString("de-DE") : "—"],
    ["Briefing", description.trim() ? `${description.trim().length} Zeichen` : "—"],
    ["Wiederholung", RECUR.find((r) => r.key === freq)?.label ?? "Nie"],
    ["Treffpunkt", `${meetingSystem}${meetingLocation ? " · " + meetingLocation : ""}`],
    ["Sichtbarkeit", VIS.find((v) => v.key === visibility)?.label ?? visibility],
    ...(sharesToPartners
      ? [["Partner-Discords", partnerTargets.length === 0 ? "keine" : partners.filter((p) => partnerTargets.includes(p.guildId)).map((p) => p.name).join(", ")] as [string, string]]
      : []),
    ["Stream-Event", isStreamEvent ? "Ja" : "Nein"],
    ["Bedarfe", `${ships.length} Schiff(e) · ${fighters} Jäger · ${cqb} CQB`],
  ];

  return (
    <div data-testid="create-page" style={{ width: "100%" }}>
      <Breadcrumbs items={[{ label: "Operationen", to: "/operationen" }, { label: "Neue Operation" }]} />
      <div style={{ marginBottom: "1.2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.4rem" }}>
          <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="plus" size={17} sw={1.7} /></span>
          <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.14em", color: "var(--dim3)" }}>OPERATION // ERSTELLUNGS-ASSISTENT</span>
          <button type="button" ref={pickerOpenerRef} data-testid="templates-link" aria-haspopup="dialog" aria-expanded={picker} onClick={() => setPicker(true)} style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.66rem", color: "var(--cyan)", background: "transparent", border: "1px solid var(--border-hi)", borderRadius: 7, padding: "0.3rem 0.7rem", cursor: "pointer" }}>Aus Vorlage starten</button>
        </div>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", lineHeight: 1.12, color: "var(--text-hi)", margin: 0 }}>Neue Operation</h1>
      </div>
      {notice && <p className="fpw-tag gold" role="alert" data-testid="create-notice" style={{ display: "inline-flex", marginBottom: "1rem" }}>{notice}</p>}
      {restored && !createdId && (
        <div data-testid="wiz-draft-restored" role="status" style={{ display: "flex", alignItems: "center", gap: "0.7rem", flexWrap: "wrap", border: "1px solid var(--border-hi)", background: "var(--wash)", borderRadius: 10, padding: "0.6rem 0.85rem", marginBottom: "1rem" }}>
          <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="save" size={15} sw={1.7} /></span>
          <span style={{ flex: 1, minWidth: 0, fontSize: "0.85rem", color: "var(--text)" }}>Nicht abgeschickter Entwurf wiederhergestellt.</span>
          <button type="button" data-testid="wiz-draft-discard" onClick={discardDraft} style={{ padding: "0.35rem 0.75rem", border: "1px solid var(--edge-red)", background: "var(--tint-red)", color: "var(--red)", fontFamily: MONO, fontSize: "0.68rem", borderRadius: 7, cursor: "pointer" }}>Verwerfen</button>
          <button type="button" data-testid="wiz-draft-keep" onClick={() => setRestored(false)} style={{ padding: "0.35rem 0.75rem", border: "1px solid var(--border-hi)", background: "transparent", color: "var(--dim)", fontFamily: MONO, fontSize: "0.68rem", borderRadius: 7, cursor: "pointer" }}>Weiterarbeiten</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,200px) minmax(0,1fr) minmax(0,240px)", gap: "1.2rem", alignItems: "start" }} className="fpw-wizard-grid">
        {/* step rail */}
        <aside style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          {STEPS.map((s, i) => {
            const active = i === step;
            const open = reachable(i);
            return (
              <button
                key={s}
                type="button"
                data-testid={`wiz-step-${i}`}
                aria-current={active ? "step" : undefined}
                aria-disabled={open ? undefined : true}
                title={open ? undefined : "Zuerst die Eckdaten ausfüllen"}
                onClick={() => goStep(i)}
                style={{ display: "flex", alignItems: "center", gap: "0.55rem", padding: "0.55rem 0.65rem", borderRadius: 9, cursor: open ? "pointer" : "not-allowed", textAlign: "left", border: active ? "1px solid var(--border-hi)" : "1px solid transparent", background: active ? "var(--wash)" : "transparent", color: active ? "var(--cyan)" : open ? "var(--dim)" : "var(--dim3)", fontFamily: MONO, fontSize: "0.74rem" }}
              >
                <span style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.68rem", background: active ? "var(--cyan)" : "var(--wash)", color: active ? "var(--bg)" : "var(--dim)" }}>{i + 1}</span>
                <span style={{ flex: 1 }}>{s}</span>
                {stepDone[i] && i !== step && <span style={{ color: "var(--green)", display: "inline-flex" }}><Ic name="check" size={14} sw={2.2} /></span>}
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
                <div>
                  <label style={lbl} htmlFor="wiz-title-input">Event-Name <span style={{ color: "var(--gold)" }}>*</span></label>
                  <input id="wiz-title-input" ref={titleRef} data-testid="wiz-title" type="text" maxLength={160} value={title} aria-invalid={!!errors.title} aria-describedby={errors.title ? "wiz-title-err" : undefined} onChange={(e) => { setTitle(e.target.value); setErrors((p) => ({ ...p, title: "" })); }} placeholder="Operation Darkstar" style={{ ...inp, borderColor: errors.title ? "var(--edge-red)" : "var(--border)" }} />
                  {errors.title && <span id="wiz-title-err" data-testid="wiz-err-title" style={{ display: "block", marginTop: "0.3rem", color: "var(--red)", fontFamily: MONO, fontSize: "0.66rem" }}>{errors.title}</span>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.9rem" }}>
                  <div>
                    <label style={lbl} htmlFor="wiz-when-input">Startzeit <span style={{ color: "var(--gold)" }}>*</span></label>
                    <input id="wiz-when-input" ref={whenRef} data-testid="wiz-when" type="datetime-local" value={scheduledAt} aria-invalid={!!errors.when} aria-describedby={errors.when ? "wiz-when-err" : undefined} onChange={(e) => { setScheduledAt(e.target.value); setErrors((p) => ({ ...p, when: "" })); }} style={{ ...inp, borderColor: errors.when ? "var(--edge-red)" : "var(--border)" }} />
                    {errors.when && <span id="wiz-when-err" data-testid="wiz-err-when" style={{ display: "block", marginTop: "0.3rem", color: "var(--red)", fontFamily: MONO, fontSize: "0.66rem" }}>{errors.when}</span>}
                  </div>
                  <div><label style={lbl}>Wiederholung</label><select data-testid="wiz-recur" value={freq} onChange={(e) => setFreq(e.target.value)} style={inp}>{RECUR.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></div>
                </div>
                <div>
                  <label style={lbl}>Missionstyp</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    {OP_TYPES.map((t) => {
                      const on = opType === t.key;
                      return (
                        <ChoiceTile key={t.key} testid={`wiz-type-${t.key}`} selected={on} onSelect={() => setOpType(t.key)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.34rem 0.6rem", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: "0.7rem", border: on ? `1px solid ${t.color}` : "1px solid var(--wash)", background: on ? tint(t.color, 13) : "transparent", color: on ? t.color : "var(--dim)" }}>
                          <Ic name={t.icon} size={14} sw={1.7} />{t.label}
                        </ChoiceTile>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label style={lbl}>Stream-Event</label>
                  <button
                    type="button"
                    data-testid="wiz-stream"
                    aria-pressed={isStreamEvent}
                    onClick={() => setIsStreamEvent((v) => !v)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0.4rem 0.7rem", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: "0.7rem", border: isStreamEvent ? "1px solid rgba(145,70,255,0.55)" : "1px solid var(--wash)", background: isStreamEvent ? "rgba(145,70,255,0.15)" : "transparent", color: isStreamEvent ? "var(--purple)" : "var(--dim)" }}
                  >
                    <Ic name="stream" size={14} sw={1.7} />{isStreamEvent ? "Als Stream-Event markiert" : "Kein Stream-Event"}
                  </button>
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
                      return (
                        <ChoiceTile key={v.key} testid={`wiz-vis-${v.key}`} selected={on} onSelect={() => setVisibility(v.key)} title={v.desc} style={{ padding: "0.34rem 0.7rem", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: "0.7rem", border: on ? "1px solid var(--border-hi)" : "1px solid var(--wash)", background: on ? "var(--wash)" : "transparent", color: on ? "var(--cyan)" : "var(--dim)" }}>
                          {v.label}
                        </ChoiceTile>
                      );
                    })}
                  </div>
                </div>
                {/* FR-P1: pick WHICH partner Discords receive this op. Nothing is
                    preselected — the event is only cross-posted to partners the
                    operator explicitly ticks here. */}
                {sharesToPartners && (
                  <div data-testid="wiz-partner-targets">
                    <label style={lbl}>PARTNER-DISCORDS (Event-Verteilung)</label>
                    {partners.length === 0 ? (
                      <p style={{ fontSize: "0.8rem", color: "var(--dim2)", margin: 0, lineHeight: 1.5 }}>Keine aktiven Partnerschaften. Ohne Auswahl wird das Event auf keinen Partner-Discord verteilt.</p>
                    ) : (
                      <>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.5rem" }}>
                          {partners.map((p) => {
                            const on = partnerTargets.includes(p.guildId);
                            return (
                              <button
                                key={p.guildId}
                                type="button"
                                data-testid={`wiz-partner-${p.guildId}`}
                                aria-pressed={on}
                                onClick={() => setPartnerTargets((prev) => on ? prev.filter((x) => x !== p.guildId) : [...prev, p.guildId])}
                                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.34rem 0.65rem", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: "0.7rem", border: on ? "1px solid var(--edge-green)" : "1px solid var(--wash)", background: on ? "var(--tint-green)" : "transparent", color: on ? "var(--green)" : "var(--dim)" }}
                              >
                                <Ic name={on ? "check" : "link"} size={13} sw={1.8} />{p.name}
                              </button>
                            );
                          })}
                        </div>
                        <p style={{ fontSize: "0.76rem", color: "var(--dim2)", margin: 0, lineHeight: 1.5 }}>
                          {partnerTargets.length === 0 ? "Keine ausgewählt — das Event wird auf keinem Partner-Discord erstellt." : `${partnerTargets.length} Partner erhalten das Event.`}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {step === 3 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <p style={{ fontSize: "0.82rem", color: "var(--dim)", margin: 0, lineHeight: 1.5 }}>Lege fest, welche Einheiten gebraucht werden. Teilnehmer beanspruchen später Sitze.</p>
                <div>
                  <label style={lbl}>Schiffsbedarfe</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    {SHIP_TYPES.map((s) => {
                      const on = ships.includes(s.slug);
                      return (
                        <ChoiceTile key={s.slug} testid={`wiz-ship-${s.slug}`} selected={on} onSelect={() => setShips((p) => on ? p.filter((x) => x !== s.slug) : [...p, s.slug])} style={{ padding: "0.32rem 0.6rem", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: "0.68rem", border: on ? "1px solid var(--border-hi)" : "1px solid var(--border)", background: "var(--wash)", color: on ? "var(--cyan)" : "var(--dim)" }}>
                          {s.label}
                        </ChoiceTile>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap" }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "var(--dim)", fontSize: "0.82rem" }}>Jäger-Staffeln<input data-testid="wiz-fighters" type="number" min={0} max={50} value={fighters} onChange={(e) => setFighters(Number(e.target.value))} style={{ ...inp, width: 80 }} /></label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "var(--dim)", fontSize: "0.82rem" }}>CQB-Teams<input data-testid="wiz-cqb" type="number" min={0} max={50} value={cqb} onChange={(e) => setCqb(Number(e.target.value))} style={{ ...inp, width: 80 }} /></label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "var(--dim)", fontSize: "0.82rem" }}>Team-Größe<input data-testid="wiz-cqbsize" type="number" min={1} max={20} value={cqbSize} onChange={(e) => setCqbSize(Number(e.target.value))} style={{ ...inp, width: 80 }} /></label>
                </div>
              </div>
            )}

            {step === 4 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {/* §10: every review row is a way back to the step that owns it. */}
                {review.map(([k, v], i) => (
                  <button
                    key={k}
                    type="button"
                    data-testid={`wiz-review-${i}`}
                    data-step={ROW_STEP[k] ?? 0}
                    onClick={() => goStep(ROW_STEP[k] ?? 0)}
                    title={`Zu Schritt ${(ROW_STEP[k] ?? 0) + 1} · ${STEPS[ROW_STEP[k] ?? 0]}`}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", width: "100%", padding: "0.5rem 0.7rem", border: "none", borderBottom: "1px solid var(--wash)", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
                  >
                    <span style={{ fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.04em", color: "var(--dim2)" }}>{k}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.88rem", color: "var(--text-hi)", textAlign: "right" }}>{v}<Ic name="edit" size={13} sw={1.7} /></span>
                  </button>
                ))}
              </div>
            )}

            {step === 5 && !createdId && (
              <div style={{ textAlign: "center", padding: "1rem 0.5rem" }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--tint-green)", border: "1px solid var(--edge-green)", color: "var(--green)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "0.9rem" }}><Ic name="check" size={24} sw={1.7} /></div>
                <div style={{ fontWeight: 700, fontSize: "1.2rem", color: "var(--text-hi)", marginBottom: "0.4rem" }}>Bereit zum Erstellen</div>
                <p style={{ fontSize: "0.84rem", color: "var(--dim)", maxWidth: "42ch", margin: "0 auto 1rem", lineHeight: 1.5 }}>Die Operation wird als Entwurf angelegt. Bedarfe und Wiederholung werden direkt übernommen.</p>
                <button type="button" data-testid="wiz-create" disabled={busy || !csrf} onClick={create} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0.6rem 1.4rem", border: "1px solid var(--edge-green)", background: "var(--tint-green)", color: "var(--green)", fontFamily: MONO, fontSize: "0.78rem", borderRadius: 10, cursor: "pointer" }}><Ic name="plus" size={15} sw={1.8} /> Operation erstellen</button>
              </div>
            )}

            {/* FR-C1: after create, offer the mission-cover step in-place, then leave. */}
            {step === 5 && createdId && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
                  <span style={{ color: "var(--green)", display: "inline-flex" }}><Ic name="check" size={18} sw={1.8} /></span>
                  <span style={{ fontWeight: 700, fontSize: "1.05rem", color: "var(--text-hi)" }}>{t("cover.created")}</span>
                </div>
                <p style={{ fontSize: "0.84rem", color: "var(--dim)", margin: 0, lineHeight: 1.5 }}>{t("cover.wizardHint")}</p>
                {/* Two named ways out, side by side — not one long page. */}
                <div data-testid="wiz-post-decision" style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                  <button type="button" data-testid="wiz-to-op" onClick={() => nav(`/ops/${createdId}`)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0.6rem 1.4rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.78rem", borderRadius: 10, cursor: "pointer" }}>{t("cover.toOp")}<Ic name="arrow" size={14} sw={1.8} /></button>
                  <button type="button" data-testid="wiz-post-edit" aria-pressed={postMode === "edit"} onClick={() => setPostMode("edit")} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0.6rem 1.4rem", border: postMode === "edit" ? "1px solid var(--edge-green)" : "1px solid var(--border)", background: postMode === "edit" ? "var(--tint-green)" : "transparent", color: postMode === "edit" ? "var(--green)" : "var(--dim)", fontFamily: MONO, fontSize: "0.78rem", borderRadius: 10, cursor: "pointer" }}><Ic name="edit" size={14} sw={1.7} /> Cover &amp; Freigabe ergänzen</button>
                </div>
                {postMode === "edit" && (
                  <div data-testid="wiz-post-panels" style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
                    <CoverPanel opId={createdId} csrf={csrf} onNotice={setNotice} />
                    <YoutubeField opId={createdId} csrf={csrf} onNotice={setNotice} />
                    <DocumentsPanel opId={createdId} csrf={csrf} canManage initialDocs={[]} onNotice={setNotice} />
                    <ShareChannel opId={createdId} guildId={guildId} csrf={csrf} onNotice={setNotice} />
                  </div>
                )}
              </div>
            )}
          </section>

          {/* nav */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "1rem" }}>
            <button type="button" data-testid="wiz-back" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0.55rem 1rem", border: "1px solid var(--wash)", background: "transparent", color: step === 0 ? "var(--dim3)" : "var(--dim)", fontFamily: MONO, fontSize: "0.74rem", borderRadius: 9, cursor: step === 0 ? "default" : "pointer" }}><Ic name="back" size={14} sw={1.8} /> Zurück</button>
            <span style={{ flex: 1 }} />
            {step < 5 && <button type="button" data-testid="wiz-next" onClick={goNext} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0.55rem 1.2rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.74rem", borderRadius: 9, cursor: "pointer" }}>Weiter<Ic name="arrow" size={14} sw={1.8} /></button>}
          </div>
        </div>

        {/* summary */}
        <aside style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg2)", padding: "1.1rem 1.2rem", position: "sticky", top: 80 }}>
          <div style={{ fontFamily: MONO, fontSize: "0.64rem", letterSpacing: "0.1em", color: "var(--dim3)", marginBottom: "0.8rem" }}>ZUSAMMENFASSUNG</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
            {[
              { label: "Eckdaten", ok: eckdatenDone, step: 0, required: true },
              { label: "Briefing", ok: description.trim().length > 0, step: 1, required: false },
              { label: "Treffpunkt", ok: meetingLocation.trim().length > 0, step: 2, required: false },
              { label: "Bedarf", ok: ships.length > 0 || fighters > 0 || cqb > 0, step: 3, required: false },
            ].map((r) => (
              <button
                key={r.label}
                type="button"
                data-testid={`wiz-summary-${r.step}`}
                onClick={() => goStep(r.step)}
                title={`Zu Schritt ${r.step + 1} · ${STEPS[r.step]}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", width: "100%", padding: 0, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
              >
                <span style={{ fontSize: "0.82rem", color: "var(--text)" }}>{r.label}{r.required && <span style={{ color: "var(--gold)" }}> *</span>}</span>
                <span style={tag(r.ok)}>{r.ok ? "OK" : r.required ? "fehlt" : "optional"}</span>
              </button>
            ))}
          </div>
        </aside>
      </div>
      <style>{`@media (max-width: 900px){.fpw-wizard-grid{display:flex !important;flex-direction:column}}`}</style>

      {/* IA merge F: "Aus Vorlage starten" — the marketplace as a picker overlay
          inside the op-editor (applying navigates to the created op). */}
      {picker && (
        <div data-testid="template-picker-backdrop" style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(18, 20, 22,0.72)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "3vh 1rem" }} onClick={() => setPicker(false)}>
          <div ref={pickerRef} role="dialog" aria-modal="true" aria-labelledby="template-picker-title" data-testid="template-picker" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 1080, background: "var(--bg)", border: "1px solid var(--border-hi)", borderRadius: 14, padding: "1.4rem 1.5rem", boxShadow: "0 24px 70px rgba(0,0,0,0.6)" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: "0.6rem" }}>
              <span id="template-picker-title" style={{ flex: 1, fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.14em", color: "var(--dim3)" }}>AUS VORLAGE STARTEN</span>
              <button type="button" data-testid="template-picker-close" onClick={() => setPicker(false)} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid var(--wash)", background: "transparent", color: "var(--dim)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Ic name="x" size={14} sw={2} /></button>
            </div>
            <TemplatesPage session={session} />
          </div>
        </div>
      )}
    </div>
  );
}

// Attach a YouTube video to the op as a resource link (kind youtube → thumbnail on
// the op page). Reuses the resource-links backend; the op detail page's
// ResourceLinksPanel can add/remove more later.
function YoutubeField({ opId, csrf, onNotice }: { opId: string; csrf: string | null; onNotice: (m: string) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);

  async function add() {
    if (!csrf || !url.trim() || busy) return;
    setBusy(true);
    try {
      await addResourceLink(opId, csrf, { url: url.trim(), kind: "youtube" });
      setAdded(true);
      setUrl("");
      onNotice("YouTube-Video hinterlegt.");
    } catch (e) {
      onNotice(e instanceof ApiError ? e.message : "Konnte Video nicht hinterlegen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg2)", padding: "1.1rem 1.2rem" }} data-testid="youtube-field">
      <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.06em", color: "var(--text-hi)", marginBottom: "0.9rem" }}>
        <span style={{ color: "var(--red)", display: "inline-flex" }}><Ic name="youtube" size={15} sw={1.6} /></span> YOUTUBE-VIDEO
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <input data-testid="youtube-url" type="url" value={url} onChange={(e) => { setUrl(e.target.value); setAdded(false); }} placeholder="https://youtu.be/… oder youtube.com/watch?v=…" style={{ ...inp, width: "auto", minWidth: 220, flex: "1 1 220px" }} />
        <button type="button" data-testid="youtube-add" disabled={busy || !csrf || !url.trim()} onClick={add} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.5rem 1rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.74rem", borderRadius: 9, cursor: "pointer" }}>
          {added ? <><Ic name="check" size={14} sw={2} /> Hinterlegt</> : <><Ic name="plus" size={14} sw={1.7} /> Hinterlegen</>}
        </button>
      </div>
    </section>
  );
}

// FR-C2: post a one-shot announcement (title, time, link) to a Discord channel
// right after creating the op. Channels are the op guild's text channels.
function ShareChannel({ opId, guildId, csrf, onNotice }: { opId: string; guildId: string; csrf: string | null; onNotice: (m: string) => void }) {
  const [channels, setChannels] = useState<Array<{ id: string; name: string }> | null>(null);
  const [channel, setChannel] = useState("");
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(false);

  useEffect(() => {
    getGuildChannels(guildId).then((r) => setChannels(r.channels)).catch(() => setChannels([]));
  }, [guildId]);

  async function post() {
    if (!csrf || !channel || busy) return;
    setBusy(true);
    try {
      await announceOperation(opId, csrf, channel);
      setPosted(true);
      onNotice("Ankündigung gepostet.");
    } catch (e) {
      onNotice(e instanceof ApiError ? e.message : "Posten fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  if (channels !== null && channels.length === 0) return null; // bot not configured / no channels

  return (
    <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg2)", padding: "1.1rem 1.2rem" }} data-testid="share-channel">
      <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.06em", color: "var(--text-hi)", marginBottom: "0.9rem" }}>
        <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="chat" size={15} sw={1.6} /></span> ANKÜNDIGUNG TEILEN
      </div>
      {channels === null ? (
        <p style={{ ...lbl, marginBottom: 0 }}>LADE KANÄLE…</p>
      ) : (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <select data-testid="share-channel-select" value={channel} onChange={(e) => setChannel(e.target.value)} style={{ ...inp, width: "auto", minWidth: 200, flex: "1 1 200px" }}>
            <option value="">Kanal wählen…</option>
            {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
          <button type="button" data-testid="share-channel-post" disabled={busy || !channel || !csrf} onClick={post} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.5rem 1rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.74rem", borderRadius: 9, cursor: "pointer" }}>
            {posted ? <><Ic name="check" size={14} sw={2} /> Gepostet</> : <><Ic name="chat" size={14} sw={1.7} /> In Kanal posten</>}
          </button>
        </div>
      )}
    </section>
  );
}
