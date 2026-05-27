import type { CommanderInfo } from "./types.js";

export type ClientMessage =
  | {
      type: "ptt:start";
      guildId: string;
      voiceChannelId?: string;
    }
  | {
      type: "ptt:stop";
      guildId: string;
    }
  | {
      type: "heartbeat";
      timestamp: number;
    }
  | {
      type: "device:update";
      inputDeviceId: string;
    }
  | {
      /** Toggle the OUTPUT (receive) mute state. When `muted` is true,
       *  the companion stops playing remote audio locally and broadcasts
       *  that flag through `commander:list` so other commanders see it. */
      type: "status:output-mute";
      muted: boolean;
    }
  | {
      /** Toggle the AFK flag. Manual only — no auto-idle. Broadcast
       *  to peers through `commander:list`. */
      type: "status:afk";
      afk: boolean;
    };

export type ServerMessage =
  | {
      type: "bridge:joined";
      roomId: string;
      /** Discord display name for the guild, when the bot can resolve it.
       *  The companion shows this in the connected status strip instead
       *  of the raw snowflake. Falls back to guildId at render time. */
      guildName?: string;
      activeCommanders: CommanderInfo[];
      /**
       * Optional initial LiveKit credentials. Present iff the user is
       * currently in an allowed voice channel at WS-connect time. When
       * absent, the companion should keep the WebSocket open and wait
       * for an `audio:enable` message — which arrives the moment the
       * user enters an allowed channel (pushed by the bot via
       * /internal/voice-state-changed).
       */
      livekitUrl?: string;
      livekitToken?: string;
    }
  | {
      type: "bridge:left";
      roomId: string;
    }
  | {
      type: "commander:list";
      roomId: string;
      commanders: CommanderInfo[];
    }
  | {
      /**
       * Tells the companion: you have just entered (or are still in) an
       * allowed voice channel — connect to LiveKit with these credentials.
       * Sent both at WS-connect time (if applicable) and any time after,
       * when the bot reports the user moved into an allowed channel.
       * Companion may already have an open LiveKit session; it should
       * tear it down and reconnect with the fresh token.
       */
      type: "audio:enable";
      roomId: string;
      livekitUrl: string;
      livekitToken: string;
    }
  | {
      /**
       * Tells the companion: leave the LiveKit room immediately but keep
       * the WebSocket open. Sent when the bot detects the user moved out
       * of an allowed voice channel (or left voice entirely). The next
       * `audio:enable` will arrive when the user rejoins an allowed
       * channel — so the WS stays around as a quiet control channel.
       */
      type: "audio:disable";
      reason: "not_in_voice" | "outside_allowed_voice_channel";
    }
  | {
      type: "error";
      code: string;
      message: string;
    };

export type ClientMessageType = ClientMessage["type"];
export type ServerMessageType = ServerMessage["type"];
