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
