import type { ClientMessage, ServerMessage } from "@rdoc-suite/shared";
import { buildConfig } from "./config";

export type WsStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

type Listener = {
  message?: (msg: ServerMessage) => void;
  status?: (status: WsStatus, detail?: string) => void;
};

const HEARTBEAT_INTERVAL_MS = 20_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export class BridgeWs {
  private socket: WebSocket | null = null;
  private listeners: Listener = {};
  private token: string | null = null;
  private guildId: string | null = null;
  private sessionId: string | null = null;
  private bridgeUrl = "";
  private status: WsStatus = "idle";
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private explicitlyClosed = false;
  private lastHeartbeatTimestamp: number | null = null;
  /** Most recent measured RTT in milliseconds. Null until first pong received. */
  rtt: number | null = null;

  setListeners(listeners: Listener): void {
    this.listeners = listeners;
  }

  setBridgeUrl(url: string): void {
    this.bridgeUrl = url;
  }

  /** Connect (or reconnect) to a guild room. The session token is now
   *  guild-agnostic — the active guildId is supplied per-connect so
   *  the user can switch servers without re-doing OAuth.
   *
   *  Idempotent across guild switches: tears down any existing socket
   *  with its handlers nulled out first, so the stale connection
   *  doesn't trigger reconnect / supersede notifications on the
   *  user-facing state when the bridge eventually closes it. */
  connect(token: string, guildId: string): void {
    this.token = token;
    this.guildId = guildId;
    this.sessionId = null;
    this.teardownSocket("switching_guild");
    this.reconnectAttempts = 0;
    this.explicitlyClosed = false;
    this.openSocket();
  }

  /** Connect to a session room using an OAuth token (same token as guild path).
   *  The bridge verifies the user consumed a SessionInvite for this sessionId. */
  connectSession(token: string, sessionId: string): void {
    this.token = token;
    this.sessionId = sessionId;
    this.guildId = null;
    this.teardownSocket("switching_session");
    this.reconnectAttempts = 0;
    this.explicitlyClosed = false;
    this.openSocket();
  }

  disconnect(): void {
    this.explicitlyClosed = true;
    this.clearHeartbeat();
    this.teardownSocket("client_disconnect");
    this.setStatus("closed");
  }

  private teardownSocket(reason: string): void {
    if (this.socket) {
      const old = this.socket;
      old.onopen = null;
      old.onmessage = null;
      old.onerror = null;
      old.onclose = null;
      try {
        old.close(1000, reason);
      } catch {
        // already closing — fine
      }
      this.socket = null;
    }
    this.clearHeartbeat();
  }

  send(msg: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  private openSocket(): void {
    if (!this.token || !this.bridgeUrl) return;
    if (!this.guildId && !this.sessionId) return;

    const { bridgeWsUrl } = buildConfig(this.bridgeUrl);
    const roomParam = this.sessionId
      ? `&sessionId=${encodeURIComponent(this.sessionId)}`
      : `&guildId=${encodeURIComponent(this.guildId!)}`;
    const url = `${bridgeWsUrl}/ws?token=${encodeURIComponent(this.token)}${roomParam}`;
    this.setStatus(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      this.startHeartbeat();
    };

    socket.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as ServerMessage;
        if (parsed.type === "pong" && this.lastHeartbeatTimestamp !== null) {
          this.rtt = Date.now() - this.lastHeartbeatTimestamp;
        }
        this.listeners.message?.(parsed);
      } catch {
        // ignore malformed messages
      }
    };

    socket.onerror = () => {
      // onclose will follow
    };

    socket.onclose = (ev) => {
      this.clearHeartbeat();
      this.socket = null;
      if (this.explicitlyClosed) {
        this.setStatus("closed");
        return;
      }
      // Code 4401 = unauthenticated; do not reconnect blindly.
      if (ev.code === 4401) {
        this.setStatus("closed", "unauthenticated");
        return;
      }
      // Code 4403 = forbidden (session ended, not a member); do not reconnect.
      if (ev.code === 4403) {
        this.setStatus("closed", "forbidden");
        return;
      }
      // Code 4409 = the bridge kicked this socket because another
      // socket for the same userId joined the same room. That other
      // instance is now the active one — do NOT reconnect, or the
      // two instances will kick each other back and forth several
      // times per second.
      if (ev.code === 4409) {
        this.setStatus("closed", "superseded");
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1), RECONNECT_MAX_MS);
    this.setStatus("reconnecting", `attempt ${this.reconnectAttempts} in ${delay}ms`);
    setTimeout(() => {
      if (!this.explicitlyClosed) this.openSocket();
    }, delay);
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeat = setInterval(() => {
      const ts = Date.now();
      this.lastHeartbeatTimestamp = ts;
      this.send({ type: "heartbeat", timestamp: ts });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private setStatus(status: WsStatus, detail?: string): void {
    if (this.status !== status) {
      this.status = status;
      this.listeners.status?.(status, detail);
    }
  }
}
