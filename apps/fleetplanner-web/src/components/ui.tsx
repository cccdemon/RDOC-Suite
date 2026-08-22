// Shared design tokens for the redesigned SPA screens (Claude Design handoff
// "Fleetplanner-App"). Solid colours map to the repo's var(--*) palette; the
// translucent borders/backgrounds reuse the same hues via rgba(), exactly as
// the design source does. Reuse these instead of hardcoding hex per page.
import { useRef, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useServerContext } from "../serverContext";
import { Ic } from "./Icons";

export const MONO = "var(--mono)";

export const card: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 14,
  background: "var(--bg2)",
  padding: "1.1rem 1.2rem",
};

const cardHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.55rem",
  marginBottom: "0.9rem",
  paddingBottom: "0.7rem",
  borderBottom: "1px solid var(--border)",
  fontFamily: MONO,
  fontSize: "0.74rem",
  letterSpacing: "0.06em",
  color: "var(--text-hi)",
};

/** Theme-aware wash over any CSS colour. Brandkit v2.2 derives every tint
 * with color-mix() instead of a frozen rgba() triple, so it follows the light
 * palette (which is measured, not inverted). */
export function tint(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

function chip(color: string): CSSProperties {
  return {
    width: 28,
    height: 28,
    borderRadius: 8,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: tint(color, 12),
    border: `1px solid ${tint(color, 30)}`,
    color,
  };
}

export const lbl: CSSProperties = {
  display: "block",
  fontFamily: MONO,
  fontSize: "0.62rem",
  letterSpacing: "0.06em",
  color: "var(--dim)",
  textTransform: "uppercase",
  marginBottom: "0.4rem",
};

export const inp: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--bg3)",
  border: "1px solid var(--border)",
  color: "var(--text-hi)",
  // What a user types into these is prose — an operation title, a briefing, a
  // channel name. Monospace belongs on status, time and IDs (§10.1), not on
  // everything that happens to sit in a box.
  fontFamily: "var(--body)",
  fontSize: "0.9rem",
  padding: "0.55rem 0.7rem",
  borderRadius: 8,
  outline: "none",
  transition: "border-color .12s",
};

export const ta: CSSProperties = { ...inp, minHeight: 180, lineHeight: 1.55, resize: "vertical", fontSize: "0.82rem" };

/** segmented chip (op-type / system / etc.) */
export function segChip(active: boolean, color: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "0.42rem 0.7rem",
    fontFamily: MONO,
    fontSize: "0.7rem",
    letterSpacing: "0.02em",
    borderRadius: 8,
    cursor: "pointer",
    transition: "all .12s",
    border: active ? `1px solid ${color}` : "1px solid var(--wash)",
    background: active ? tint(color, 14) : "transparent",
    color: active ? color : "var(--dim)",
  };
}

// Tone names kept for the call sites; `violet` has had no brand equivalent
// since the palette closed and resolves to Steel like the other retired hues.
const CHIP_COLORS: Record<string, string> = {
  cyan: "var(--cyan)",
  violet: "var(--dim)",
  green: "var(--green)",
  gold: "var(--gold)",
  red: "var(--red)",
};

/** Card section header: icon chip + mono label. */
export function CardHead({ icon, label, tone = "cyan", right }: { icon: string; label: string; tone?: keyof typeof CHIP_COLORS; right?: ReactNode }) {
  const color = CHIP_COLORS[tone];
  return (
    <div style={right ? { ...cardHead, justifyContent: "space-between" } : cardHead}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem" }}>
        <span style={chip(color)}><Ic name={icon} size={15} sw={1.6} /></span>
        {label}
      </span>
      {right}
    </div>
  );
}

