import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommanderInfo } from "@rdoc-suite/shared";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { onOpenUrl, getCurrent as getCurrentDeepLinks } from "@tauri-apps/plugin-deep-link";
import { BridgeWs, type WsStatus } from "./lib/ws";
import {
  formatKeyboardAccelerator,
  isMouseHotkey,
  keyReleaseMatchesAccelerator,
  setupHotkey,
  teardownHotkey,
  type HotkeyEventPayload,
} from "./lib/hotkey";
import { jwtSubject, startOAuthInWebview } from "./lib/auth";
import { info as logInfo } from "@tauri-apps/plugin-log";
import { longVersion, shortVersion } from "./lib/version";
import { checkForUpdate, type UpdateCheckResult } from "./lib/updater";
import { UpdateModal } from "./components/UpdateModal";
import {
  clearSession,
  clearMissionConfig,
  loadSettings,
  saveAfk,
  saveAudioPrefs,
  saveBridgeUrl,
  saveDucking,
  saveFeedbackSounds,
  saveFleetplannerUrl,
  saveGuilds,
  saveLocalHotkey,
  saveMissionConfig,
  saveGlobalHotkey,
  saveOutputMuted,
  saveRemoteVolumes,
  saveSession,
  type SavedGuild,
} from "./lib/store";
import {
  DEFAULT_BRIDGE_URL,
  DEFAULT_FLEETPLANNER_URL,
  DEFAULT_HOTKEY,
  DEFAULT_RELAY_HOTKEY,
} from "./lib/config";
import { LivekitAudio, type AudioStatus, type DeviceConfig } from "./lib/livekit";
import {
  DEFAULT_SUITE_CAPABILITIES,
  loadSuiteCapabilities,
  type SuiteCapabilities,
} from "./lib/suite";
import { feedbackAudio } from "./lib/audioFeedback";
import { Icon } from "./components/kit/Icon";
import { SettingsModal, type SettingsDraft } from "./components/SettingsModal";
import { GuildPickerModal } from "./components/GuildPickerModal";
import { SessionJoinModal } from "./components/SessionJoinModal";
import { joinSession } from "./lib/sessionApi";
import { RelayAudio, type RelayStatus } from "./lib/relayAudio";
import { FleetAudio, type FleetStatus } from "./lib/fleetAudio";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MissionVoicePanel } from "./components/MissionVoicePanel";
import { MissionLinkModal } from "./components/MissionLinkModal";

type AppState = {
  bridgeUrl: string;
  guildId: string | null;
  /** Discord display name for the guild, when the bridge could resolve
   *  it from Discord. Falls back to guildId at render time. */
  guildName: string | null;
  token: string | null;
  suiteCapabilities: SuiteCapabilities;
  /** Mirror of the persisted audio prefs — kept in state so a Settings
   *  save can re-apply live without re-loading from disk. */
  device: DeviceConfig;
  wsStatus: WsStatus;
  wsDetail: string | null;
  audioStatus: AudioStatus;
  audioDetail: string | null;
  pttActive: boolean;
  /** Local-only mirror of "I have muted incoming audio". Sent to the
   *  bridge via status:output-mute so peers see the same flag in their
   *  roster. Persisted across restarts. */
  outputMuted: boolean;
  /** Local-only mirror of the manual AFK toggle. Sent to the bridge
   *  via status:afk for peer visibility. Persisted across restarts. */
  afk: boolean;
  /** Synth-burst PTT/incoming chirps on/off (local UX only). */
  feedbackSoundsEnabled: boolean;
  /** 0..100 volume for those chirps. */
  feedbackSoundsVolumePct: number;
  /** Lower Discord's per-app volume while squad-link audio is active. */
  duckingEnabled: boolean;
  /** Target Discord volume while ducked, 0..100. */
  duckingTargetVolumePct: number;
  activeCommanders: CommanderInfo[];
  lastError: string | null;
  /** Non-null when connected to a session room via invite. */
  sessionId: string | null;
  sessionLabel: string | null;
  relayStatus: RelayStatus;
  relayPttActive: boolean;
  /** Fleetplanner / Mission origin — default mission URL. */
  fleetplannerUrl: string;
  // ── Mission Voice (Fleetcommander mode) ─────────────────────────────
  missionActive: boolean;
  missionOpTitle: string | null;
  /** commanderRoom delivered by the backend for this user? */
  missionHasCommander: boolean;
  /** missionCommanderRef connection status. */
  commanderStatus: FleetStatus;
  commanderPttActive: boolean;
  missionToken: string | null;
  missionUrl: string | null;
  missionEnded: boolean;
  // ── Hotkeys (consolidated: 2 PTTs) ──────────────────────────────────
  /** PTT-1: without mission → bridge; with mission → commanderRoom. */
  localHotkey: string;
  /** PTT-2: Discord relay (when canUseRelay). */
  globalHotkey: string;
};

const INITIAL: AppState = {
  bridgeUrl: DEFAULT_BRIDGE_URL,
  guildId: null,
  guildName: null,
  token: null,
  suiteCapabilities: DEFAULT_SUITE_CAPABILITIES,
  device: { outputVolumePct: 100, micGainPct: 100 },
  wsStatus: "idle",
  wsDetail: null,
  audioStatus: "idle",
  audioDetail: null,
  pttActive: false,
  outputMuted: false,
  afk: false,
  feedbackSoundsEnabled: true,
  feedbackSoundsVolumePct: 50,
  duckingEnabled: true,
  duckingTargetVolumePct: 25,
  activeCommanders: [],
  lastError: null,
  sessionId: null,
  sessionLabel: null,
  relayStatus: "idle",
  relayPttActive: false,
  fleetplannerUrl: DEFAULT_FLEETPLANNER_URL,
  missionActive: false,
  missionOpTitle: null,
  missionHasCommander: false,
  commanderStatus: "idle",
  commanderPttActive: false,
  missionToken: null,
  missionUrl: null,
  missionEnded: false,
  localHotkey: DEFAULT_HOTKEY,
  globalHotkey: DEFAULT_RELAY_HOTKEY,
};

