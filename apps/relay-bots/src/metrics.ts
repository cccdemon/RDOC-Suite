export interface BotMetrics {
  name: string;
  channelId: string;
  voiceConnected: boolean;
  /** True when humans are in the bot's target channel, so the bot is EXPECTED to
   *  be voice-connected. When false the bot is idle-by-design (waiting outside an
   *  empty channel) — NOT a fault, and the watchdog must not restart for it. */
  expectedConnected: boolean;
  speaking: boolean;
  playerState: string;
  bufferBytes: number;
  bufferOverflows: number;       // lifetime total
  recentOverflows: number;       // since last watchdog tick (drained by watchdog)
  reconnectCount: number;
}

export interface ProcessMetrics {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  cpuUserMs: number;
  cpuSystemMs: number;
}

export interface RelayMetrics {
  uptimeMs: number;
  framesReceived: number;
  bytesReceived: number;
  lastAudioAt: number | null;
  watchdogRestarts: number;
  process: ProcessMetrics;
  bots: BotMetrics[];
}
