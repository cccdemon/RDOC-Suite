import { LazyStore } from "@tauri-apps/plugin-store";
import { DEFAULT_BRIDGE_URL, DEFAULT_FLEETPLANNER_URL, DEFAULT_HOTKEY, DEFAULT_RELAY_HOTKEY } from "./config";

/**
 * Persisted user settings. Anything that can differ between deployments
 * or installations lives in here so the same EXE works for any crew
 * without a rebuild. Migration on read: any field missing in the
 * on-disk file gets a default, and a one-time write fills it in.
 */
export type SavedGuild = { id: string; label?: string };

export type Settings = {
  /** Bridge HTTPS origin (no trailing slash) — formerly VITE_BRIDGE_URL. */
  bridgeUrl: string;
  /** Fleetplanner / Mission origin — used as the default mission URL. */
  fleetplannerUrl: string;
  /** PTT-1 (LOCAL) hotkey. Without a mission → guild bridge room;
   *  with a mission → mission commander room. Migrated from old `hotkey`. */
  localHotkey: string;
  /** Last session token (JWT). Optional — absent = signed out. */
  token?: string;
  /** Guild ID the session token is valid for. */
  guildId?: string;
  /** Cached set of guild IDs the user has signed in to before — used
   *  to pre-fill the guild picker dropdown. */
  savedGuilds: SavedGuild[];
  /** Last-used guild ID — pre-selected in the picker. */
  lastGuildId?: string;
  /** Audio device IDs (browser `enumerateDevices()` IDs). Undefined =
   *  use the OS default. */
  micDeviceId?: string;
  outputDeviceId?: string;
  /** Output / playback volume 0..100. */
  outputVolumePct: number;
  /** Microphone gain 0..200 (100 = unity). */
  micGainPct: number;
  /** Per-remote-user volume overrides keyed by Discord userId.
   *  Values 0..200 (100 = unity). Lets the user balance loud and
   *  quiet commanders individually — applied on top of outputVolumePct. */
  remoteVolumes: Record<string, number>;
  /** Output (receive) mute. When true, the companion stops playing
   *  remote commanders' audio locally and broadcasts the flag so peers
   *  see "this person can't hear me". Persists across restarts. */
  outputMuted: boolean;
  /** Manual Away From Keyboard flag. Broadcast to peers. Persists
   *  across restarts so a user who quits the app marked AFK is still
   *  shown AFK if they reconnect. */
  afk: boolean;
  /** PTT / incoming-transmission audio feedback chirps on/off. */
  feedbackSoundsEnabled: boolean;
  /** Volume of the synthesized feedback chirps, 0..100. */
  feedbackSoundsVolumePct: number;
  /** Whether to lower Discord's per-app volume while squad-link audio
   *  is active (own PTT or incoming peer transmission). */
  duckingEnabled: boolean;
  /** Target Discord volume while ducked, 0..100. */
  duckingTargetVolumePct: number;
  /** Mission voice companion session token (from dccc://fleet-voice link). */
  missionToken?: string;
  /** Fleetplanner URL for mission voice (from dccc://fleet-voice link). */
  missionUrl?: string;
  /** PTT-2 (RELAY) hotkey — Discord relay channel. Active when the
   *  server grants relay capability. Migrated from old `relayHotkey`. */
  globalHotkey: string;
};

const STORE_FILE = "settings.json";
const store = new LazyStore(STORE_FILE);

const DEFAULTS: Omit<Settings, "token" | "guildId" | "lastGuildId" | "micDeviceId" | "outputDeviceId" | "missionToken" | "missionUrl"> = {
  bridgeUrl: DEFAULT_BRIDGE_URL,
  fleetplannerUrl: DEFAULT_FLEETPLANNER_URL,
  localHotkey: DEFAULT_HOTKEY,
  globalHotkey: DEFAULT_RELAY_HOTKEY,
  savedGuilds: [],
  outputVolumePct: 100,
  micGainPct: 100,
  remoteVolumes: {},
  outputMuted: false,
  afk: false,
  feedbackSoundsEnabled: true,
  feedbackSoundsVolumePct: 50,
  duckingEnabled: true,
  duckingTargetVolumePct: 25,
};

