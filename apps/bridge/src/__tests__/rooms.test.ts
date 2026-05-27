import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { rooms } from "../services/rooms.js";

function fakeSocket(): WebSocket {
  const sent: string[] = [];
  return {
    readyState: 1, // OPEN
    OPEN: 1,
    send: vi.fn((p: string) => sent.push(p)),
    // expose recordings for assertions
    _sent: sent,
  } as unknown as WebSocket;
}

describe("RoomRegistry", () => {
  afterEach(() => {
    // Best-effort cleanup: leave any sockets the previous test left in.
    // (RoomRegistry has no clear(), but join/leave are symmetrical.)
  });

  it("adds participants and snapshots them with speaking=false by default", () => {
    const a = fakeSocket();
    const b = fakeSocket();
    rooms.join("room-1", "111", a);
    rooms.join("room-1", "222", b);
    const snap = rooms.snapshot("room-1");
    expect(snap.map((c) => c.userId).sort()).toEqual(["111", "222"]);
    expect(snap.every((c) => c.speaking === false)).toBe(true);
    rooms.leave(a);
    rooms.leave(b);
  });

  it("returns commanders on leave", () => {
    const a = fakeSocket();
    const b = fakeSocket();
    rooms.join("room-2", "aaa", a);
    rooms.join("room-2", "bbb", b);
    const left = rooms.leave(a);
    expect(left?.roomId).toBe("room-2");
    expect(left?.commanders.map((c) => c.userId)).toEqual(["bbb"]);
    rooms.leave(b);
  });

  it("setSpeaking flips the flag and reflects it in subsequent snapshots", () => {
    const a = fakeSocket();
    rooms.join("room-spk", "spk-user", a);
    const after = rooms.setSpeaking(a, true);
    expect(after?.commanders).toEqual([{ userId: "spk-user", active: true, speaking: true }]);
    const off = rooms.setSpeaking(a, false);
    expect(off?.commanders).toEqual([{ userId: "spk-user", active: true, speaking: false }]);
    rooms.leave(a);
  });

  it("setSpeaking on an unknown socket is a no-op", () => {
    const a = fakeSocket();
    expect(rooms.setSpeaking(a, true)).toBeNull();
  });

  it("broadcasts a message to every open socket in the room", () => {
    const a = fakeSocket();
    const b = fakeSocket();
    rooms.join("room-3", "u1", a);
    rooms.join("room-3", "u2", b);
    rooms.broadcast("room-3", {
      type: "commander:list",
      roomId: "room-3",
      commanders: [],
    });
    expect((a as unknown as { _sent: string[] })._sent.length).toBe(1);
    expect((b as unknown as { _sent: string[] })._sent.length).toBe(1);
    rooms.leave(a);
    rooms.leave(b);
  });

  it("removes the room entirely when the last participant leaves", () => {
    const a = fakeSocket();
    rooms.join("room-4", "u", a);
    rooms.leave(a);
    expect(rooms.snapshot("room-4")).toEqual([]);
  });

  it("leave on an unknown socket is a no-op", () => {
    const a = fakeSocket();
    expect(rooms.leave(a)).toBeNull();
  });
});
