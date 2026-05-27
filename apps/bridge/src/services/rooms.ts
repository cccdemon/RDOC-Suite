import type { WebSocket } from "ws";
import type { CommanderInfo, ServerMessage } from "@dccc/shared";

type Participant = {
  userId: string;
  displayName?: string;
  socket: WebSocket;
  speaking: boolean;
  /** User has muted INCOMING audio locally (Etappe 2). Broadcast in
   *  commander:list so peers see "this person can't hear me". */
  outputMuted: boolean;
  /** User manually flagged Away From Keyboard (Etappe 2). No auto-idle. */
  afk: boolean;
};

/**
 * Tracks which commanders are currently active in which bridge room.
 * In-memory only — the source of truth is the live WS connections; if
 * the bridge process restarts every commander reconnects from scratch.
 *
 * Lifecycle: join on WS-connect (sticky), leave on WS-close.
 * PTT just flips the participant's `speaking` flag — the LiveKit room
 * stays joined for the whole WS session so audio handshake cost is paid
 * once, not on every key tap.
 */
class RoomRegistry {
  private rooms = new Map<string, Set<Participant>>();
  private socketRoom = new WeakMap<WebSocket, { roomId: string; participant: Participant }>();

  join(
    roomId: string,
    userId: string,
    socket: WebSocket,
    opts: { displayName?: string } = {},
  ): CommanderInfo[] {
    const existing = this.socketRoom.get(socket);
    if (existing && existing.roomId !== roomId) {
      this.leave(socket);
    }
    let set = this.rooms.get(roomId);
    if (!set) {
      set = new Set();
      this.rooms.set(roomId, set);
    }
    // Enforce one-user-per-room: if the same userId already has any
    // socket(s) in this room (stale dev-mode reconnect, second
    // companion window, restored session from a previous run), close
    // them first so the new connection wins. Without this, the squad
    // roster ends up duplicating the same user N times.
    const stale = Array.from(set).filter((p) => p.userId === userId);
    for (const p of stale) {
      set.delete(p);
      this.socketRoom.delete(p.socket);
      try {
        p.socket.close(4409, "superseded_by_new_connection");
      } catch {
        // already-closed sockets throw; we don't care
      }
    }
    const participant: Participant = {
      userId,
      displayName: opts.displayName,
      socket,
      speaking: false,
      outputMuted: false,
      afk: false,
    };
    set.add(participant);
    this.socketRoom.set(socket, { roomId, participant });
    return this.snapshot(roomId);
  }

  leave(socket: WebSocket): { roomId: string; commanders: CommanderInfo[] } | null {
    const entry = this.socketRoom.get(socket);
    if (!entry) return null;
    this.socketRoom.delete(socket);
    const set = this.rooms.get(entry.roomId);
    // Set may have been reset (test cleanup, manual purge) while this
    // socket's close was still pending. Treat that as "already gone" —
    // returning null prevents a stale snapshot broadcast.
    if (!set || !set.delete(entry.participant)) return null;
    if (set.size === 0) {
      this.rooms.delete(entry.roomId);
    }
    return { roomId: entry.roomId, commanders: this.snapshot(entry.roomId) };
  }

  setSpeaking(
    socket: WebSocket,
    speaking: boolean,
  ): { roomId: string; commanders: CommanderInfo[] } | null {
    const entry = this.socketRoom.get(socket);
    if (!entry) return null;
    if (entry.participant.speaking === speaking) {
      return { roomId: entry.roomId, commanders: this.snapshot(entry.roomId) };
    }
    entry.participant.speaking = speaking;
    return { roomId: entry.roomId, commanders: this.snapshot(entry.roomId) };
  }

  setOutputMuted(
    socket: WebSocket,
    muted: boolean,
  ): { roomId: string; commanders: CommanderInfo[] } | null {
    const entry = this.socketRoom.get(socket);
    if (!entry) return null;
    if (entry.participant.outputMuted === muted) {
      return { roomId: entry.roomId, commanders: this.snapshot(entry.roomId) };
    }
    entry.participant.outputMuted = muted;
    return { roomId: entry.roomId, commanders: this.snapshot(entry.roomId) };
  }

  setAfk(
    socket: WebSocket,
    afk: boolean,
  ): { roomId: string; commanders: CommanderInfo[] } | null {
    const entry = this.socketRoom.get(socket);
    if (!entry) return null;
    if (entry.participant.afk === afk) {
      return { roomId: entry.roomId, commanders: this.snapshot(entry.roomId) };
    }
    entry.participant.afk = afk;
    return { roomId: entry.roomId, commanders: this.snapshot(entry.roomId) };
  }

  /**
   * Look up a participant by (roomId, userId). Used by the
   * /internal/voice-state-changed endpoint to push audio:enable /
   * audio:disable messages to a specific commander's socket without
   * iterating all rooms.
   *
   * A user can in principle have multiple sockets to the same room
   * (multiple companion windows / stale reconnects). Returns all matches
   * so the caller can broadcast to each.
   */
  findByUserInRoom(roomId: string, userId: string): WebSocket[] {
    const set = this.rooms.get(roomId);
    if (!set) return [];
    const out: WebSocket[] = [];
    for (const p of set) {
      if (p.userId === userId) out.push(p.socket);
    }
    return out;
  }

  /**
   * Returns every WebSocket currently joined to the given room. Used
   * by the Admiral "End session" flow: when a session is ended, every
   * Commander still connected to that session's room is kicked.
   */
  findAllInRoom(roomId: string): WebSocket[] {
    const set = this.rooms.get(roomId);
    if (!set) return [];
    return Array.from(set, (p) => p.socket);
  }

  snapshot(roomId: string): CommanderInfo[] {
    const set = this.rooms.get(roomId);
    if (!set) return [];
    return Array.from(set).map((p) => ({
      userId: p.userId,
      ...(p.displayName ? { displayName: p.displayName } : {}),
      active: true,
      speaking: p.speaking,
      // Only spread the new flags when truthy so the wire payload stays
      // compact and clients that pre-date these fields still parse cleanly.
      ...(p.outputMuted ? { outputMuted: true } : {}),
      ...(p.afk ? { afk: true } : {}),
    }));
  }

  broadcast(roomId: string, message: ServerMessage, exceptSocket?: WebSocket): void {
    const set = this.rooms.get(roomId);
    if (!set) return;
    const payload = JSON.stringify(message);
    for (const p of set) {
      if (p.socket === exceptSocket) continue;
      if (p.socket.readyState === p.socket.OPEN) {
        p.socket.send(payload);
      }
    }
  }

  /** Test-only: wipe all rooms. Production code never needs this. */
  _clear(): void {
    this.rooms.clear();
  }
}

export const rooms = new RoomRegistry();
