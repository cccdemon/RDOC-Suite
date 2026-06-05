import { Client, Events, GatewayIntentBits, type VoiceBasedChannel } from "discord.js";
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  entersState,
  type VoiceConnection,
  type AudioPlayer,
} from "@discordjs/voice";
import { PassThrough } from "node:stream";
import type { BotConfig } from "../config.js";
import type { BotMetrics } from "../metrics.js";

const SILENCE_TIMEOUT_MS = 300;
const RECONNECT_DELAY_MS = 5000;
const JOIN_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 30_000;
const PRESENCE_DEBOUNCE_MS = 500;

// Realtime mixer. One 20 ms stereo s16le @48 kHz output frame = 3840 B. The
// mixer emits exactly one frame per FRAME_MS, so input rate == playback rate
// and the PassThrough can't run away (the old overflow cause). Multiple
// simultaneous speakers are summed per sample instead of concatenated.
const FRAME_MS = 20;
const FRAME_BYTES = (48_000 * 2 * 2 * FRAME_MS) / 1000;
// Per-speaker jitter buffer cap (~200 ms). Beyond it we drop the OLDEST audio
// so latency stays bounded instead of one stream growing without limit.
const MAX_SPEAKER_BUFFER_BYTES = FRAME_BYTES * 10;

/** Sum a set of equal-length 20 ms frames sample-by-sample (clamped int16). */
function mixFrames(frames: Buffer[]): Buffer {
  const out = Buffer.allocUnsafe(FRAME_BYTES);
  const samples = FRAME_BYTES / 2;
  for (let i = 0; i < samples; i++) {
    const off = i * 2;
    let sum = 0;
    for (const f of frames) sum += f.readInt16LE(off);
    if (sum > 32767) sum = 32767;
    else if (sum < -32768) sum = -32768;
    out.writeInt16LE(sum, off);
  }
  return out;
}

export class RelayBot {
  private client: Client;
  private connection: VoiceConnection | null = null;
  private player: AudioPlayer;
  private targetChannel: VoiceBasedChannel | null = null;
  private passThrough: PassThrough | null = null;
  /** Fixed 20 ms output clock that mixes the per-speaker buffers. */
  private mixTimer: ReturnType<typeof setInterval> | null = null;
  /** Per-speaker jitter buffers keyed by speaker userId ("" = unknown). */
  private speakers = new Map<string, { buf: Buffer; lastAt: number }>();
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private reconnecting = false;
  // Humans in the target channel at the last presence check → bot is EXPECTED
  // to be voice-connected. Drives the watchdog's fault detection so an idle bot
  // (waiting outside an empty channel) is never mistaken for a crash.
  private humansPresent = false;

  private bufferOverflows = 0;
  private recentOverflows = 0;   // drained by the watchdog each tick
  private reconnectCount = 0;