// §10.4 — three ranks that are told apart at a glance, not by reading them.
//
// Primary and ghost used to differ by an outline colour and nothing else: both
// monospace, both the same size, one cyan-on-wash and one dim-on-transparent.
// On a screen with six controls that is not a hierarchy, it is six equal
// buttons. Primary is filled now; the quiet ones stay quiet.
//
// The label is body type, not monospace: §10.1 keeps monospace for status,
// time, IDs and short eyebrows. "Operation erstellen" is none of those.
const btnBase: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
  fontFamily: "var(--body)", fontSize: "0.86rem", fontWeight: 600,
  borderRadius: 9, cursor: "pointer", whiteSpace: "nowrap",
};

/** The one next action in a context. Filled, so it wins without being loud. */
export const btnPrimary: CSSProperties = {
  ...btnBase,
  padding: "0.5rem 1.3rem",
  border: "1px solid var(--cyan)", background: "var(--cyan)", color: "var(--bg)",
};

/** Reversible alternatives and navigation. Present, not competing. */
export const btnGhost: CSSProperties = {
  ...btnBase,
  padding: "0.5rem 1.1rem", fontWeight: 500,
  border: "1px solid var(--border)", background: "transparent", color: "var(--dim)",
};

// ── one tab implementation for independently addressable views ──────────────
// UI audit §9: Konto, Rechtliches and every other "these are views of the same
// object" strip used to be plain links with a coloured underline. They are links
// on purpose (each view has its own URL), but they carry full tab semantics:
// tablist/tab/aria-selected/aria-controls, a roving tabindex, and arrow-key
// movement. The active tab is marked by more than colour (aria-selected +
// aria-current), so it survives a high-contrast or monochrome theme.
const linkTabBase: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 0.9rem",
  fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.03em", cursor: "pointer",
  whiteSpace: "nowrap", borderBottom: "2px solid transparent", color: "var(--dim)",
  textDecoration: "none",
};
const linkTabActive: CSSProperties = { ...linkTabBase, color: "var(--cyan)", borderBottom: "2px solid var(--cyan)", fontWeight: 700 };

export type LinkTabItem = { key: string; label: string; to: string; icon?: string };

export function LinkTabs({
  ariaLabel,
  panelId,
  activeKey,
  items,
  testid,
}: {
  ariaLabel: string;
  /** id of the <div role="tabpanel"> these tabs control. */
  panelId: string;
  activeKey: string;
  items: LinkTabItem[];
  testid?: (key: string) => string;
}) {
  const navigate = useNavigate();
  const refs = useRef<Record<string, HTMLAnchorElement | null>>({});
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{ display: "flex", gap: "0.3rem", overflowX: "auto", borderBottom: "1px solid var(--border)", marginBottom: "1.4rem" }}
    >
      {items.map((it, i) => {
        const on = it.key === activeKey;
        return (
          <Link
            key={it.key}
            to={it.to}
            role="tab"
            id={`${panelId}-tab-${it.key}`}
            aria-selected={on}
            aria-controls={panelId}
            aria-current={on ? "page" : undefined}
            tabIndex={on ? 0 : -1}
            ref={(el) => { refs.current[it.key] = el; }}
            data-testid={testid ? testid(it.key) : undefined}
            onKeyDown={(e) => {
              const j = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % items.length
                : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + items.length) % items.length
                : e.key === "Home" ? 0
                : e.key === "End" ? items.length - 1
                : -1;
              if (j < 0) return;
              e.preventDefault();
              navigate(items[j].to);
              refs.current[items[j].key]?.focus();
            }}
            style={on ? linkTabActive : linkTabBase}
          >
            {it.icon && <Ic name={it.icon} size={14} sw={1.7} />}
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}

// ── card types (UI audit §8) ────────────────────────────────────────────────
// "fpw-card" used to mean six different things. These six components each carry
// one promise, and each stamps a data-card attribute so the type is visible in
// the DOM, in a test and in a review — not inferred from what is inside it.

/** Whole tile opens exactly ONE target. Interactive children must call
 *  stopPropagation/preventDefault themselves — see the Discord button on the op
 *  card for the pattern. */
export function ObjectTile({
  to, children, testid, ariaLabel, style, className,
}: {
  to: string;
  children: ReactNode;
  testid?: string;
  ariaLabel?: string;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <Link
      to={to}
      data-card="object"
      data-testid={testid}
      aria-label={ariaLabel}
      className={`fpw-card fpw-cardlink${className ? " " + className : ""}`}
      style={style}
    >
      {children}
    </Link>
  );
}

/** A choice, not a destination: pressed state instead of navigation. */
export function ChoiceTile({
  selected, onSelect, children, testid, title, style, disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  testid?: string;
  title?: string;
  style?: CSSProperties;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-card="choice"
      data-testid={testid}
      aria-pressed={selected}
      title={title}
      disabled={disabled}
      onClick={onSelect}
      style={style}
    >
      {children}
    </button>
  );
}

/** Holds its own local actions; the card itself is not a target. */
export function WorkCard({
  children, testid, style, className,
}: {
  children: ReactNode;
  testid?: string;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <section data-card="work" data-testid={testid} className={`fpw-card${className ? " " + className : ""}`} style={style}>
      {children}
    </section>
  );
}

/** Destructive work, kept away from the routine controls. */
export function DangerZone({
  title = "Gefahrenbereich",
  description,
  children,
  testid,
  style,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  testid?: string;
  style?: CSSProperties;
}) {
  return (
    <section data-card="danger" data-testid={testid} className="fpw-card" style={style}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontFamily: MONO, fontSize: "0.68rem", letterSpacing: "0.1em", color: "var(--red)" }}>
        <Ic name="alert" size={15} sw={1.7} /> {title.toUpperCase()}
      </div>
      {description && (
        <p style={{ margin: 0, color: "var(--dim)", fontSize: "0.84rem", lineHeight: 1.5 }}>{description}</p>
      )}
      {children}
    </section>
  );
}

