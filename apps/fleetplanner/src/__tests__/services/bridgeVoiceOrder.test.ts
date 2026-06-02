import { describe, it, expect } from "vitest";
import { applyChannelReorder } from "../../services/bridgeVoiceOrder.js";

const A = "111111111111111111";
const B = "222222222222222222";
const C = "333333333333333333";
const CSV = [A, B, C].join(",");

describe("applyChannelReorder", () => {
  it("moves a channel up one step", () => {
    expect(applyChannelReorder(CSV, B, "up")).toEqual([B, A, C]);
  });

  it("moves a channel down one step", () => {
    expect(applyChannelReorder(CSV, B, "down")).toEqual([A, C, B]);
  });

  it("returns null when the first channel moves up (boundary)", () => {
    expect(applyChannelReorder(CSV, A, "up")).toBeNull();
  });

  it("returns null when the last channel moves down (boundary)", () => {
    expect(applyChannelReorder(CSV, C, "down")).toBeNull();
  });

  it("returns null when the channel is not in the list", () => {
    expect(applyChannelReorder(CSV, "999999999999999999", "up")).toBeNull();
  });

  it("drops non-snowflake garbage from the CSV before swapping", () => {
    const dirty = `${A}, not-an-id ,${B},,${C}`;
    expect(applyChannelReorder(dirty, C, "up")).toEqual([A, C, B]);
  });

  it("moving the first channel down swaps it with the second", () => {
    expect(applyChannelReorder(CSV, A, "down")).toEqual([B, A, C]);
  });
});