export function App(): JSX.Element {
  const [state, setState] = useState<AppState>(INITIAL);
  const [showSettings, setShowSettings] = useState(false);
  const [showGuildPicker, setShowGuildPicker] = useState(false);
  const [savedGuilds, setSavedGuilds] = useState<SavedGuild[]>([]);
  const [lastGuildId, setLastGuildId] = useState<string | undefined>(undefined);
  const [remoteVolumes, setRemoteVolumes] = useState<Record<string, number>>({});
  const [updateOffer, setUpdateOffer] = useState<Extract<
    UpdateCheckResult,
    { kind: "available" }
  > | null>(null);

  const [showSessionJoin, setShowSessionJoin] = useState(false);
  const [sessionJoinError, setSessionJoinError] = useState<string | null>(null);
  const [sessionJoinLoading, setSessionJoinLoading] = useState(false);

  const wsRef = useRef<BridgeWs | null>(null);
  const audioRef = useRef<LivekitAudio | null>(null);
  const relayRef = useRef<RelayAudio | null>(null);
  // Mission voice: commander room only (global is handled via the relay path).
  const missionCommanderRef = useRef<FleetAudio | null>(null);
  const currentMissionCommanderRoomRef = useRef<string | null>(null);
  // The opId this mission link joined. Pinned on first poll so a mission
  // close/switch is detected (and ends the mission) instead of silently
  // hopping the user onto the next active op.
  const missionOpIdRef = useRef<string | null>(null);
  // Last guild-bridge LiveKit creds (from bridge:joined / audio:enable).
  // Used to resume guild audio after a mission ends — mission mode
  // suppresses the bridge LiveKit session so LOCAL voice truly switches
  // to the commander room instead of layering both channels.
  const lastBridgeCredsRef = useRef<{ url: string; token: string } | null>(null);
  // Tracks whether the mission commander room currently owns LOCAL voice,
  // so the bridge↔mission audio switch only fires on real transitions.
  const missionOwnsLocalRef = useRef(false);
  const [showMissionModal, setShowMissionModal] = useState(false);
  const stateRef = useRef<AppState>(INITIAL);
  stateRef.current = state;
  /** Set of remote-commander userIds that were `speaking=true` in the
   *  last commander:list. Diff'd against the next list so we can fire
   *  exactly one feedbackAudio chirp per remote-talk-start / -stop. */
  const prevSpeakingRef = useRef<Set<string>>(new Set());
  /** Reference count of "things that should keep Discord ducked":
   *  +1 while own PTT is held, +1 per remote commander currently
   *  speaking. Duck on 0→positive edge, restore on positive→0 edge.
   *  Avoids re-issuing duck() / restore() on every overlapping source. */
  const duckingActiveCountRef = useRef(0);

  // Stable PTT handler. Lives in a useCallback (with refs for the
  // moving parts) so it can be passed to BOTH the initial setupHotkey
  // at mount AND a re-registration after Settings-Save. Previously the
  // settings flow passed a no-op here and teardownHotkey+setupHotkey
  // overwrote the mount-time listener — PTT silently stopped working
  // until the next app restart.
  /** Increment the ducking ref count. Edge-trigger duck() when
   *  going from 0 → 1. The Tauri command is no-op on non-Windows
   *  and when Discord isn't running, so callers don't have to
   *  guard. Honours the user's duckingEnabled flag. */
  const duckingActivate = useCallback(() => {
    const cur = stateRef.current;
    duckingActiveCountRef.current += 1;
    if (!cur.duckingEnabled) return;
    if (duckingActiveCountRef.current === 1) {
      void invoke("duck_discord", { targetPct: cur.duckingTargetVolumePct }).catch(() => {
        /* invoke failure is logged Rust-side; ignore here */
      });
    }
  }, []);

  /** Decrement the ducking ref count. Edge-trigger restore() when
   *  going from 1 → 0. Clamps at 0 in case of any miscount. */
  const duckingDeactivate = useCallback(() => {
    if (duckingActiveCountRef.current > 0) {
      duckingActiveCountRef.current -= 1;
    }
    const cur = stateRef.current;
    if (!cur.duckingEnabled) return;
    if (duckingActiveCountRef.current === 0) {
      void invoke("restore_discord_volume").catch(() => {});
    }
  }, []);

  // PTT-1 (LOCAL). Context-dependent target:
  //  - mission active + commander room → send into the mission commanderRoom
  //  - otherwise                       → guild bridge room (Squad Link)
  // Ducking + feedback chirps fire in both branches.
  const handlePttEvent = useCallback((e: HotkeyEventPayload) => {
    const pressed = e.state === "pressed";
    const cur = stateRef.current;

    // Local audio feedback — even if everything else is offline. Helps the
    // user know the hotkey at least registered with the Companion.
    if (pressed) {
      feedbackAudio.playPttPress();
      duckingActivate();
    } else {
      feedbackAudio.playPttRelease();
      duckingDeactivate();
    }

    // Mission mode: route PTT-1 to the commander room.
    if (cur.missionActive && cur.missionHasCommander) {
      setState((s) => ({ ...s, commanderPttActive: pressed }));
      void missionCommanderRef.current?.setPttActive(pressed);
      return;
    }

    // Bridge mode: drive the guild LiveKit session + WS ptt signalling.
    setState((s) => ({ ...s, pttActive: pressed }));
    const wsLocal = wsRef.current;
    const audioLocal = audioRef.current;
    if (audioLocal) void audioLocal.setMuted(!pressed);
    if (!wsLocal || !cur.token || !cur.guildId) return;
    if (pressed) {
      wsLocal.send({ type: "ptt:start", guildId: cur.guildId });
    } else {
      wsLocal.send({ type: "ptt:stop", guildId: cur.guildId });
    }
  }, []);

  // Window-focused fallback for KEYBOARD hotkeys. When the Companion
  // window has focus, WebView2 captures the keystroke before our
  // global WH_KEYBOARD_LL (via rdev) sees it — at least on Windows
  // builds where webview's input swallowing is aggressive. So we also
  // attach a window-level keydown/keyup listener. Mouse-side-buttons
  // (Mouse4/5) are unaffected — the mouse hook isn't swallowed by
  // webview focus — and remain rdev-only.
  //
  // Both paths route through the same handlePttEvent, so a press
  // delivered twice (rdev + window-handler) is idempotent: the mute
  // state simply gets re-set to the same value.
  useEffect(() => {
    const hotkey = state.localHotkey;
    if (!hotkey || isMouseHotkey(hotkey)) return;

    const onDown = (e: KeyboardEvent): void => {
      if (e.repeat) return; // ignore OS auto-repeat
      const formatted = formatKeyboardAccelerator(e);
      if (formatted === hotkey) {
        e.preventDefault();
        handlePttEvent({ state: "pressed", accelerator: hotkey });
      }
    };
    const onUp = (e: KeyboardEvent): void => {
      if (keyReleaseMatchesAccelerator(e, hotkey)) {
        e.preventDefault();
        handlePttEvent({ state: "released", accelerator: hotkey });
      }
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
    };
  }, [state.localHotkey, handlePttEvent]);

  // Check for an auto-update once we have BOTH bridgeUrl + sessionToken.
  // The bridge requires the JWT to peek the release — no public bypass
  // of the admin's single-use-token mechanism. Slight delay so the
  // initial UI can render first.
  useEffect(() => {
    if (!state.bridgeUrl) return;
    const timer = setTimeout(async () => {
      const res = await checkForUpdate({
        bridgeUrl: state.bridgeUrl,
        sessionToken: state.token,
      });
      if (res.kind === "available") {
        setUpdateOffer(res);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [state.bridgeUrl, state.token]);

  // Debug: log EVERY hotkey event the Rust side emits — helps diagnose
  // mouse-button mapping and unexpected key strings.
  useEffect(() => {
    let canceled = false;
    let unlisten: (() => void) | null = null;
    (async () => {
      const fn = await listen<HotkeyEventPayload>("hotkey", (e) => {
        console.log("[hotkey raw]", e.payload);
      });
      if (canceled) fn();
      else unlisten = fn;
    })();
    return () => {
      canceled = true;
      unlisten?.();
    };
  }, []);

  // Mount: load persisted settings + wire ws/audio/hotkey
  useEffect(() => {
    let mounted = true;

    (async () => {
      const settings = await loadSettings();
      if (!mounted) return;
      // Diagnostic dump so the log file always shows what the user
      // started with (without revealing the token itself).
      void logInfo(`[boot] ${longVersion()}`);
      void logInfo(
        `[boot] settings loaded: bridgeUrl=${settings.bridgeUrl} hasToken=${!!settings.token} guildId=${settings.guildId ?? "-"} localHotkey=${settings.localHotkey} globalHotkey=${settings.globalHotkey} micGain=${settings.micGainPct}% outputVol=${settings.outputVolumePct}% micDevice=${settings.micDeviceId ?? "default"} outputDevice=${settings.outputDeviceId ?? "default"} remoteVolumes=${Object.keys(settings.remoteVolumes).length} entries`,
      );

      const deviceCfg: DeviceConfig = {
        micDeviceId: settings.micDeviceId,
        outputDeviceId: settings.outputDeviceId,
        outputVolumePct: settings.outputVolumePct,
        micGainPct: settings.micGainPct,
      };

      // ── Create ws + audio FIRST, then setState. ─────────────────
      // If we setState before creating the refs, the useEffect that
      // depends on state.token runs while wsRef.current is still null
      // (an await would yield in between), so ws.connect never fires
      // and a perfectly valid stored token sits unused — user lands
      // on the connected pane but everything stays IDLE forever.
      const ws = new BridgeWs();
      ws.setBridgeUrl(settings.bridgeUrl);
      wsRef.current = ws;
      const audio = new LivekitAudio();
      audioRef.current = audio;
      await audio.applyDeviceConfig(deviceCfg);
      audio.setRemoteVolumes(settings.remoteVolumes);
      // Apply persisted output-mute BEFORE the first LiveKit attach so a
      // user who quit muted stays muted on next launch.
      audio.setOutputMuted(settings.outputMuted);
      // Audio feedback (PTT chirps) — apply persisted prefs.
      feedbackAudio.setEnabled(settings.feedbackSoundsEnabled);
      feedbackAudio.setVolumePct(settings.feedbackSoundsVolumePct);
      // Chirps follow output-mute: if you can't hear peers, you don't
      // want a chirp announcing them either.
      feedbackAudio.setSuppressed(settings.outputMuted);
      audio.setListeners({
        status: (audioStatus, detail) => {
          setState((s) => ({ ...s, audioStatus, audioDetail: detail ?? null }));
        },
      });

      ws.setListeners({
        status: (status, detail) => {
          setState((s) => ({ ...s, wsStatus: status, wsDetail: detail ?? null }));
          if (status === "closed" && detail === "unauthenticated") {
            void clearSession();
            setState((s) => ({
              ...s,
              token: null,
              guildId: null,
              activeCommanders: [],
              lastError: "Sitzung abgelaufen — bitte erneut anmelden.",
            }));
            void audio.disconnect();
          }
          if (status === "closed" && detail === "superseded") {
            // Another instance of the companion grabbed this user's
            // bridge slot. Tell the user what happened; keep the
            // stored token so they can re-take control with ABMELDEN
            // + neu anmelden if they want this instance back.
            setState((s) => ({
              ...s,
              activeCommanders: [],
              lastError:
                "Eine andere Companion-Instanz hat die Sitzung übernommen. Falls das du selbst warst (z.B. zweite EXE offen): die andere schließen.",
            }));
            void audio.disconnect();
          }
        },
        message: (msg) => {
          if (msg.type === "bridge:joined") {
            setState((s) => ({
              ...s,
              activeCommanders: msg.activeCommanders,
              guildName: msg.guildName ?? s.guildName,
              lastError: null,
            }));
            if (msg.livekitUrl && msg.livekitToken) {
              // Remember the bridge creds so we can resume guild audio
              // after a mission ends (mission mode suppresses it).
              lastBridgeCredsRef.current = { url: msg.livekitUrl, token: msg.livekitToken };
              // Don't connect guild audio while a mission commander room
              // owns LOCAL voice — the mission has switched us off the
              // squad channel. We'll resume on mission end.
              const m = stateRef.current;
              if (!(m.missionActive && m.missionHasCommander)) {
                audio
                  .connect(msg.livekitUrl, msg.livekitToken)
                  .catch((err) => setState((s) => ({ ...s, lastError: `LiveKit: ${String(err)}` })));
              }
            }
            // Push the persisted output-mute / afk state to the bridge
            // so peers see the same flags we're carrying locally. Skip
            // the default-false case so a fresh user doesn't generate
            // pointless commander:list broadcasts.
            const cur = stateRef.current;
            if (cur.outputMuted) {
              ws.send({ type: "status:output-mute", muted: true });
            }
            if (cur.afk) {
              ws.send({ type: "status:afk", afk: true });
            }
          } else if (msg.type === "audio:enable") {
            setState((s) => ({ ...s, lastError: null }));
            lastBridgeCredsRef.current = { url: msg.livekitUrl, token: msg.livekitToken };
            const m = stateRef.current;
            if (!(m.missionActive && m.missionHasCommander)) {
              audio
                .connect(msg.livekitUrl, msg.livekitToken)
                .catch((err) => setState((s) => ({ ...s, lastError: `LiveKit: ${String(err)}` })));
            }
          } else if (msg.type === "audio:disable") {
            void audio.disconnect();
            setState((s) => ({
              ...s,
              lastError:
                msg.reason === "not_in_voice"
                  ? "Audio pausiert — du bist nicht in einem Voice-Channel."
                  : "Audio pausiert — dein aktueller Channel ist nicht freigeschaltet.",
            }));
          } else if (msg.type === "commander:list") {
            // Diff speaking-state vs. previous list and chirp once per
            // remote talk-start / talk-stop. Skip self so our own PTT
            // doesn't trigger an incoming-chirp on top of the
            // press/release sound that handlePttEvent already played.
            const myUserId = stateRef.current.token ? jwtSubject(stateRef.current.token) : null;
            const nextSpeaking = new Set<string>();
            for (const c of msg.commanders) {
              if (c.speaking && c.userId !== myUserId) nextSpeaking.add(c.userId);
            }
            const prev = prevSpeakingRef.current;
            for (const userId of nextSpeaking) {
              if (!prev.has(userId)) {
                feedbackAudio.playIncomingStart();
                duckingActivate();
              }
            }
            for (const userId of prev) {
              if (!nextSpeaking.has(userId)) {
                feedbackAudio.playIncomingStop();
                duckingDeactivate();
              }
            }
            prevSpeakingRef.current = nextSpeaking;
            setState((s) => ({ ...s, activeCommanders: msg.commanders }));
          } else if (msg.type === "bridge:left") {
            setState((s) => ({ ...s, activeCommanders: [] }));
            // Any peers we had been tracking as "speaking" are now
            // gone. Force-restore Discord by decrementing once per
            // such peer, so the ducking count returns to zero.
            for (let i = 0; i < prevSpeakingRef.current.size; i++) {
              duckingDeactivate();
            }
            prevSpeakingRef.current = new Set();
            void audio.disconnect();
          } else if (msg.type === "error") {
            setState((s) => ({ ...s, lastError: `${msg.code}: ${msg.message}` }));
          }
        },
      });

      await setupHotkey(settings.localHotkey, handlePttEvent);

      if (!mounted) return;
      // setState LAST so the useEffect that connects WS finds the
      // refs already populated. This is the bug-fix: previously
      // setState fired first and the connect-on-token-change effect
      // ran while wsRef.current was still null, silently dropping
      // the auto-connect of a valid stored token.
      setSavedGuilds(settings.savedGuilds);
      setLastGuildId(settings.lastGuildId);
      setRemoteVolumes(settings.remoteVolumes);
      setState((s) => ({
        ...s,
        bridgeUrl: settings.bridgeUrl,
        token: settings.token ?? null,
        guildId: settings.guildId ?? null,
        device: deviceCfg,
        outputMuted: settings.outputMuted,
        afk: settings.afk,
        feedbackSoundsEnabled: settings.feedbackSoundsEnabled,
        feedbackSoundsVolumePct: settings.feedbackSoundsVolumePct,
        duckingEnabled: settings.duckingEnabled,
        duckingTargetVolumePct: settings.duckingTargetVolumePct,
        fleetplannerUrl: settings.fleetplannerUrl,
        missionToken: settings.missionToken ?? null,
        missionUrl: settings.missionUrl ?? null,
        localHotkey: settings.localHotkey,
        globalHotkey: settings.globalHotkey,
      }));
    })();

    return () => {
      mounted = false;
      void teardownHotkey();
      wsRef.current?.disconnect();
      void audioRef.current?.disconnect();
      void relayRef.current?.disconnect();
      void missionCommanderRef.current?.disconnect();
    };
  }, []);

  // Connect WS whenever we have BOTH a token and a target guildId.
  // The token is the user identity; the guildId is per-session and
  // can change without re-doing OAuth, so we rebuild the URL on every
  // change of either.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (state.token && state.guildId) {
      ws.connect(state.token, state.guildId);
    } else {
      ws.disconnect();
    }
  }, [state.token, state.guildId]);

  useEffect(() => {
    if (!state.bridgeUrl || !state.token || !state.guildId) {
      setState((s) =>
        s.suiteCapabilities === DEFAULT_SUITE_CAPABILITIES
          ? s
          : { ...s, suiteCapabilities: DEFAULT_SUITE_CAPABILITIES },
      );
      return;
    }
    let cancelled = false;
    void loadSuiteCapabilities({
      bridgeUrl: state.bridgeUrl,
      token: state.token,
      guildId: state.guildId,
    }).then((capabilities) => {
      if (cancelled) return;
      setState((s) => ({ ...s, suiteCapabilities: capabilities }));
    });
    return () => {
      cancelled = true;
    };
  }, [state.bridgeUrl, state.token, state.guildId]);

  const onSignIn = useCallback(() => {
    // Open the picker; actual OAuth is fired by the picker's confirm
    // handler (onGuildConfirm) which also persists the guild list.
    setShowGuildPicker(true);
  }, []);

  const onGuildConfirm = useCallback(
    async (guildId: string) => {
      setShowGuildPicker(false);
      setLastGuildId(guildId);
      // If we already have a valid token, just switch the active guild —
      // the session JWT is no longer guild-bound, so no second OAuth
      // round-trip needed. The useEffect picks up the new guildId and
      // reconnects the WS to the right room.
      if (state.token) {
        await saveSession(state.token, guildId);
        setState((s) => ({
          ...s,
          guildId,
          guildName: null,
          activeCommanders: [],
          lastError: null,
        }));
        return;
      }
      try {
        const result = await startOAuthInWebview(state.bridgeUrl, guildId);
        setState((s) => ({
          ...s,
          token: result.token,
          guildId: result.guildId,
          lastError: null,
        }));
      } catch (err) {
        setState((s) => ({ ...s, lastError: String(err) }));
      }
    },
    [state.bridgeUrl, state.token],
  );

  const onGuildsUpdate = useCallback(async (next: SavedGuild[]) => {
    setSavedGuilds(next);
    await saveGuilds(next);
  }, []);

  /** Adjust playback level for one remote commander. Applies live to
   *  the GainNode for that user and persists the new map to the Tauri
   *  store so it sticks across reconnects + EXE restarts. */
  const onRemoteVolumeChange = useCallback((userId: string, pct: number) => {
    audioRef.current?.setRemoteVolume(userId, pct);
    setRemoteVolumes((prev) => {
      // Drop the entry when reverting to unity, so the store stays
      // small and an unset value naturally means "100%".
      const next = { ...prev };
      if (pct === 100) delete next[userId];
      else next[userId] = pct;
      // Fire-and-forget; debouncing during slider drag is overkill
      // since saveRemoteVolumes is just a single Tauri-store write.
      void saveRemoteVolumes(next);
      return next;
    });
  }, []);

  /** Toggle the local "output mute" flag (we stop hearing peers).
   *  Persists the new state, mutes/unmutes already-attached remote
   *  audio elements, and tells the bridge so other commanders see the
   *  flag in their roster ("MUTED" pill).
   *
   *  Side effects deliberately live OUTSIDE the setState updater —
   *  React may call updater functions more than once (strict mode,
   *  concurrent rendering), which would emit duplicate audio.setMuted
   *  calls and duplicate ws sends. Use stateRef for the current value
   *  so two rapid clicks still toggle correctly. */
  const onToggleOutputMute = useCallback(() => {
    const next = !stateRef.current.outputMuted;
    void logInfo(`[status] output-mute toggled -> ${next}`);
    audioRef.current?.setOutputMuted(next);
    // Mute the chirps too — no point pinging the user about peer talk
    // they can't hear anyway.
    feedbackAudio.setSuppressed(next);
    void saveOutputMuted(next);
    wsRef.current?.send({ type: "status:output-mute", muted: next });
    setState((s) => ({ ...s, outputMuted: next }));
  }, []);

  /** Toggle the manual AFK flag. No-op locally except for persistence
   *  + the bridge broadcast — the peer-side roster shows the "AFK"
   *  pill, but audio behavior is unchanged. Same side-effect-outside-
   *  setState pattern as onToggleOutputMute for the same reason. */
  const onToggleAfk = useCallback(() => {
    const next = !stateRef.current.afk;
    void logInfo(`[status] afk toggled -> ${next}`);
    void saveAfk(next);
    wsRef.current?.send({ type: "status:afk", afk: next });
    setState((s) => ({ ...s, afk: next }));
  }, []);

  const onAdmiralClick = useCallback(() => {
    const cur = stateRef.current;
    void openUrl(`${cur.bridgeUrl.replace(/\/+$/, "")}/admin/sessions`).catch(() => {});
  }, []);

  const onSessionJoinConfirm = useCallback(async (inviteToken: string) => {
    const cur = stateRef.current;
    if (!cur.token || !cur.bridgeUrl) return;
    setSessionJoinLoading(true);
    setSessionJoinError(null);
    const result = await joinSession(cur.bridgeUrl, cur.token, inviteToken);
    setSessionJoinLoading(false);
    if (!result.ok) {
      setSessionJoinError(result.reason);
      return;
    }
    setShowSessionJoin(false);
    // Disconnect guild WS, connect session WS
    wsRef.current?.disconnect();
    wsRef.current?.connectSession(cur.token, result.sessionId);
    // Connect LiveKit with session token
    audioRef.current
      ?.connect(result.livekitUrl, result.livekitToken)
      .catch((err) => setState((s) => ({ ...s, lastError: `LiveKit (session): ${String(err)}` })));
    setState((s) => ({
      ...s,
      sessionId: result.sessionId,
      sessionLabel: result.sessionLabel,
      activeCommanders: [],
      lastError: null,
    }));
  }, []);

  const onLeaveSession = useCallback(() => {
    const cur = stateRef.current;
    wsRef.current?.disconnect();
    void audioRef.current?.disconnect();
    setState((s) => ({
      ...s,
      sessionId: null,
      sessionLabel: null,
      activeCommanders: [],
      lastError: null,
    }));
    // Reconnect to guild room
    if (cur.token && cur.guildId) {
      wsRef.current?.connect(cur.token, cur.guildId);
    }
  }, []);

  const onRelayPttEvent = useCallback((e: HotkeyEventPayload) => {
    const active = e.state === "pressed";
    setState((s) => ({ ...s, relayPttActive: active }));
    void relayRef.current?.setPttActive(active);
  }, []);

  // Relay (PTT-2 / GLOBAL) hotkey window-level listener (keyboard only).
  useEffect(() => {
    const hotkey = state.globalHotkey;
    if (!hotkey || isMouseHotkey(hotkey) || !state.suiteCapabilities.canUseRelay) return;
    const onDown = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      const formatted = formatKeyboardAccelerator(e);
      if (formatted === hotkey) {
        e.preventDefault();
        onRelayPttEvent({ state: "pressed", accelerator: hotkey });
      }
    };
    const onUp = (e: KeyboardEvent): void => {
      if (keyReleaseMatchesAccelerator(e, hotkey)) {
        e.preventDefault();
        onRelayPttEvent({ state: "released", accelerator: hotkey });
      }
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
    };
  }, [state.globalHotkey, state.suiteCapabilities.canUseRelay, onRelayPttEvent]);

  // Connect / disconnect relay audio when canUseRelay changes.
  useEffect(() => {
    // guildId is required: the bridge now scopes relay tokens per guild
    // and 400s without it. Skip connecting until a guild is selected,
    // otherwise the relay flips to "error" for a signed-in-but-no-guild user.
    if (
      !state.suiteCapabilities.canUseRelay ||
      !state.token ||
      !state.bridgeUrl ||
      !state.guildId
    ) {
      void relayRef.current?.disconnect();
      return;
    }
    if (!relayRef.current) {
      const r = new RelayAudio();
      r.setStatusListener((status) => setState((s) => ({ ...s, relayStatus: status })));
      relayRef.current = r;
    }
    void relayRef.current.connect(state.bridgeUrl, state.token, state.guildId);
  }, [state.suiteCapabilities.canUseRelay, state.token, state.bridgeUrl, state.guildId]);

  // ── Mission voice PTT (commander room = PTT-1 in mission mode) ────────
  const onCommanderPtt = useCallback((pressed: boolean) => {
    setState((s) => ({ ...s, commanderPttActive: pressed }));
    void missionCommanderRef.current?.setPttActive(pressed);
  }, []);

  // ── Mission disconnect ───────────────────────────────────────────────
  const onMissionDisconnect = useCallback(async () => {
    await missionCommanderRef.current?.disconnect();
    currentMissionCommanderRoomRef.current = null;
    missionOpIdRef.current = null;
    await clearMissionConfig();
    setState((s) => ({
      ...s,
      missionActive: false,
      missionOpTitle: null,
      missionHasCommander: false,
      commanderStatus: "idle",
      commanderPttActive: false,
      missionToken: null,
      missionUrl: null,
      missionEnded: false,
    }));
  }, []);

  // ── Apply fleet-voice deep link ──────────────────────────────────────
  const onMissionLinkApply = useCallback(async (token: string, url: string) => {
    await saveMissionConfig(token, url);
    setState((s) => ({ ...s, missionToken: token, missionUrl: url, missionEnded: false }));
    setShowMissionModal(false);
  }, []);

  // ── OS deep-link: rdoc://mission?token=…&url=… (or legacy dccc://) ────
  // Clicking a mission link (from Discord DM / browser) launches or
  // focuses the Companion and auto-applies the mission config — no paste.
  // Covers cold start (getCurrent) and while-running (onOpenUrl, forwarded
  // by the single-instance plugin on Windows). Both the new `rdoc://` and
  // the legacy `dccc://` schemes are accepted during the transition.
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    const applyRaw = (raw: string): void => {
      try {
        const normalized = raw.trim().replace(/^(dccc|rdoc):\/\//i, "https://link.local/");
        const u = new URL(normalized);
        const token = u.searchParams.get("token");
        const url = u.searchParams.get("url");
        if (token && url) void onMissionLinkApply(token, url);
      } catch {
        // not a mission link — ignore
      }
    };
    void (async () => {
      try {
        const current = await getCurrentDeepLinks();
        if (current) current.forEach(applyRaw);
      } catch {
        // not running under the Tauri deep-link plugin
      }
      try {
        const fn = await onOpenUrl((urls: string[]) => urls.forEach(applyRaw));
        if (active) unlisten = fn;
        else fn();
      } catch {
        // deep-link plugin unavailable
      }
    })();
    return () => {
      active = false;
      unlisten?.();
    };
  }, [onMissionLinkApply]);

  // ── Mission voice polling effect ─────────────────────────────────────
  useEffect(() => {
    if (!state.missionToken || !state.missionUrl) return;

    type MissionRoom = { room: string; token: string };
    type MissionVoiceResponse = {
      op: null | {
        opId: string;
        opTitle: string;
        livekitUrl: string;
        commanderRoom: MissionRoom | null;
      };
    };

    const poll = async (): Promise<void> => {
      const base = state.missionUrl!.replace(/\/+$/, "");
      try {
        const res = await fetch(`${base}/api/companion/mission-voice`, {
          headers: { Authorization: `Bearer ${state.missionToken}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as MissionVoiceResponse;

        const pinnedOpId = missionOpIdRef.current;
        // End the mission when EITHER there is no active op, OR the active
        // op is a DIFFERENT one than the one this link joined. The mission
        // token is not op-bound, so the backend would otherwise hand us the
        // NEXT active op and the app would silently hop missions. Closing a
        // mission must kick everyone out — not roll them onto another op.
        const missionEndedNow =
          !data.op || (pinnedOpId !== null && data.op.opId !== pinnedOpId);
        if (missionEndedNow) {
          // Only act if we had actually joined (pinned) — otherwise we're
          // just waiting for the linked op to open; keep polling silently.
          if (pinnedOpId !== null) {
            await missionCommanderRef.current?.disconnect();
            currentMissionCommanderRoomRef.current = null;
            missionOpIdRef.current = null;
            // Drop the token so polling stops — re-joining requires a fresh
            // mission link. Authorized users fall back to bridge mode (the
            // bridge↔mission audio effect resumes guild audio).
            await clearMissionConfig();
            setState((s) => ({
              ...s,
              missionActive: false,
              missionOpTitle: null,
              missionHasCommander: false,
              commanderStatus: "idle",
              commanderPttActive: false,
              missionToken: null,
              missionUrl: null,
              missionEnded: true,
            }));
          }
          return;
        }
        if (!data.op) return; // narrowing — handled above

        const { opId, opTitle, livekitUrl, commanderRoom } = data.op;
        // Pin the op on first successful poll so later polls can detect a
        // close/switch instead of following the backend onto the next op.
        missionOpIdRef.current = opId;

        // Commander room (only if returned)
        if (commanderRoom) {
          if (
            currentMissionCommanderRoomRef.current !== commanderRoom.room ||
            missionCommanderRef.current?.getStatus() === "idle"
          ) {
            if (!missionCommanderRef.current) {
              const fa = new FleetAudio();
              fa.setStatusListener((s) => setState((st) => ({ ...st, commanderStatus: s })));
              missionCommanderRef.current = fa;
            }
            await missionCommanderRef.current.connect(livekitUrl, commanderRoom.token);
            currentMissionCommanderRoomRef.current = commanderRoom.room;
          }
        } else if (missionCommanderRef.current?.getStatus() !== "idle") {
          await missionCommanderRef.current?.disconnect();
          currentMissionCommanderRoomRef.current = null;
        }

        setState((s) => ({
          ...s,
          missionActive: true,
          missionOpTitle: opTitle,
          missionHasCommander: Boolean(commanderRoom),
          missionEnded: false,
        }));
      } catch {
        // network error — retry on next tick
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), 30_000);
    return () => clearInterval(interval);
  }, [state.missionToken, state.missionUrl]);

  // ── Bridge ↔ Mission audio switch ────────────────────────────────────
  // LOCAL voice is a single channel: guild bridge room without a mission,
  // the commander room while a mission with a commander room is active.
  // When the mission takes over, suppress the guild-bridge LiveKit session
  // (disconnect playback + sending) so we truly SWITCH instead of layering
  // both rooms. On mission end, resume guild audio from the remembered
  // bridge creds. The bridge WS stays connected throughout (roster/status).
  useEffect(() => {
    const missionOwnsLocal = state.missionActive && state.missionHasCommander;
    // Only act on a real transition — not on every token/guildId change,
    // which would churn the (re)connect that bridge:joined already does.
    if (missionOwnsLocal === missionOwnsLocalRef.current) return;
    missionOwnsLocalRef.current = missionOwnsLocal;
    if (missionOwnsLocal) {
      void audioRef.current?.disconnect();
    } else if (lastBridgeCredsRef.current && state.token && state.guildId) {
      // Mission ended — resume guild audio from the remembered bridge creds.
      const { url, token } = lastBridgeCredsRef.current;
      audioRef.current
        ?.connect(url, token)
        .catch((err) => setState((s) => ({ ...s, lastError: `LiveKit: ${String(err)}` })));
    }
  }, [state.missionActive, state.missionHasCommander, state.token, state.guildId]);

  // NOTE: In mission mode PTT-1 (the commander room) is driven by the
  // primary `localHotkey` path — `handlePttEvent` branches to
  // `missionCommanderRef` when a mission with a commander room is active.
  // No separate mission hotkey registration is needed. PTT-2 (GLOBAL) is
  // the relay path handled by the relay hotkey listener above.

  const onSignOut = useCallback(async () => {
    await clearSession();
    void relayRef.current?.disconnect();
    setState((s) => ({
      ...s,
      token: null,
      guildId: null,
      guildName: null,
      activeCommanders: [],
      suiteCapabilities: DEFAULT_SUITE_CAPABILITIES,
      sessionId: null,
      sessionLabel: null,
    }));
  }, []);

  const onSettingsSave = useCallback(
    async (next: SettingsDraft) => {
      let nextBridgeUrl = state.bridgeUrl;
      let nextFleetplannerUrl = state.fleetplannerUrl;
      let nextLocalHotkey = state.localHotkey;
      let nextGlobalHotkey = state.globalHotkey;
      if (next.bridgeUrl !== state.bridgeUrl) {
        await saveBridgeUrl(next.bridgeUrl);
        wsRef.current?.setBridgeUrl(next.bridgeUrl);
        nextBridgeUrl = next.bridgeUrl;
      }
      if (next.fleetplannerUrl !== state.fleetplannerUrl) {
        await saveFleetplannerUrl(next.fleetplannerUrl);
        nextFleetplannerUrl = next.fleetplannerUrl;
      }
      if (next.localHotkey && next.localHotkey !== state.localHotkey) {
        try {
          await setupHotkey(next.localHotkey, handlePttEvent);
          await saveLocalHotkey(next.localHotkey);
          nextLocalHotkey = next.localHotkey;
        } catch (err) {
          setState((s) => ({ ...s, lastError: `Hotkey: ${String(err)}` }));
          setShowSettings(false);
          return;
        }
      }
      if (next.globalHotkey && next.globalHotkey !== state.globalHotkey) {
        await saveGlobalHotkey(next.globalHotkey);
        nextGlobalHotkey = next.globalHotkey;
      }

      // Audio prefs — persist + hot-apply to the running LiveKit session.
      const nextDevice: DeviceConfig = {
        micDeviceId: next.micDeviceId,
        outputDeviceId: next.outputDeviceId,
        outputVolumePct: next.outputVolumePct,
        micGainPct: next.micGainPct,
      };
      const audioChanged =
        nextDevice.micDeviceId !== state.device.micDeviceId ||
        nextDevice.outputDeviceId !== state.device.outputDeviceId ||
        nextDevice.outputVolumePct !== state.device.outputVolumePct ||
        nextDevice.micGainPct !== state.device.micGainPct;
      if (audioChanged) {
        await saveAudioPrefs({
          micDeviceId: nextDevice.micDeviceId,
          outputDeviceId: nextDevice.outputDeviceId,
          outputVolumePct: nextDevice.outputVolumePct,
          micGainPct: nextDevice.micGainPct,
        });
        await audioRef.current?.applyDeviceConfig(nextDevice);
      }

      // Feedback-sound prefs — apply live + persist.
      const feedbackChanged =
        next.feedbackSoundsEnabled !== state.feedbackSoundsEnabled ||
        next.feedbackSoundsVolumePct !== state.feedbackSoundsVolumePct;
      if (feedbackChanged) {
        feedbackAudio.setEnabled(next.feedbackSoundsEnabled);
        feedbackAudio.setVolumePct(next.feedbackSoundsVolumePct);
        await saveFeedbackSounds({
          enabled: next.feedbackSoundsEnabled,
          volumePct: next.feedbackSoundsVolumePct,
        });
      }

      // Ducking prefs — persist + safe-state-transition. If the user
      // disables ducking WHILE Discord is currently ducked, snap-restore
      // so Discord doesn't get stuck at the lowered level.
      const duckingChanged =
        next.duckingEnabled !== state.duckingEnabled ||
        next.duckingTargetVolumePct !== state.duckingTargetVolumePct;
      if (duckingChanged) {
        await saveDucking({
          enabled: next.duckingEnabled,
          targetVolumePct: next.duckingTargetVolumePct,
        });
        if (state.duckingEnabled && !next.duckingEnabled) {
          // turning ducking off — make sure Discord isn't left ducked
          void invoke("restore_discord_volume").catch(() => {});
        }
      }

      setState((s) => ({
        ...s,
        bridgeUrl: nextBridgeUrl,
        fleetplannerUrl: nextFleetplannerUrl,
        localHotkey: nextLocalHotkey,
        globalHotkey: nextGlobalHotkey,
        device: nextDevice,
        feedbackSoundsEnabled: next.feedbackSoundsEnabled,
        feedbackSoundsVolumePct: next.feedbackSoundsVolumePct,
        duckingEnabled: next.duckingEnabled,
        duckingTargetVolumePct: next.duckingTargetVolumePct,
        lastError: null,
      }));
      setShowSettings(false);
    },
    [
      state.bridgeUrl,
      state.fleetplannerUrl,
      state.localHotkey,
      state.globalHotkey,
      state.device,
      state.feedbackSoundsEnabled,
      state.feedbackSoundsVolumePct,
      state.duckingEnabled,
      state.duckingTargetVolumePct,
    ],
  );

  // Treat any persisted token as "signed in" for UI purposes. The
  // WS-status handler already clears the token + drops to the sign-in
  // form when the bridge rejects it (close code 4401 "unauthenticated"),
  // so a stale token won't pin the user on the roster — but a VALID
  // token that hasn't connected yet (cold start, network blip) also
  // shouldn't flash the sign-in form, because the user might click
  // it and trigger a needless second OAuth.
  const wsConnected = state.wsStatus === "connected";
  const signedIn = Boolean(state.token);
  const hasStoredToken = signedIn;
  const audioLive = state.audioStatus === "connected" && !state.pttActive;
  const audioTransmit = state.audioStatus === "connected" && state.pttActive;

  const audioBadgeTone = useMemo(() => {
    if (audioTransmit) return "green";
    if (audioLive) return "cyan";
    if (state.audioStatus === "error") return "red";
    return "dim";
  }, [audioLive, audioTransmit, state.audioStatus]);

  // ── Voice routing readout ──────────────────────────────────────────
  // LOCAL = PTT-1 target: the mission commander room when a mission with a
  // commander room is active, otherwise the session/guild bridge room.
  // GLOBAL = PTT-2 target: the Discord relay (independent of mission).
  const missionOwnsLocal = state.missionActive && state.missionHasCommander;
  const localRoomLabel = missionOwnsLocal
    ? `Commander · ${state.missionOpTitle ?? "Mission"}`
    : state.sessionId
      ? (state.sessionLabel ?? "Session")
      : (state.guildName ?? state.guildId ?? "Squad Link");
  const localConnected = missionOwnsLocal
    ? state.commanderStatus === "connected"
    : state.audioStatus === "connected";
  const localSpeaking = missionOwnsLocal ? state.commanderPttActive : state.pttActive;
  const relayAvailable = state.suiteCapabilities.canUseRelay;
  const globalConnected = state.relayStatus === "connected";
  const globalSpeaking = state.relayPttActive;
  const routingTone = (connected: boolean, speaking: boolean): string =>
    speaking ? "green" : connected ? "cyan" : "dim";

  return (
    <div className="cc-window">
      {/* ── Brand bar (replaces native chrome for now) ────── */}
      <header className="cc-modebar">
        <div className="cc-brand">
          <span className="brand-cy">RDOC</span>
          <span className="brand-sep">//</span>
          <span className="brand-gd">SQUAD LINK</span>
        </div>
        <div className="cc-modebar-right">
          <img
            className="cc-credit-stamp"
            src="/credits-stamp.svg"
            alt="raumdock.org - made by xheadwigx & justcallmedeimos - infrastructure powered by twitch.tv/justcallmedeimos"
          />
          {hasStoredToken ? (
            <button
              type="button"
              className="cc-btn ghost sm"
              onClick={() => setShowGuildPicker(true)}
              title="Anderen Server wählen ohne Discord-Re-Auth"
            >
              <Icon.users size={12} />
              SERVER WECHSELN
            </button>
          ) : null}
          {state.suiteCapabilities.canManageSessions ? (
            <button
              type="button"
              className="cc-btn ghost sm"
              onClick={onAdmiralClick}
              title="Session-Verwaltung im Web-Admin öffnen"
            >
              <Icon.key size={12} />
              ADMIRAL
            </button>
          ) : null}
          {signedIn && !state.sessionId ? (
            <button
              type="button"
              className="cc-btn ghost sm"
              onClick={() => {
                setSessionJoinError(null);
                setShowSessionJoin(true);
              }}
              title="Session via Invite-Token beitreten"
            >
              <Icon.key size={12} />
              SESSION
            </button>
          ) : null}
          {state.sessionId ? (
            <button
              type="button"
              className="cc-btn gold sm"
              onClick={onLeaveSession}
              title="Session verlassen und zurück zur Guild-Verbindung"
            >
              <Icon.power size={12} />
              SESSION VERLASSEN
            </button>
          ) : null}
          {state.suiteCapabilities.canUseRelay ? (
            <button
              type="button"
              className={`cc-btn ${state.relayPttActive ? "green" : state.relayStatus === "connected" ? "cyan" : "ghost"} sm`}
              title={`Voice-to-All (Global) · Hotkey ${state.globalHotkey} · ${state.relayStatus}`}
              onMouseDown={() =>
                onRelayPttEvent({ state: "pressed", accelerator: state.globalHotkey })
              }
              onMouseUp={() =>
                onRelayPttEvent({ state: "released", accelerator: state.globalHotkey })
              }
            >
              <Icon.radio size={12} />
              {state.relayPttActive ? "RELAY AKTIV" : "VOICE TO ALL"}
            </button>
          ) : null}
          {hasStoredToken ? (
            <button
              type="button"
              className={`cc-btn ${state.outputMuted ? "gold" : "ghost"} sm`}
              onClick={onToggleOutputMute}
              title={
                state.outputMuted
                  ? "Du hörst gerade niemanden — Klick zum Aufheben"
                  : "Output stummschalten — du hörst dann niemanden mehr (andere sehen das)"
              }
            >
              <Icon.volume size={12} />
              {state.outputMuted ? "MUTED" : "MUTE"}
            </button>
          ) : null}
          {hasStoredToken ? (
            <button
              type="button"
              className={`cc-btn ${state.afk ? "cyan" : "ghost"} sm`}
              onClick={onToggleAfk}
              title={
                state.afk
                  ? "Du bist auf AFK gesetzt — Klick zum Aufheben"
                  : "Als AFK markieren — andere sehen das im Roster"
              }
            >
              <Icon.users size={12} />
              {state.afk ? "AFK ✓" : "AFK"}
            </button>
          ) : null}
          {hasStoredToken ? (
            <button
              type="button"
              className="cc-btn ghost sm"
              onClick={onSignOut}
              title="Gespeicherte Sitzung löschen"
            >
              <Icon.power size={12} />
              ABMELDEN
            </button>
          ) : null}
          <button
            type="button"
            className={`cc-btn ${state.missionToken ? "cyan" : "ghost"} sm`}
            onClick={() => setShowMissionModal(true)}
            title="Fleet Voice Link einfügen / Mission Voice konfigurieren"
          >
            <Icon.radio size={12} />
            MISSION
          </button>
          <button
            type="button"
            className="cc-btn ghost sm"
            onClick={() => setShowSettings(true)}
            title="Einstellungen"
          >
            <Icon.settings size={12} />
          </button>
        </div>
      </header>

      {/* ── Mode banner ─────────────────────────────────────── */}
      <div className={`cc-mode-banner ${state.missionActive ? "mission" : "bridge"}`}>
        <Icon.radio size={10} />
        {state.missionActive ? "MISSION MODE" : "BRIDGE MODE"}
      </div>

      {/* ── Status strip ───────────────────────────────────── */}
      <section className="cc-status-strip">
        <span className="cc-status-stripe"></span>
        <span className={`cc-badge ${wsConnected ? "green" : "dim"}`}>
          <span className="cc-badge-dot" style={{ background: "currentColor" }}></span>
          {wsConnected ? "VERBUNDEN" : state.wsStatus.toUpperCase()}
        </span>
        <span className={`cc-badge ${audioBadgeTone}`}>
          {audioTransmit ? <Icon.mic size={11} /> : <Icon.micOff size={11} />}
          {audioTransmit ? "PTT AKTIV" : audioLive ? "AUDIO LIVE" : state.audioStatus.toUpperCase()}
        </span>
        <div className="cc-name-wrap">
          <span className="cc-name-label">{state.sessionId ? "SESSION" : "SERVER"}</span>
          <span
            className="cc-readout"
            style={{ padding: "4px 9px", fontSize: 11 }}
            title={state.sessionId ?? state.guildId ?? undefined}
          >
            {state.sessionId
              ? (state.sessionLabel ?? state.sessionId)
              : (state.guildName ?? state.guildId ?? "—")}
          </span>
        </div>
      </section>

      {/* ── Voice routing: connected room + speaking target ─── */}
      {signedIn || state.missionActive ? (
        <section className="cc-status-strip" style={{ flexWrap: "wrap", gap: 8 }}>
          <span className="cc-name-label">FUNK</span>
          <span
            className={`cc-badge ${routingTone(localConnected, localSpeaking)}`}
            title={`PTT-1 (${state.localHotkey}) → ${localRoomLabel}`}
          >
            {localSpeaking ? <Icon.mic size={11} /> : <Icon.radio size={11} />}
            LOKAL · {localRoomLabel}
            {localSpeaking ? " · SENDEND" : localConnected ? " · verbunden" : " · —"}
            <span style={{ opacity: 0.6, marginLeft: 4 }}>[{state.localHotkey}]</span>
          </span>
          {relayAvailable ? (
            <span
              className={`cc-badge ${routingTone(globalConnected, globalSpeaking)}`}
              title={`PTT-2 (${state.globalHotkey}) → Discord-Relay (alle Kanäle)`}
            >
              {globalSpeaking ? <Icon.mic size={11} /> : <Icon.radio size={11} />}
              GLOBAL · Discord-Relay
              {globalSpeaking ? " · SENDEND" : globalConnected ? " · verbunden" : " · —"}
              <span style={{ opacity: 0.6, marginLeft: 4 }}>[{state.globalHotkey}]</span>
            </span>
          ) : null}
        </section>
      ) : null}

      {/* ── Body ───────────────────────────────────────────── */}
      <main className="cc-window-body">
        {state.lastError ? (
          <div className="cc-banner error">
            <Icon.x size={12} />
            {state.lastError}
          </div>
        ) : null}
        {!state.lastError && audioTransmit ? (
          <div className="cc-banner info">
            <Icon.radio size={12} />
            Squad Link aktiv — die anderen Commander hören dich.
          </div>
        ) : null}
        {state.missionEnded && !state.missionActive ? (
          <div className="cc-banner info">
            <Icon.x size={12} />
            MISSION BEENDET — Voice-Session wurde getrennt.
          </div>
        ) : null}
        {state.missionActive ? (
          <MissionVoicePanel
            opTitle={state.missionOpTitle}
            commanderStatus={state.commanderStatus}
            commanderPttActive={state.commanderPttActive}
            hasCommanderRoom={state.missionHasCommander}
            onCommanderPtt={onCommanderPtt}
            onDisconnect={() => void onMissionDisconnect()}
            localHotkey={state.localHotkey}
            globalHotkey={state.globalHotkey}
            relayAvailable={state.suiteCapabilities.canUseRelay}
          />
        ) : null}

        {!signedIn ? (
          // ────────── Disconnected: sign-in panel ──────────
          <section className="cc-card cc-fade-in">
            <span className="cc-card-tick"></span>
            <div className="cc-card-title">
              <span>VERBINDUNG // BRIDGE</span>
            </div>

            <div className="cc-field">
              <label className="cc-label">Bridge</label>
              <span className="cc-readout" title={state.bridgeUrl}>
                <span className="lbl">URL</span>
                <span
                  className="val"
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {state.bridgeUrl}
                </span>
                <button
                  type="button"
                  className="cc-btn ghost sm"
                  onClick={() => setShowSettings(true)}
                  title="Bridge-URL ändern"
                >
                  <Icon.settings size={11} />
                </button>
              </span>
            </div>

            {lastGuildId ? (
              <div className="cc-field" style={{ marginTop: 10 }}>
                <label className="cc-label">Letzter Server</label>
                <span className="cc-readout" title={lastGuildId}>
                  <span className="lbl">ID</span>
                  <span
                    className="val"
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {savedGuilds.find((g) => g.id === lastGuildId)?.label ?? lastGuildId}
                  </span>
                </span>
              </div>
            ) : null}

            <div className="cc-col" style={{ gap: 8, marginTop: 12 }}>
              <button
                type="button"
                className="cc-btn green full lg"
                onClick={onSignIn}
                disabled={!state.bridgeUrl}
                title={!state.bridgeUrl ? "Erst Bridge-URL in den Einstellungen setzen" : undefined}
              >
                <Icon.key size={14} />
                {savedGuilds.length > 0 ? "SERVER WÄHLEN + ANMELDEN" : "MIT DISCORD ANMELDEN"}
              </button>
            </div>
          </section>
        ) : (
          // ────────── Connected: mic + roster ──────────
          <section className="cc-2col cc-fade-in">
            <div className="cc-card">
              <span className="cc-card-tick"></span>
              <div className="cc-card-title">
                <span>SQUAD ROSTER</span>
                <span className="cc-badge dim">{state.activeCommanders.length}</span>
              </div>
              {state.activeCommanders.length === 0 ? (
                <div className="cc-hint" style={{ padding: "12px 0", textAlign: "center" }}>
                  — niemand verbunden —
                </div>
              ) : (
                <div className="cc-col" style={{ gap: 4 }}>
                  {state.activeCommanders.map((c) => {
                    // Don't show the volume slider for yourself — your
                    // own track isn't played back locally.
                    const isSelf = state.token && c.userId === jwtSubject(state.token);
                    const vol = remoteVolumes[c.userId] ?? 100;
                    return (
                      <div key={c.userId} className={`cc-prow ${c.speaking ? "speaking" : ""}`}>
                        <span className="cc-prow-tick"></span>
                        <div className="cc-avatar">
                          {c.speaking ? <Icon.mic size={14} /> : <Icon.headphones size={14} />}
                        </div>
                        <div className="cc-prow-name">{c.displayName ?? c.userId}</div>
                        {!isSelf ? (
                          <div className="cc-prow-vol" title={`Lautstärke ${vol}%`}>
                            <Icon.volume size={11} />
                            <input
                              type="range"
                              className="cc-range cc-range-sm"
                              min={0}
                              max={100}
                              step={5}
                              value={vol}
                              onChange={(e) =>
                                onRemoteVolumeChange(c.userId, Number(e.target.value))
                              }
                            />
                            <span className="cc-prow-vol-val">{vol}%</span>
                          </div>
                        ) : null}
                        <div className="cc-prow-state">
                          {c.afk ? (
                            <span className="cc-badge cyan" style={{ marginRight: 6 }}>
                              AFK
                            </span>
                          ) : null}
                          {c.outputMuted ? (
                            <span className="cc-badge gold" style={{ marginRight: 6 }}>
                              MUTED
                            </span>
                          ) : null}
                          {c.speaking ? "TALKING" : "IDLE"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="cc-card">
              <span className="cc-card-tick"></span>
              <div className="cc-card-title">
                <span>PTT</span>
              </div>
              <div className="cc-col" style={{ alignItems: "center", gap: 14, padding: "8px 0" }}>
                <div
                  className={`cc-mic-orb ${audioTransmit ? "live" : state.audioStatus === "error" ? "muted" : ""}`}
                >
                  {audioTransmit ? <Icon.mic size={36} /> : <Icon.micOff size={36} />}
                </div>
                <div
                  className="cc-ptt-key"
                  style={{
                    padding: "4px 9px",
                    border: "1px solid var(--border)",
                    background: "var(--bg3)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    letterSpacing: "1.5px",
                    color: "var(--dim)",
                  }}
                >
                  HOLD <span style={{ color: "var(--cyan)" }}>{state.localHotkey}</span>
                </div>
                {state.wsDetail ? (
                  <div className="cc-hint" style={{ fontSize: 10 }}>
                    {state.wsDetail}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="cc-window-footer">
        <span title={longVersion()}>RDOC SQUAD LINK · {shortVersion()}</span>
        <span>made by @xheadwix&nbsp;&nbsp;//&nbsp;&nbsp;o7</span>
      </footer>

      {showSettings ? (
        <SettingsModal
          initial={{
            bridgeUrl: state.bridgeUrl,
            fleetplannerUrl: state.fleetplannerUrl,
            localHotkey: state.localHotkey,
            globalHotkey: state.globalHotkey,
            micDeviceId: state.device.micDeviceId,
            outputDeviceId: state.device.outputDeviceId,
            outputVolumePct: state.device.outputVolumePct,
            micGainPct: state.device.micGainPct,
            feedbackSoundsEnabled: state.feedbackSoundsEnabled,
            feedbackSoundsVolumePct: state.feedbackSoundsVolumePct,
            duckingEnabled: state.duckingEnabled,
            duckingTargetVolumePct: state.duckingTargetVolumePct,
          }}
          canUseRelay={state.suiteCapabilities.canUseRelay}
          onSave={onSettingsSave}
          onClose={() => setShowSettings(false)}
        />
      ) : null}

      {showGuildPicker ? (
        <GuildPickerModal
          savedGuilds={savedGuilds}
          lastGuildId={lastGuildId}
          bridgeUrlConfigured={Boolean(state.bridgeUrl)}
          onConfirm={onGuildConfirm}
          onRemoveSaved={onGuildsUpdate}
          onUpsertSaved={onGuildsUpdate}
          onClose={() => setShowGuildPicker(false)}
        />
      ) : null}

      {updateOffer ? (
        <UpdateModal
          remote={updateOffer.remote}
          bridgeUrl={state.bridgeUrl}
          sessionToken={state.token}
          onPostpone={() => setUpdateOffer(null)}
        />
      ) : null}

      {showSessionJoin ? (
        <SessionJoinModal
          onConfirm={onSessionJoinConfirm}
          onClose={() => setShowSessionJoin(false)}
          error={sessionJoinError}
          loading={sessionJoinLoading}
        />
      ) : null}
      {showMissionModal ? (
        <MissionLinkModal
          onApply={(token, url) => void onMissionLinkApply(token, url)}
          onClose={() => setShowMissionModal(false)}
        />
      ) : null}
    </div>
  );
}