/**
 * Load + migrate the settings file. Any field added since the last
 * release gets the default. Returns the merged result; persistence
 * of new defaults happens lazily on the next explicit save call.
 */
export async function loadSettings(): Promise<Settings> {
  const [
    bridgeUrl, fleetplannerUrl,
    localHotkey, hotkey, relayHotkey, token, guildId, savedGuilds, lastGuildId,
    micDeviceId, outputDeviceId, outputVolumePct, micGainPct, remoteVolumes,
    outputMuted, afk,
    feedbackSoundsEnabled, feedbackSoundsVolumePct,
    duckingEnabled, duckingTargetVolumePct,
    missionToken, missionUrl, globalHotkey,
  ] = await Promise.all([
    store.get<string>("bridgeUrl"),
    store.get<string>("fleetplannerUrl"),
    store.get<string>("localHotkey"),
    store.get<string>("hotkey"),
    store.get<string>("relayHotkey"),
    store.get<string>("token"),
    store.get<string>("guildId"),
    store.get<SavedGuild[]>("savedGuilds"),
    store.get<string>("lastGuildId"),
    store.get<string>("micDeviceId"),
    store.get<string>("outputDeviceId"),
    store.get<number>("outputVolumePct"),
    store.get<number>("micGainPct"),
    store.get<Record<string, number>>("remoteVolumes"),
    store.get<boolean>("outputMuted"),
    store.get<boolean>("afk"),
    store.get<boolean>("feedbackSoundsEnabled"),
    store.get<number>("feedbackSoundsVolumePct"),
    store.get<boolean>("duckingEnabled"),
    store.get<number>("duckingTargetVolumePct"),
    store.get<string>("missionToken"),
    store.get<string>("missionUrl"),
    store.get<string>("globalHotkey"),
  ]);
  return {
    bridgeUrl: bridgeUrl ?? DEFAULTS.bridgeUrl,
    fleetplannerUrl: fleetplannerUrl ?? DEFAULTS.fleetplannerUrl,
    // Migration: localHotkey falls back to the old `hotkey` key (Bridge PTT).
    localHotkey: localHotkey ?? hotkey ?? DEFAULTS.localHotkey,
    token: token ?? undefined,
    guildId: guildId ?? undefined,
    savedGuilds: Array.isArray(savedGuilds) ? savedGuilds : [],
    lastGuildId: lastGuildId ?? undefined,
    micDeviceId: micDeviceId ?? undefined,
    outputDeviceId: outputDeviceId ?? undefined,
    outputVolumePct: typeof outputVolumePct === "number" ? outputVolumePct : DEFAULTS.outputVolumePct,
    micGainPct: typeof micGainPct === "number" ? micGainPct : DEFAULTS.micGainPct,
    remoteVolumes:
      remoteVolumes && typeof remoteVolumes === "object" ? remoteVolumes : { ...DEFAULTS.remoteVolumes },
    outputMuted: typeof outputMuted === "boolean" ? outputMuted : DEFAULTS.outputMuted,
    afk: typeof afk === "boolean" ? afk : DEFAULTS.afk,
    feedbackSoundsEnabled:
      typeof feedbackSoundsEnabled === "boolean"
        ? feedbackSoundsEnabled
        : DEFAULTS.feedbackSoundsEnabled,
    feedbackSoundsVolumePct:
      typeof feedbackSoundsVolumePct === "number"
        ? feedbackSoundsVolumePct
        : DEFAULTS.feedbackSoundsVolumePct,
    duckingEnabled:
      typeof duckingEnabled === "boolean" ? duckingEnabled : DEFAULTS.duckingEnabled,
    duckingTargetVolumePct:
      typeof duckingTargetVolumePct === "number"
        ? duckingTargetVolumePct
        : DEFAULTS.duckingTargetVolumePct,
    missionToken: missionToken ?? undefined,
    missionUrl: missionUrl ?? undefined,
    // Migration: globalHotkey falls back to the old `relayHotkey` key.
    globalHotkey: globalHotkey ?? relayHotkey ?? DEFAULTS.globalHotkey,
  };
}

