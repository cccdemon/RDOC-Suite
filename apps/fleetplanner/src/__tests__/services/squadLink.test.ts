import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";

// The room-auth secret has to be byte-for-byte identical to the SquadLink
// init-server's ROOM_AUTH_SECRET, so this test pins the exact HMAC construction.
process.env.SQUADLINK_ROOM_AUTH_SECRET = "unit-test-room-auth-secret";
process.env.SQUADLINK_WS_URL = "wss://squadlink.test/ws";
process.env.SQUADLINK_STORE_URL = "https://store.test/squadlink";

const { buildCommandNetLink, commandRoom, squadLinkConfigured, squadLinkStoreUrl } = await import(
  "../../services/squadLink.js"
);

describe("commandRoom", () => {
  it("derives one room per operation", () => {
    expect(commandRoom("op1")).toBe("op-op1-command");
    expect(commandRoom("op2")).not.toBe(commandRoom("op1"));
  });

  it("stays inside the init-server's room charset and length limit", () => {
    const room = commandRoom("clz9k2h4t0000abcd1234efgh");
    expect(room).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(room.length).toBeLessThanOrEqual(64);
  });
});

describe("buildCommandNetLink", () => {
  it("mints HMAC-SHA256(secret, room) as lowercase hex", () => {
    const link = buildCommandNetLink("op1", "Commander", "user-1")!;
    const url = new URL(link);
    const expected = createHmac("sha256", "unit-test-room-auth-secret").update("op-op1-command").digest("hex");
    // If this ever changes, every SquadLink client stops connecting.
    expect(url.searchParams.get("token")).toBe(expected);
    expect(url.searchParams.get("token")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("carries the signaling URL, room, name and uid", () => {
    const url = new URL(buildCommandNetLink("op1", "Commander Vex", "user-1")!);
    expect(url.protocol).toBe("squadlink:");
    expect(url.searchParams.get("ws")).toBe("wss://squadlink.test/ws");
    expect(url.searchParams.get("room")).toBe("op-op1-command");
    expect(url.searchParams.get("name")).toBe("Commander Vex");
    expect(url.searchParams.get("uid")).toBe("user-1");
  });

  it("percent-encodes names that would otherwise break the query string", () => {
    const link = buildCommandNetLink("op1", "A&B=C #1", "u 1")!;
    expect(link).not.toContain("A&B=C");
    expect(new URL(link).searchParams.get("name")).toBe("A&B=C #1");
  });

  it("gives different operations different tokens", () => {
    const a = new URL(buildCommandNetLink("op1", "n", "u")!).searchParams.get("token");
    const b = new URL(buildCommandNetLink("op2", "n", "u")!).searchParams.get("token");
    expect(a).not.toBe(b);
  });

  it("omits empty name/uid rather than sending blanks", () => {
    const url = new URL(buildCommandNetLink("op1", "", "")!);
    expect(url.searchParams.has("name")).toBe(false);
    expect(url.searchParams.has("uid")).toBe(false);
  });
});

describe("configuration gates", () => {
  it("reports the feature configured when a secret is set", () => {
    expect(squadLinkConfigured()).toBe(true);
  });

  it("exposes the store link when a listing exists", () => {
    expect(squadLinkStoreUrl()).toBe("https://store.test/squadlink");
  });
});
