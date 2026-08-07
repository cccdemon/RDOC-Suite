// Shared design tokens for the redesigned SPA screens (Claude Design handoff
// "Fleetplanner-App"). Solid colours map to the repo's var(--*) palette; the
// translucent borders/backgrounds reuse the same hues via rgba(), exactly as
// the design source does. Reuse these instead of hardcoding hex per page.
import type { CSSProperties, ReactNode } from "react";
import { Ic } from "./Icons";

export const MONO = "var(--mono)";
export const BODY = "var(--body)";

export const card: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 14,
  background: "var(--bg2)",
  padding: "1.1rem 1.2rem",
};

export const cardHead: CSSProperties = {
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

export function chip(rgb: string, color: string): CSSProperties {
  return {
    width: 28,
    height: 28,
    borderRadius: 8,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: `rgba(${rgb},0.12)`,
    border: `1px solid rgba(${rgb},0.3)`,
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
  fontFamily: MONO,
  fontSize: "0.84rem",
  padding: "0.58rem 0.7rem",
  borderRadius: 8,
  outline: "none",
  transition: "border-color .12s",
};

export const ta: CSSProperties = { ...inp, minHeight: 180, lineHeight: 1.55, resize: "vertical", fontSize: "0.82rem" };

/** segmented chip (op-type / system / etc.) */
export function segChip(active: boolean, color: string, rgb: string): CSSProperties {
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
    border: active ? `1px solid ${color}` : "1px solid rgba(255,255,255,0.1)",
    background: active ? `rgba(${rgb},0.14)` : "transparent",
    color: active ? color : "var(--dim)",
  };
}

const CHIP_COLORS: Record<string, [string, string]> = {
  cyan: ["118, 130, 141", "var(--cyan)"],
  violet: ["160,100,255", "var(--purple)"],
  green: ["0,255,136", "var(--green)"],
  gold: ["240,165,0", "var(--gold)"],
  red: ["255,68,68", "var(--red)"],
};

/** Card section header: icon chip + mono label. */
export function CardHead({ icon, label, tone = "cyan", right }: { icon: string; label: string; tone?: keyof typeof CHIP_COLORS; right?: ReactNode }) {
  const [rgb, color] = CHIP_COLORS[tone];
  return (
    <div style={right ? { ...cardHead, justifyContent: "space-between" } : cardHead}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem" }}>
        <span style={chip(rgb, color)}><Ic name={icon} size={15} sw={1.6} /></span>
        {label}
      </span>
      {right}
    </div>
  );
}

/** Page section heading (mono kicker + h1). */
export function PageHead({ icon, kicker, title, right }: { icon: string; kicker: string; title: string; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "0.6rem 1rem", marginBottom: "1.4rem" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.4rem" }}>
          <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name={icon} size={17} sw={1.7} /></span>
          <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.14em", color: "var(--dim2)" }}>{kicker}</span>
        </div>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", lineHeight: 1.12, color: "var(--text-hi)", margin: 0 }}>{title}</h1>
      </div>
      {right}
    </div>
  );
}

export const actionBar: CSSProperties = {
  position: "sticky",
  bottom: 0,
  marginTop: "1.2rem",
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "0.6rem",
  padding: "0.85rem 1rem",
  background: "rgba(18, 20, 22,0.92)",
  backdropFilter: "blur(8px)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  zIndex: 5,
};

export const btnPrimary: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 7, padding: "0.55rem 1.3rem",
  border: "1px solid var(--border-hi)", background: "rgba(43, 49, 53, 0.14)", color: "var(--cyan)",
  fontFamily: MONO, fontSize: "0.74rem", letterSpacing: "0.03em", borderRadius: 9, cursor: "pointer",
};
export const btnGhost: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 1.1rem",
  border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: "var(--dim)",
  fontFamily: MONO, fontSize: "0.74rem", borderRadius: 9, cursor: "pointer",
};
