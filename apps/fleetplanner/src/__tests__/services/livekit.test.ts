import { describe, it, expect } from "vitest";
import { fleetUnitRoom, fleetGlobalRoom } from "../../services/livekit.js";

describe("fleetUnitRoom", () => {
  it("formats room name from operationId and unitId", () => {
    expect(fleetUnitRoom("op-123", "unit-456")).toBe("fleet-op-123-unit-unit-456");
  });

  it("uses ids verbatim", () => {
    expect(fleetUnitRoom("abc", "xyz")).toBe("fleet-abc-unit-xyz");
  });

  it("different ops produce different room names", () => {
    expect(fleetUnitRoom("op-1", "unit-1")).not.toBe(fleetUnitRoom("op-2", "unit-1"));
  });

  it("different units in same op produce different room names", () => {
    expect(fleetUnitRoom("op-1", "unit-1")).not.toBe(fleetUnitRoom("op-1", "unit-2"));
  });
});

describe("fleetGlobalRoom", () => {
  it("formats global room name from operationId", () => {
    expect(fleetGlobalRoom("op-999")).toBe("fleet-op-999-global");
  });

  it("different ops produce different global rooms", () => {
    expect(fleetGlobalRoom("op-1")).not.toBe(fleetGlobalRoom("op-2"));
  });

  it("global room differs from unit room for same op", () => {
    expect(fleetGlobalRoom("op-1")).not.toBe(fleetUnitRoom("op-1", "unit-1"));
  });
});
