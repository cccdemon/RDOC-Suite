import { describe, it, expect } from "vitest";
import { normShipName } from "../../services/fleetyards.js";

describe("normShipName", () => {
  it("lowercases and strips non-alphanumerics for loose matching", () => {
    expect(normShipName("Aegis Idris-P")).toBe("aegisidrisp");
    expect(normShipName("F7C-M Super Hornet")).toBe("f7cmsuperhornet");
    expect(normShipName("  Carrack  ")).toBe("carrack");
  });
  it("matches names that differ only by punctuation/spacing/case", () => {
    expect(normShipName("100i")).toBe(normShipName("100 I"));
    expect(normShipName("MISC Freelancer MAX")).toBe(normShipName("misc-freelancer-max"));
  });
  it("returns empty for empty/garbage", () => {
    expect(normShipName("")).toBe("");
    expect(normShipName("  -- ")).toBe("");
  });
});