  constructor(private readonly cfg: BotConfig) {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });

    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    this.player.on("error", (err) => {
      console.error(`[${cfg.name}] player error:`, err.message);
    });
  }

  async start(guildId: string): Promise<void> {
    console.log(`[${this.cfg.name}] logging in`);
    await this.client.login(this.cfg.token);
    await this.waitUntilReady();
    console.log(`[${this.cfg.name}] logged in as ${this.client.user?.tag ?? "unknown"}`);

    await this.fetchTargetChannel(guildId);
    this.client.on("voiceStateUpdate", (oldState, newState) => {
      if (oldState.channelId === this.cfg.channelId || newState.channelId === this.cfg.channelId) {
        this.schedulePresenceCheck(guildId);
      }
    });
    await this.syncVoicePresence(guildId);
  }

  private async waitUntilReady(): Promise<void> {
    if (this.client.isReady()) return;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.client.off(Events.ClientReady, onReady);
        reject(new Error(`Discord client did not become ready within ${LOGIN_TIMEOUT_MS} ms`));
      }, LOGIN_TIMEOUT_MS);

      const onReady = () => {
        clearTimeout(timer);
        resolve();
      };

      this.client.once(Events.ClientReady, onReady);
    });
  }

  private async fetchTargetChannel(guildId: string): Promise<VoiceBasedChannel | null> {
    if (this.targetChannel) return this.targetChannel;

    console.log(`[${this.cfg.name}] fetching guild ${guildId}`);
    const guild = await this.client.guilds.fetch(guildId);
    await this.syncNickname(guild);
    console.log(`[${this.cfg.name}] fetching channel ${this.cfg.channelId}`);
    const channel = await guild.channels.fetch(this.cfg.channelId);

    if (!channel?.isVoiceBased()) {
      console.error(`[${this.cfg.name}] channel ${this.cfg.channelId} is not a voice channel`);
      return null;
    }

    this.targetChannel = channel as VoiceBasedChannel;
    return this.targetChannel;
  }

  private async syncNickname(guild: VoiceBasedChannel["guild"]): Promise<void> {
    try {
      const member = await guild.members.fetchMe();
      if (member.nickname === this.cfg.name) return;
      await member.setNickname(this.cfg.name, "RDOC voice relay display name");
      console.log(`[${this.cfg.name}] set server nickname`);
    } catch (err) {
      console.warn(`[${this.cfg.name}] could not set server nickname:`, err);
    }
  }

  private schedulePresenceCheck(guildId: string): void {
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      void this.syncVoicePresence(guildId);
    }, PRESENCE_DEBOUNCE_MS);
  }

  private async syncVoicePresence(guildId: string): Promise<void> {
    if (this.destroyed) return;
    const channel = await this.fetchTargetChannel(guildId);
    if (!channel) return;

    const hasHumans = channel.members.some((member) => !member.user.bot);
    this.humansPresent = hasHumans;
    if (hasHumans) {
      await this.joinChannel(guildId);
      return;
    }

    if (this.connection) {
      console.log(`[${this.cfg.name}] leaving #${channel.name} because no humans are present`);
      this.disconnectVoice();
    } else {
      console.log(`[${this.cfg.name}] waiting outside #${channel.name}; no humans present`);
    }
  }

  private async joinChannel(guildId: string): Promise<void> {
    if (this.destroyed) return;
    if (this.connection) return;
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.reconnectCount++;

    try {
      const channel = await this.fetchTargetChannel(guildId);
      if (!channel) {
        this.reconnecting = false;
        return;
      }

      this.connection = joinVoiceChannel({
        channelId: this.cfg.channelId,
        guildId,
        adapterCreator: channel.guild.voiceAdapterCreator,
        group: this.client.user?.id ?? this.cfg.name,
        selfDeaf: false,
        selfMute: false,
      });

      await entersState(this.connection, VoiceConnectionStatus.Ready, JOIN_TIMEOUT_MS);
      this.connection.subscribe(this.player);

      this.connection.on(VoiceConnectionStatus.Disconnected, () => {
        if (this.destroyed) return;
        console.warn(`[${this.cfg.name}] voice disconnected - checking whether reconnect is needed`);
        this.connection = null;
        this.reconnecting = false;
        setTimeout(() => void this.syncVoicePresence(guildId), RECONNECT_DELAY_MS);
      });

      console.log(`[${this.cfg.name}] joined #${channel.name}`);
    } catch (err) {
      console.error(`[${this.cfg.name}] join failed:`, err);
      if (!this.destroyed) {
        setTimeout(() => {
          this.reconnecting = false;
          void this.syncVoicePresence(guildId);
        }, RECONNECT_DELAY_MS);
        return;
      }
    }

    this.reconnecting = false;
  }

  private disconnectVoice(): void {
    this.stopMixer();
    this.player.stop();
    this.connection?.destroy();
    this.connection = null;
    this.reconnecting = false;
  }

  /**
   * Queue a stereo s16le PCM buffer for a given speaker. The audio is NOT
   * written straight to Discord — it lands in that speaker's jitter buffer and
   * the 20 ms mixer clock ({@link mixTick}) sums all active speakers into one
   * realtime stream. This bounds the output rate to realtime (no overflow) and
   * mixes simultaneous speakers instead of concatenating them.
   */
  pushPcm(pcm: Buffer, speakerUserId?: string): void {
    if (!this.connection || this.destroyed) return;
    const key = speakerUserId ?? "";
    if (key && this.isSpeakerInTargetChannel(key)) return;

    let s = this.speakers.get(key);
    if (!s) {
      s = { buf: Buffer.alloc(0), lastAt: 0 };
      this.speakers.set(key, s);
    }
    s.buf = s.buf.length ? Buffer.concat([s.buf, pcm]) : pcm;
    s.lastAt = Date.now();
    // Bound latency: if a speaker's buffer runs away, keep only the most recent
    // MAX_SPEAKER_BUFFER_BYTES (drop oldest) and count it as an overflow.
    if (s.buf.length > MAX_SPEAKER_BUFFER_BYTES) {
      s.buf = s.buf.subarray(s.buf.length - MAX_SPEAKER_BUFFER_BYTES);
      this.bufferOverflows++;
      this.recentOverflows++;
    }
    this.ensureMixer();
  }

  /** Start the output stream + 20 ms mixer clock if not already running. */
  private ensureMixer(): void {
    if (!this.passThrough || this.passThrough.destroyed) {
      this.passThrough = new PassThrough();
      const resource = createAudioResource(this.passThrough, {
        inputType: StreamType.Raw,
      });
      this.player.play(resource);
    }
    if (!this.mixTimer) {
      this.mixTimer = setInterval(() => this.mixTick(), FRAME_MS);
    }
  }

  /** One mixer tick: pull a 20 ms frame from each speaker that has one, sum
   *  them, write a single mixed frame. Reap idle speakers; stop when none. */
  private mixTick(): void {
    if (this.destroyed || !this.connection) {
      this.stopMixer();
      return;
    }
    const now = Date.now();
    const frames: Buffer[] = [];
    for (const [key, s] of this.speakers) {
      if (s.buf.length >= FRAME_BYTES) {
        frames.push(s.buf.subarray(0, FRAME_BYTES));
        s.buf = s.buf.subarray(FRAME_BYTES);
      } else if (s.buf.length === 0 && now - s.lastAt > SILENCE_TIMEOUT_MS) {
        this.speakers.delete(key);
      }
    }
    if (frames.length === 0) {
      if (this.speakers.size === 0) this.stopMixer();
      return;
    }
    this.passThrough?.write(mixFrames(frames));
  }

  /** Stop the mixer clock, end the output stream, drop all speaker buffers. */
  private stopMixer(): void {
    if (this.mixTimer) {
      clearInterval(this.mixTimer);
      this.mixTimer = null;
    }
    if (this.passThrough && !this.passThrough.destroyed) this.passThrough.end();
    this.passThrough = null;
    this.speakers.clear();
  }

  private isSpeakerInTargetChannel(userId: string): boolean {
    const guild = this.targetChannel?.guild;
    if (!guild) return false;
    return guild.voiceStates.cache.get(userId)?.channelId === this.cfg.channelId;
  }

  /** Called by the watchdog to read and reset the per-tick overflow counter. */
  drainRecentOverflows(): number {
    const n = this.recentOverflows;
    this.recentOverflows = 0;
    return n;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    this.disconnectVoice();
    await this.client.destroy();
  }

  getMetrics(): BotMetrics {
    return {
      name: this.cfg.name,
      channelId: this.cfg.channelId,
      voiceConnected: this.connection !== null,
      expectedConnected: this.humansPresent,
      speaking: this.mixTimer !== null && this.speakers.size > 0,
      playerState: this.player.state.status,
      bufferBytes: [...this.speakers.values()].reduce((n, s) => n + s.buf.length, 0),
      bufferOverflows: this.bufferOverflows,
      recentOverflows: this.recentOverflows,
      reconnectCount: this.reconnectCount,
    };
  }

  getVoiceStates(guildId: string): { channel_id: string | null; user_id: string; displayName: string }[] {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return [];
    return [...guild.voiceStates.cache.entries()].map(([userId, vs]) => ({
      channel_id: vs.channelId,
      user_id: userId,
      displayName: vs.member?.displayName ?? vs.member?.user.username ?? userId,
    }));
  }
}
