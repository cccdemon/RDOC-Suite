import { afterEach, describe, expect, it, vi } from "vitest";
import { signCoverToken, verifyCoverToken } from "../../services/coverToken.js";

describe("coverToken", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("signs payloads with an exp claim and verifies them with the same secret", () => {
    vi.setSystemTime(new Date("2026-06-08T12:00:00Z"));

    const token = signCoverToken({ coverId: "cover-1", opId: "op-1" }, "secret-a", 60);
    const payload = verifyCoverToken<{ coverId: string; opId: string; exp: number }>(token, "secret-a");

    expect(payload).toMatchObject({
      coverId: "cover-1",
      opId: "op-1",
      exp: 1780920060,
    });
  });

  it("rejects tokens signed with a different secret", () => {
    const token = signCoverToken({ coverId: "cover-1" }, "secret-a", 60);

    expect(verifyCoverToken(token, "secret-b")).toBeNull();
  });

  it("rejects malformed, tampered and expired tokens", () => {
    vi.setSystemTime(new Date("2026-06-08T12:00:00Z"));
    const token = signCoverToken({ coverId: "cover-1" }, "secret-a", 1);

    expect(verifyCoverToken("missing-dot", "secret-a")).toBeNull();
    expect(verifyCoverToken(`${token}x`, "secret-a")).toBeNull();

    vi.setSystemTime(new Date("2026-06-08T12:00:02Z"));
    expect(verifyCoverToken(token, "secret-a")).toBeNull();
  });
});