export async function saveSession(token: string, guildId: string): Promise<void> {
  await store.set("token", token);
  await store.set("guildId", guildId);
  await store.set("lastGuildId", guildId);
  await store.save();
}

export async function clearSession(): Promise<void> {
  await store.delete("token");
  await store.delete("guildId");
  await store.save();
}

export async function saveLocalHotkey(accelerator: string): Promise<void> {
  await store.set("localHotkey", accelerator);
  await store.save();
}

export async function saveBridgeUrl(url: string): Promise<void> {
  await store.set("bridgeUrl", url);
  await store.save();
}

export async function saveFleetplannerUrl(url: string): Promise<void> {
  await store.set("fleetplannerUrl", url);
  await store.save();
}

export async function saveAudioPrefs(opts: {
  micDeviceId?: string;
  outputDeviceId?: string;
  outputVolumePct?: number;
  micGainPct?: number;
}): Promise<void> {
  const writes: Array<Promise<void>> = [];
  if (opts.micDeviceId !== undefined) writes.push(store.set("micDeviceId", opts.micDeviceId));
  if (opts.outputDeviceId !== undefined) writes.push(store.set("outputDeviceId", opts.outputDeviceId));
  if (typeof opts.outputVolumePct === "number") writes.push(store.set("outputVolumePct", opts.outputVolumePct));
  if (typeof opts.micGainPct === "number") writes.push(store.set("micGainPct", opts.micGainPct));
  await Promise.all(writes);
  await store.save();
}

export async function saveGuilds(savedGuilds: SavedGuild[]): Promise<void> {
  await store.set("savedGuilds", savedGuilds);
  await store.save();
}

export async function saveRemoteVolumes(map: Record<string, number>): Promise<void> {
  await store.set("remoteVolumes", map);
  await store.save();
}

export async function saveOutputMuted(muted: boolean): Promise<void> {
  await store.set("outputMuted", muted);
  await store.save();
}

export async function saveAfk(afk: boolean): Promise<void> {
  await store.set("afk", afk);
  await store.save();
}

export async function saveFeedbackSounds(opts: {
  enabled?: boolean;
  volumePct?: number;
}): Promise<void> {
  const writes: Array<Promise<void>> = [];
  if (typeof opts.enabled === "boolean") writes.push(store.set("feedbackSoundsEnabled", opts.enabled));
  if (typeof opts.volumePct === "number")
    writes.push(store.set("feedbackSoundsVolumePct", opts.volumePct));
  await Promise.all(writes);
  await store.save();
}

export async function saveMissionConfig(token: string, url: string): Promise<void> {
  await store.set("missionToken", token);
  await store.set("missionUrl", url);
  await store.save();
}

export async function clearMissionConfig(): Promise<void> {
  await store.delete("missionToken");
  await store.delete("missionUrl");
  await store.save();
}

export async function saveGlobalHotkey(accelerator: string): Promise<void> {
  await store.set("globalHotkey", accelerator);
  await store.save();
}

export async function saveDucking(opts: {
  enabled?: boolean;
  targetVolumePct?: number;
}): Promise<void> {
  const writes: Array<Promise<void>> = [];
  if (typeof opts.enabled === "boolean") writes.push(store.set("duckingEnabled", opts.enabled));
  if (typeof opts.targetVolumePct === "number")
    writes.push(store.set("duckingTargetVolumePct", opts.targetVolumePct));
  await Promise.all(writes);
  await store.save();
}
