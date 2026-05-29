import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { parseClientMessage } from "@dccc/shared";
import type { ServerMessage } from "@dccc/shared";
import { getEnv, getOAuthEnv } from "../config/env.js";
import { verifySessionToken } from "../auth/sessionToken.js";
import { logger } from "../services/logger.js";
import { bridgeRoomName, issueSessionLivekitToken, issueLivekitToken, sessionRoomName } from "../services/livekit.js";
import { rooms } from "../services/rooms.js";
import { checkAllowedVoiceChannel, recheckCommanderRole } from "../services/permissions.js";
import { readGuildConfig } from "../services/guildConfig.js";
import { fetchGuildMember } from "../auth/discord.js";
import { getGuildInfo } from "../services/guildInfo.js";
import { getPrisma } from "@dccc/db";

const HEARTBEAT_INTERVAL_MS = 20_000;
// Role-check stays at 60s. Voice-channel-change is delivered in real
// time by the bot via /internal/voice-state-changed; this loop only
// catches Discord-side role losses (the bot doesn't push those, and we
// don't want to spam Discord's REST API).
const PERMISSION_RECHECK_MS = 60_000;

const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_PROTOCOL_VIOLATION = 4400;
const CLOSE_FORBIDDEN = 4403;

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export async function pushAudioEnable(
  socket: WebSocket,
  opts: { userId: string; guildId: string; roomId: string },
): Promise<void> {
  let livekitToken: string;
  try {
    livekitToken = await issueLivekitToken({ userId: opts.userId, guildId: opts.guildId });
  } catch (err) {
    logger.error({ err, userId: opts.userId }, "audio:enable: livekit token mint failed");
    send(socket, {
      type: "error",
      code: "livekit_token_failed",
      message: "could not issue LiveKit token",
    });
    return;
  }
  send(socket, {
    type: "audio:enable",
    roomId: opts.roomId,
    livekitUrl: getEnv().LIVEKIT_URL,
    livekitToken,
  });
}

export function pushAudioDisable(
  socket: WebSocket,
  reason: "not_in_voice" | "outside_allowed_voice_channel",
): void {
  send(socket, { type: "audio:disable", reason });
}

/**
 * Shared lifecycle wiring: heartbeat + message dispatch + close handler.
 * Each auth-path handler authenticates, joins the room, sends the
 * initial bridge:joined, then calls this to set up the per-socket
 * recurring + per-message machinery.
 */
function attachLifecycle(
  socket: WebSocket,
  opts: {
    userId: string;
    roomId: string;
    pttGuildIdGate: string | null; // expected ptt:start.guildId; null = skip check (admiral)
    recheck?: () => Promise<void>; // optional 60s safety-net loop
  },
): void {
  const { userId, roomId, pttGuildIdGate, recheck } = opts;
  let alive = true;
  socket.on("pong", () => {
    alive = true;
  });
  const heartbeat = setInterval(() => {
    if (!alive) {
      logger.warn({ userId }, "ws heartbeat timeout, terminating");
      socket.terminate();
      return;
    }
    alive = false;
    try {
      socket.ping();
    } catch {
      socket.terminate();
    }
  }, HEARTBEAT_INTERVAL_MS);

  const recheckTimer = recheck
    ? setInterval(() => {
        recheck().catch((err) => logger.error({ err, userId }, "recheck threw"));
      }, PERMISSION_RECHECK_MS)
    : null;
  recheckTimer?.unref?.();

  socket.on("message", (raw) => {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString());
    } catch {
      send(socket, {
        type: "error",
        code: "invalid_json",
        message: "message was not valid JSON",
      });
      socket.close(CLOSE_PROTOCOL_VIOLATION, "invalid_json");
      return;
    }
    const parsed = parseClientMessage(json);
    if (!parsed.ok) {
      send(socket, {
        type: "error",
        code: "invalid_message",
        message: parsed.error,
      });
      socket.close(CLOSE_PROTOCOL_VIOLATION, "invalid_message");
      return;
    }
    const msg = parsed.value;
    switch (msg.type) {
      case "ptt:start": {
        if (pttGuildIdGate !== null && msg.guildId !== pttGuildIdGate) {
          send(socket, {
            type: "error",
            code: "guild_mismatch",
            message: "ptt guildId does not match session",
          });
          return;
        }
        const updated = rooms.setSpeaking(socket, true);
        if (updated) {
          rooms.broadcast(updated.roomId, {
            type: "commander:list",
            roomId: updated.roomId,
            commanders: updated.commanders,
          });
        }
        break;
      }
      case "ptt:stop": {
        const updated = rooms.setSpeaking(socket, false);
        if (updated) {
          rooms.broadcast(updated.roomId, {
            type: "commander:list",
            roomId: updated.roomId,
            commanders: updated.commanders,
          });
        }
        break;
      }
      case "heartbeat":
        // ws-level ping/pong is the real liveness signal; also reply with
        // an application-level pong so the companion can measure RTT.
        send(socket, { type: "pong", timestamp: msg.timestamp, serverTime: Date.now() });
        break;
      case "device:update":
        logger.info({ userId, inputDeviceId: msg.inputDeviceId }, "device update");
        break;
      case "status:output-mute": {
        const updated = rooms.setOutputMuted(socket, msg.muted);
        if (updated) {
          rooms.broadcast(updated.roomId, {
            type: "commander:list",
            roomId: updated.roomId,
            commanders: updated.commanders,
          });
        }
        break;
      }
      case "status:afk": {
        const updated = rooms.setAfk(socket, msg.afk);
        if (updated) {
          rooms.broadcast(updated.roomId, {
            type: "commander:list",
            roomId: updated.roomId,
            commanders: updated.commanders,
          });
        }
        break;
      }
    }
  });

  socket.on("close", (code) => {
    clearInterval(heartbeat);
    if (recheckTimer) clearInterval(recheckTimer);
    const left = rooms.leave(socket);
    if (left) {
      rooms.broadcast(left.roomId, {
        type: "commander:list",
        roomId: left.roomId,
        commanders: left.commanders,
      });
    }
    logger.info({ userId, code, roomId }, "ws client disconnected");
  });
}