// ── whose server am I changing, and as what? ────────────────────────────────
// UI audit §2: "Bei serverbezogenen Mutationen immer Servername und
// gegebenenfalls Rolle im Seitenkopf anzeigen." The server name was already in
// the breadcrumb; the role was nowhere, so a crew member and an operator saw the
// same header on a page whose buttons behave differently for them.
const ROLE_LABEL: Record<string, string> = {
  fleetoperator: "Fleetoperator",
  crew: "Crew",
};

export function ServerScope({
  guildName,
  role,
  testid = "server-scope",
}: {
  guildName?: string | null;
  role?: string | null;
  testid?: string;
}) {
  const { unknownGuildId } = useServerContext();
  if (!guildName) return null;
  const roleLabel = role ? ROLE_LABEL[role] ?? role : null;
  return (
    <>
    {/* §11: a link into a server the viewer is not in must say so instead of
        quietly showing a different one. */}
    {unknownGuildId && (
      <p role="status" data-testid="server-scope-unknown" style={{ margin: "0 0 0.6rem", padding: "0.5rem 0.7rem", border: "1px solid var(--edge-gold)", background: "var(--tint-gold)", borderRadius: 9, color: "var(--gold)", fontSize: "0.82rem", lineHeight: 1.45 }}>
        Der verlinkte Server gehört nicht zu deinen — angezeigt wird stattdessen <strong>{guildName}</strong>.
      </p>
    )}
    <p
      data-testid={testid}
      style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", margin: "0 0 1.1rem", fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.06em", color: "var(--dim2)" }}
    >
      <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="server" size={13} sw={1.7} /></span>
      <span style={{ color: "var(--text-hi)" }}>{guildName}</span>
      {roleLabel && (
        <>
          <span aria-hidden="true">·</span>
          <span data-testid={`${testid}-role`} style={{ border: "1px solid var(--border-hi)", borderRadius: 5, padding: "0.1rem 0.4rem" }}>
            DEINE ROLLE: {roleLabel.toUpperCase()}
          </span>
        </>
      )}
    </p>
    </>
  );
}
