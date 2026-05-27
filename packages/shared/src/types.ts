export type BridgeMode = "discord_channel" | "external_voice" | "bot_relay";

export type GuildConfig = {
  guildId: string;
  enabled: boolean;
  commanderRoleIds: string[];
  allowedVoiceChannelIds: string[];
  bridgeMode: BridgeMode;
  logChannelId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CommanderSession = {
  sessionId: string;
  guildId: string;
  userId: string;
  voiceChannelId?: string;
  active: boolean;
  muted: boolean;
  startedAt: Date;
  endedAt?: Date;
};

export type BridgeRoomMode = "ptt" | "toggle" | "emergency";

export type BridgeRoom = {
  roomId: string;
  guildId: string;
  activeCommanderUserIds: string[];
  mode: BridgeRoomMode;
  createdAt: Date;
};

export type CommanderInfo = {
  userId: string;
  displayName?: string;
  voiceChannelId?: string;
  active: boolean;
  speaking: boolean;
  /** Commander has muted INCOMING audio on their side — they're
   *  not hearing other commanders right now. Used by the roster UI
   *  so peers can see "this person can't hear me". Default: false. */
  outputMuted?: boolean;
  /** Commander has flagged themselves as Away From Keyboard.
   *  Manual toggle, no auto-idle detection. Default: false. */
  afk?: boolean;
};