/**
 * Legacy OAuth-JWT path: per-guild room, voice-channel enforcement,
 * 60s role recheck. Kept alive during Phase B as the old companion
 * still uses this path; will be retired in Phase B3.
 */
async function handleOAuthCommander(
  socket: WebSocket,
  token: string,
  urlGuildId: string | null,
): Promise<void> {
  const verified = await verifySessionToken(getEnv().SESSION_SECRET, token);
  if (!verified.ok) {
    send(socket, {
      type: "error",
      code: verified.reason,
      message: `session token ${verified.reason}`,
    });
    socket.close(CLOSE_UNAUTHENTICATED, verified.reason);
    return;
  }
  const { sub: userId } = verified.payload;
  // Pick guildId off the URL first (the user-selectable, per-connect
  // value). Fall back to a legacy claim inside the token only for
  // backward compat with sessions minted before tokens were decoupled
  // from guildId.
  const guildId = urlGuildId ?? verified.payload.guildId ?? null;
  if (!guildId) {
    send(socket, {
      type: "error",
      code: "no_guild",
      message: "guildId query parameter is required",
    });
    socket.close(CLOSE_PROTOCOL_VIOLATION, "no_guild");
    return;
  }
  logger.info({ userId, guildId, authPath: "oauth" }, "ws client connected");

  // Resolve the Discord display name + guild name once per WS-connect
  // so the companion shows "HEADWiG" + "HEADWiG's Knobelbude" instead
  // of raw snowflakes. Both best-effort — failures fall back to the
  // raw IDs at render time on the client. Done in parallel.
  const [displayName, guildInfo] = await Promise.all([
    resolveDisplayName(guildId, userId),
    getGuildInfo(guildId),
  ]);
  const roomId = bridgeRoomName(guildId);
  const activeCommanders = rooms.join(roomId, userId, socket, { displayName });

  // Voice-channel check determines whether to ship LiveKit creds now
  // or wait for an audio:enable push.
  const guildConfig = await readGuildConfig(guildId);
  const allowedVoiceChannelIds = guildConfig?.allowedVoiceChannelIds ?? [];
  const voiceVerdict = await checkAllowedVoiceChannel({
    userId,
    guildId,
    allowedIds: allowedVoiceChannelIds,
  });

  let initialLivekit: { livekitUrl: string; livekitToken: string } | null = null;
  if (voiceVerdict.ok) {
    try {
      const livekitToken = await issueLivekitToken({ userId, guildId });
      initialLivekit = { livekitUrl: getEnv().LIVEKIT_URL, livekitToken };
    } catch (err) {
      logger.error({ err }, "failed to issue LiveKit token on connect");
    }
  }

  send(socket, {
    type: "bridge:joined",
    roomId,
    roomMode: "guild",
    ...(guildInfo?.name ? { guildName: guildInfo.name } : {}),
    activeCommanders,
    ...(initialLivekit ?? {}),
  });
  // When the user isn't currently in an allowed voice channel, also
  // push an audio:disable so the companion knows WHY audio is silent
  // and can show the "Audio pausiert" banner immediately, not only
  // after the next voice-channel change. Without this, a user who
  // signs in while sitting in a non-allowed channel sees the
  // connected pane with audio "IDLE" and no explanation.
  if (!voiceVerdict.ok) {
    pushAudioDisable(socket, voiceVerdict.reason);
  }
  rooms.broadcast(
    roomId,
    { type: "commander:list", roomId, commanders: activeCommanders },
    socket,
  );

  attachLifecycle(socket, {
    userId,
    roomId,
    pttGuildIdGate: guildId,
    recheck: async () => {
      const verdict = await recheckCommanderRole({ userId, guildId });
      if (verdict.ok) return;
      logger.info(
        { userId, guildId, reason: verdict.reason },
        "role recheck failed, kicking client",
      );
      send(socket, {
        type: "error",
        code: verdict.reason,
        message: "you no longer have permission for this bridge",
      });
      const leftRoom = rooms.leave(socket);
      if (leftRoom) {
        send(socket, { type: "bridge:left", roomId: leftRoom.roomId });
        rooms.broadcast(leftRoom.roomId, {
          type: "commander:list",
          roomId: leftRoom.roomId,
          commanders: leftRoom.commanders,
        });
      }
      socket.close(CLOSE_FORBIDDEN, verdict.reason);
    },
  });
}

