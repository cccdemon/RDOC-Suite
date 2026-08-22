import type { CoverRequest, CoverData, CoverFormat, CoverPreset } from "../schema.js";

// Engine config is opaque JSON the MissionCover bundle hydrates from localStorage
// (key `star-citizen-cover-generator-config`). We mirror the engine's
// defaultTemplates style fields here so the service stays decoupled from the
// engine's JSX (no import across the React/TS boundary).
export type EngineConfig = Record<string, unknown>;

type StyleBase = {
  primaryColor: string;
  secondaryColor: string;
  glowColor: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  fontTitle: string;
  fontBody: string;
  scanlinesIntensity: number;
  noiseIntensity: number;
  vignetteIntensity: number;
  glitchIntensity: number;
  chromaticAberration: number;
  gridOverlay: string;
  logoType: string;
  logoPlacement: string;
  backgroundBrightness: number;
  backgroundContrast: number;
  backgroundBlur: number;
  backgroundSaturate: number;
};

// Ported from engine/src/data/defaultTemplates.js (style fields only; text is
// supplied per-request via the op payload).
const PRESET_STYLE: Record<CoverPreset, StyleBase> = {
  "fleet-ops": {
    primaryColor: "#00f0ff", secondaryColor: "#005577", glowColor: "rgba(0, 240, 255, 0.4)",
    backgroundColor: "rgba(0, 10, 20, 0.85)", textColor: "#e5e7eb", accentColor: "#38bdf8",
    fontTitle: "Russo One", fontBody: "Rajdhani",
    scanlinesIntensity: 25, noiseIntensity: 15, vignetteIntensity: 45, glitchIntensity: 10,
    chromaticAberration: 15, gridOverlay: "dots", logoType: "uee", logoPlacement: "left",
    backgroundBrightness: 100, backgroundContrast: 105, backgroundBlur: 0, backgroundSaturate: 100,
  },
  "black-ops": {
    primaryColor: "#ef4444", secondaryColor: "#7f1d1d", glowColor: "rgba(239, 68, 68, 0.45)",
    backgroundColor: "rgba(10, 0, 0, 0.9)", textColor: "#f3f4f6", accentColor: "#f87171",
    fontTitle: "Orbitron", fontBody: "Rajdhani",
    scanlinesIntensity: 45, noiseIntensity: 25, vignetteIntensity: 65, glitchIntensity: 30,
    chromaticAberration: 35, gridOverlay: "squares", logoType: "aegis", logoPlacement: "both",
    backgroundBrightness: 85, backgroundContrast: 120, backgroundBlur: 1, backgroundSaturate: 75,
  },
  exploration: {
    primaryColor: "#10b981", secondaryColor: "#065f46", glowColor: "rgba(16, 185, 129, 0.35)",
    backgroundColor: "rgba(2, 15, 10, 0.85)", textColor: "#e5e7eb", accentColor: "#34d399",
    fontTitle: "Orbitron", fontBody: "Rajdhani",
    scanlinesIntensity: 15, noiseIntensity: 10, vignetteIntensity: 35, glitchIntensity: 5,
    chromaticAberration: 8, gridOverlay: "dots", logoType: "microtech", logoPlacement: "left",
    backgroundBrightness: 110, backgroundContrast: 100, backgroundBlur: 0, backgroundSaturate: 110,
  },
  outlaw: {
    primaryColor: "#f59e0b", secondaryColor: "#b45309", glowColor: "rgba(245, 158, 11, 0.4)",
    backgroundColor: "rgba(18, 12, 2, 0.9)", textColor: "#f9fafb", accentColor: "#fbbf24",
    fontTitle: "Russo One", fontBody: "Rajdhani",
    scanlinesIntensity: 55, noiseIntensity: 30, vignetteIntensity: 55, glitchIntensity: 40,
    chromaticAberration: 45, gridOverlay: "none", logoType: "drake", logoPlacement: "right",
    backgroundBrightness: 90, backgroundContrast: 115, backgroundBlur: 0, backgroundSaturate: 120,
  },
};

const ALL_LAYERS_VISIBLE = {
  background: { visible: true, opacity: 100 },
  effects: { visible: true, opacity: 100 },
  logos: { visible: true, opacity: 100 },
  title: { visible: true, opacity: 100 },
  objective: { visible: true, opacity: 100 },
  header: { visible: true, opacity: 100 },
  qr: { visible: true, opacity: 100 },
  gradient: { visible: true, opacity: 100 },
};

// CSS pixel dimensions of the engine's `#mission-cover-canvas` per format.
// Mirrors getCanvasWidth() + aspect ratio in CoverCanvas.jsx.
export function cssDimensions(format: CoverFormat, data: CoverData, config?: EngineConfig): { w: number; h: number } {
  const cw = typeof config?.customWidth === "number" ? (config.customWidth as number) : 1200;
  const ch = typeof config?.customHeight === "number" ? (config.customHeight as number) : 675;
  switch (format) {
    case "1:1": return { w: 800, h: 800 };
    case "9:16": return { w: 540, h: 960 };
    case "4:3": return { w: 1000, h: 750 };
    case "custom": {
      const w = Math.min(cw, 1200);
      return { w, h: Math.round(w * (ch / cw)) };
    }
    default: return { w: 1200, h: 675 };
  }
}

