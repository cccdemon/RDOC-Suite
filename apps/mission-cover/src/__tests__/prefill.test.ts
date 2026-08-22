import { describe, it, expect } from "vitest";
import { cssDimensions, buildEngineConfig } from "../services/prefill.js";
import type { CoverRequest } from "../schema.js";

function req(over: Partial<CoverRequest> = {}): CoverRequest {
  return {
    opId: "op1",
    format: "16:9",
    preset: "fleet-ops",
    data: { title: "OP DATENKERN" },
    config: null,
    ...over,
  } as CoverRequest;
}

describe("cssDimensions", () => {
  it("maps the fixed aspect ratios", () => {
    expect(cssDimensions("16:9", { title: "" })).toEqual({ w: 1200, h: 675 });
    expect(cssDimensions("1:1", { title: "" })).toEqual({ w: 800, h: 800 });
    expect(cssDimensions("9:16", { title: "" })).toEqual({ w: 540, h: 960 });
    expect(cssDimensions("4:3", { title: "" })).toEqual({ w: 1000, h: 750 });
  });

  it("custom clamps width to 1200 and keeps the aspect ratio", () => {
    expect(cssDimensions("custom", { title: "" }, { customWidth: 2000, customHeight: 1000 })).toEqual({
      w: 1200,
      h: 600,
    });
    expect(cssDimensions("custom", { title: "" }, { customWidth: 800, customHeight: 800 })).toEqual({
      w: 800,
      h: 800,
    });
  });

  it("custom falls back to 1200x675 defaults without config", () => {
    expect(cssDimensions("custom", { title: "" })).toEqual({ w: 1200, h: 675 });
  });
});

describe("buildEngineConfig", () => {
  it("carries op text + preset id and enables QR only with a briefing url", () => {
    const c = buildEngineConfig(req({ data: { title: "T", subtitle: "S", briefingUrl: "https://x/op" } }));
    expect(c.id).toBe("fleet-ops");
    expect(c.title).toBe("T");
    expect(c.subtitle).toBe("S");
    expect(c.qrEnabled).toBe(true);
    expect(c.qrUrl).toBe("https://x/op");
    expect(c.coverFormat).toBe("16:9");
  });

  it("disables QR when no briefing url", () => {
    expect(buildEngineConfig(req()).qrEnabled).toBe(false);
  });

  it("appends assets to the objective text", () => {
    const c = buildEngineConfig(
      req({ data: { title: "T", objectiveText: "Secure core.", assets: [{ name: "Carrack", role: "Recon" }, { name: "Gladius" }] } }),
    );
    expect(c.objectiveText).toContain("Secure core.");
    expect(c.objectiveText).toContain("ASSETS:");
    expect(c.objectiveText).toContain("Carrack — Recon");
    expect(c.objectiveText).toContain("Gladius");
  });

  it("guild logo becomes a custom logo", () => {
    const c = buildEngineConfig(req({ data: { title: "T", branding: { guildLogoUrl: "https://x/logo.png" } } }));
    expect(c.logoType).toBe("custom");
    expect(c.customLogoUrl).toBe("https://x/logo.png");
  });

  it("a caller-supplied config overrides the defaults (editor round-trip)", () => {
    const c = buildEngineConfig(req({ config: { title: "OVERRIDE", titleSize: 99 } }));
    expect(c.title).toBe("OVERRIDE");
    expect(c.titleSize).toBe(99);
  });
});

// ── Overlay placement (2026-08-22) ───────────────────────────────────────────
// The engine's own defaults are 16:9-only: the badges sat across the header
// line and the QR — 80 fixed CSS pixels wide however wide the canvas is — was
// anchored at 87.5%, which hangs over the edge of a 540px 9:16 canvas.
describe("buildEngineConfig — overlay placement", () => {
  const placementReq = (format: "16:9" | "1:1" | "9:16" | "4:3") =>
    req({ format, data: { title: "T", briefingUrl: "https://example.com/op" } });

  it("keeps the badges clear of the header in every format", () => {
    for (const f of ["16:9", "1:1", "9:16", "4:3"] as const) {
      const c = buildEngineConfig(placementReq(f));
      // Reference units are 1200x675; the header bar ends around y=110.
      expect(Number(c.logo1Y)).toBeGreaterThanOrEqual(140);
      expect(Number(c.logo2Y)).toBeGreaterThanOrEqual(140);
    }
  });

  it("keeps the two badges from overlapping each other", () => {
    for (const f of ["16:9", "1:1", "9:16", "4:3"] as const) {
      const c = buildEngineConfig(placementReq(f));
      expect(Number(c.logo2X) - Number(c.logo1X)).toBeGreaterThanOrEqual(Number(c.badgeSize));
    }
  });

  it("keeps the whole QR code inside the canvas", () => {
    const QR_PX = 80;
    for (const f of ["16:9", "1:1", "9:16", "4:3"] as const) {
      const c = buildEngineConfig(placementReq(f));
      const { w, h } = cssDimensions(f, { title: "T" }, c);
      // The engine turns qrX/qrY into percentages of the real canvas.
      const left = (Number(c.qrX) / 1200) * w;
      const top = (Number(c.qrY) / 675) * h;
      expect(left + QR_PX).toBeLessThanOrEqual(w);
      expect(top + QR_PX).toBeLessThanOrEqual(h);
    }
  });

  it("leaves room between the QR and the footer band", () => {
    for (const f of ["16:9", "1:1", "9:16", "4:3"] as const) {
      const c = buildEngineConfig(placementReq(f));
      const { h } = cssDimensions(f, { title: "T" }, c);
      const bottom = (Number(c.qrY) / 675) * h + 80;
      expect(h - bottom).toBeGreaterThanOrEqual(60);
    }
  });
});

describe("buildEngineConfig — branding", () => {
  it("defaults to RDOC wording, not the source tool's placeholder", () => {
    const c = buildEngineConfig(req());
    expect(String(c.securityText)).toContain("RDOC");
    expect(String(c.securityText)).not.toMatch(/vi5e|cco/i);
    expect(String(c.dossierLabel)).toContain("RDOC");
  });

  it("still lets a caller override the branding", () => {
    const c = buildEngineConfig(req({ data: { title: "T", branding: { securityText: "EIGENER TEXT", footerTitle: "EIGENER TITEL" } } }));
    expect(c.securityText).toBe("EIGENER TEXT");
    expect(c.dossierLabel).toBe("EIGENER TITEL");
  });
});
