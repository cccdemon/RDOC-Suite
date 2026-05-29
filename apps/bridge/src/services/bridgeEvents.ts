import { EventEmitter } from "node:events";

const DEBOUNCE_MS = 100;

const emitter = new EventEmitter();
const pendingDebounce = new Map<string, NodeJS.Timeout>();

/**
 * Process-local event bus for guild-state changes. The SSE endpoint
 * (`/admin/api/live-stream`) subscribes via `onGuildStateChanged`; any
 * mutation that should make the admin UI re-paint calls
 * `emitGuildStateChanged(guildId)`.
 *
 * Debounce window is 100 ms per guild: callers that fan out multiple
 * mutations (drag-multi-move) collapse into one SSE frame rather than
 * triggering N sequential re-loads of the dashboard data.
 */
export const bridgeEvents = {
  emitGuildStateChanged(guildId: string): void {
    const existing = pendingDebounce.get(guildId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      pendingDebounce.delete(guildId);
      emitter.emit("guild-state-changed", guildId);
    }, DEBOUNCE_MS);
    pendingDebounce.set(guildId, t);
  },

  onGuildStateChanged(listener: (guildId: string) => void): () => void {
    emitter.on("guild-state-changed", listener);
    return () => {
      emitter.off("guild-state-changed", listener);
    };
  },
};