/**
 * Badge and QR placement per format, in the engine's 1200x675 reference units
 * (the engine turns them into percentages of the real canvas).
 *
 * The engine's own defaults are tuned for 16:9 only, and two of them are wrong
 * everywhere: the badges sat across the "MISSION DOSSIER" line, and the QR —
 * which is a fixed 80x80 CSS pixels no matter how wide the canvas is — was
 * placed at 87.5%, so on a 540px-wide 9:16 canvas part of it hung over the
 * edge, and on 16:9 it covered the security footer.
 *
 * Kept in reference units rather than pixels so a person dragging the badge in
 * the editor afterwards still works with the same coordinate system.
 */
const OVERLAY_PLACEMENT: Record<CoverFormat, {
  badgeSize: number; logo1X: number; logo1Y: number; logo2X: number; logo2Y: number;
  qrX: number; qrY: number;
}> = {
  // canvas 1200x675
  "16:9": { badgeSize: 70, logo1X: 40, logo1Y: 150, logo2X: 134, logo2Y: 150, qrX: 1092, qrY: 465 },
  // canvas 800x800 — a badge needs more reference width to keep its pixel size
  "1:1": { badgeSize: 96, logo1X: 40, logo1Y: 150, logo2X: 160, logo2Y: 150, qrX: 1038, qrY: 498 },
  // canvas 540x960 — the narrow one; everything has to stay well inside
  "9:16": { badgeSize: 115, logo1X: 40, logo1Y: 150, logo2X: 179, logo2Y: 150, qrX: 960, qrY: 527 },
  // canvas 1000x750
  "4:3": { badgeSize: 77, logo1X: 40, logo1Y: 150, logo2X: 141, logo2Y: 150, qrX: 1070, qrY: 486 },
  // free size — treat like 16:9 and let the caller override
  custom: { badgeSize: 70, logo1X: 40, logo1Y: 150, logo2X: 134, logo2Y: 150, qrX: 1092, qrY: 465 },
};

/** Build the full engine config from an op payload. */
export function buildEngineConfig(req: CoverRequest): EngineConfig {
  const style = PRESET_STYLE[req.preset];
  const d = req.data;
  const b = d.branding ?? {};

  // Compose objective text up front (avoids reading back from the untyped
  // EngineConfig record, which would be `unknown` in a template literal).
  let objectiveText = d.objectiveText ?? "";
  if (d.assets?.length) {
    const assetLines = d.assets.map((a) => (a.role ? `${a.name} — ${a.role}` : a.name)).join("\n");
    objectiveText = `${objectiveText}\n\nASSETS:\n${assetLines}`.trim();
  }

  const base: EngineConfig = {
    id: req.preset,
    name: req.preset,
    ...style,

    // RDOC default branding (overridable per request via data.branding).
    dossierLabel: b.footerTitle ?? "RDOC EINSATZBEFEHL >>>",
    statusLabel: "STATUS: BEREIT // STANDBY",
    securityText: b.securityText ?? "RDOC FLOTTENKOMMANDO // EINSATZPLANUNG",
    fileCode: b.fileCode ?? `DATEI: ${req.opId}`,

    // Op text.
    title: d.title,
    subtitle: d.subtitle ?? "",
    tagline: d.tagline ?? "",
    objectiveTitle: d.objectiveTitle ?? "ZIEL:",
    objectiveText,
    location: d.location ?? "",
    dateTime: d.dateTime ?? "",

    // Color overrides.
    primaryColor: d.primaryColor ?? style.primaryColor,
    accentColor: d.accentColor ?? style.accentColor,
    glowColor: d.primaryColor ? `${d.primaryColor}66` : style.glowColor,

    // Badges / extras — placed per format, see OVERLAY_PLACEMENT.
    showCommunityBadge: true,
    showScBadge: true,
    ...OVERLAY_PLACEMENT[req.format],
    cropMarks: true,
    colorFilter: "none",
    focusLensBlur: 0,
    titleSize: 42,
    subtitleSize: 13,
    titleEffect: "glow",

    // QR from briefing permalink (position comes from OVERLAY_PLACEMENT above).
    qrEnabled: Boolean(d.briefingUrl),
    qrUrl: d.briefingUrl ?? "",

    coverFormat: req.format,
    customWidth: 1200,
    customHeight: 675,
    layers: ALL_LAYERS_VISIBLE,
  };

  // Guild logo → custom logo.
  if (b.guildLogoUrl) {
    base.logoType = "custom";
    base.customLogoUrl = b.guildLogoUrl;
  }

  // Caller-supplied full config wins (editor round-trip).
  return { ...base, ...(req.config ?? {}) };
}