/**
 * Discord display-name lookup for the squad roster. Hits
 * `GET /guilds/{gid}/members/{uid}` once per WS-connect with the bot
 * token; ~50ms typical. Returns undefined on any failure so callers
 * can fall back to userId — the squad roster never breaks because we
 * couldn't resolve a name.
 */
async function resolveDisplayName(guildId: string, userId: string): Promise<string | undefined> {
  const oauth = getOAuthEnv();
  if (!oauth) return undefined;
  try {
    const res = await fetchGuildMember({
      botToken: oauth.DISCORD_BOT_TOKEN,
      guildId,
      userId,
    });
    if (!res.ok || !res.value.present) return undefined;
    const m = res.value.member;
    return m.nick || m.user?.global_name || m.user?.username || undefined;
  } catch {
    return undefined;
  }
}

async function handleSessionCommander(
  socket: WebSocket,
  token: string,
  sessionId: string,
): Promise<void> {
  const verified = await verifySessionToken(getEnv().SESSION_SECRET, token);
  if (!verified.ok) {
    send(socket, {
      type: "error",
      code: verified.reason,
      message: `session token ${verified.reason}`,
    });
    socket.close(CLOSE_UNAUTHENTICATED, verified.reason);
    return;
  }
  const { sub: userId } = verified.payload;

  const db = getPrisma();
  const invite = await db.sessionInvite.findFirst({
    where: { sessionId, usedBy: userId },
  });
  if (!invite) {
    send(socket, {
      type: "error",
      code: "not_a_session_member",
      message: "no consumed invite found for this session",
    });
    socket.close(CLOSE_FORBIDDEN, "not_a_session_member");
    return;
  }

  const session = await db.session.findUnique({ where: { id: sessionId } });
  if (!session || session.status !== "active") {
    send(socket, {
      type: "error",
      code: "session_ended",
      message: "this session has ended or does not exist",
    });
    socket.close(CLOSE_FORBIDDEN, "session_ended");
    return;
  }

  logger.info({ userId, sessionId, authPath: "session" }, "ws client connected");

  const roomId = sessionRoomName(sessionId);
  const activeCommanders = rooms.join(roomId, userId, socket, {});

  let livekitToken: string | undefined;
  try {
    livekitToken = await issueSessionLivekitToken({ userId, livekitRoom: session.livekitRoom });
  } catch (err) {
    logger.error({ err, userId, sessionId }, "session: failed to issue LiveKit token");
  }

  send(socket, {
    type: "bridge:joined",
    roomId,
    roomMode: "session",
    sessionId,
    activeCommanders,
    livekitUrl: livekitToken ? getEnv().LIVEKIT_URL : undefined,
    livekitToken,
  });
  rooms.broadcast(
    roomId,
    { type: "commander:list", roomId, commanders: activeCommanders },
    socket,
  );

  attachLifecycle(socket, {
    userId,
    roomId,
    pttGuildIdGate: null,
    recheck: async () => {
      const current = await db.session.findUnique({ where: { id: sessionId } });
      if (current && current.status === "active") return;
      logger.info({ userId, sessionId }, "session ended, kicking WS client");
      send(socket, {
        type: "error",
        code: "session_ended",
        message: "this session has ended",
      });
      const leftRoom = rooms.leave(socket);
      if (leftRoom) {
        send(socket, { type: "bridge:left", roomId: leftRoom.roomId });
        rooms.broadcast(leftRoom.roomId, {
          type: "commander:list",
          roomId: leftRoom.roomId,
          commanders: leftRoom.commanders,
        });
      }
      socket.close(CLOSE_FORBIDDEN, "session_ended");
    },
  });
}

export async function registerWsRoute(app: FastifyInstance): Promise<void> {
  app.get("/ws", { websocket: true }, async (socket, request) => {
    const url = new URL(request.url, "http://localhost");
    const token = url.searchParams.get("token");
    const guildId = url.searchParams.get("guildId");
    const sessionId = url.searchParams.get("sessionId");

    if (!token) {
      send(socket, {
        type: "error",
        code: "no_token",
        message: "missing token query parameter",
      });
      socket.close(CLOSE_UNAUTHENTICATED, "no_token");
      return;
    }
    if (sessionId) {
      await handleSessionCommander(socket, token, sessionId);
    } else {
      await handleOAuthCommander(socket, token, guildId);
    }
  });
}
