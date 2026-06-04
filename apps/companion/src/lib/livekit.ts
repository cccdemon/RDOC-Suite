import {
  Room,
  RoomEvent,
  Track,
  type LocalAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
} from "livekit-client";
import { info, warn, error as logError } from "@tauri-apps/plugin-log";

export type AudioStatus = "idle" | "connecting" | "connected" | "error";

/** One remote participant in the room (self excluded). userId is the LiveKit
 *  participant name (the app sets name=userId), falling back to identity. */
export type RosterEntry = { userId: string; speaking: boolean };

type Listeners = {
  status?: (status: AudioStatus, detail?: string) => void;
  participantsChanged?: (count: number) => void;
  /** Fires whenever the remote-participant set or their speaking state
   *  changes, so callers can render a live roster (mission commander room). */
  rosterChanged?: (entries: RosterEntry[]) => void;
};

export type DeviceConfig = {
  /** Browser deviceId for the capture device. undefined = OS default. */
  micDeviceId?: string;
  /** Browser deviceId for playback. undefined = OS default. */
  outputDeviceId?: string;
  /** 0..100. Applied to every attached <audio> element. */
  outputVolumePct: number;
  /** 0..200. Routes mic through a Web Audio GainNode (gain = pct/100). */
  micGainPct: number;
};

const DEFAULT_DEVICE_CONFIG: DeviceConfig = {
  outputVolumePct: 100,
  micGainPct: 100,
};

type AttachedRemote = {
  /** Single <audio> element returned by track.attach(). Owns BOTH
   *  the WebRTC sink (srcObject) and the audible output. Per-user
   *  volume is the element's `.volume` (0..1) multiplied with the
   *  global output volume; output device routing is `setSinkId`. */
  element: HTMLAudioElement;
  /** Discord userId — key in the outer Map + the persistence map. */
  userId: string;
};

export class LivekitAudio {
  private room: Room | null = null;
  private localTrack: LocalAudioTrack | null = null;
  private listeners: Listeners = {};
  private deviceConfig: DeviceConfig = { ...DEFAULT_DEVICE_CONFIG };
  /** Keyed by Discord userId (resolved from participant.name). */
  private attachedRemotes = new Map<string, AttachedRemote>();
  /** Per-userId volume override (0..200, 100 = unity). Applied to
   *  newly-subscribed tracks at attach time so a returning user gets
   *  their previous level back. */
  private remoteVolumes = new Map<string, number>();
  /** Reference to the mic-gain audio chain so we can update it live. */
  private gainNode: GainNode | null = null;
  private audioCtx: AudioContext | null = null;
  /** When true, every attached remote `<audio>` element is muted (user
   *  has self-muted INCOMING audio). New tracks subscribed while in
   *  this state are muted immediately at attach time. */
  private outputMuted = false;
  /** userIds (participant.name||identity) currently flagged speaking by the
   *  last ActiveSpeakersChanged event. Drives the roster's speaking dots. */
  private speakingUserIds = new Set<string>();

  /** Publish-only mode: connect with autoSubscribe disabled and never attach
   *  remote audio. Used for the mission Relay room (Global Radio Net), which is
   *  a publish-only input for the RelayBots — companions must NOT hear each
   *  other directly there, otherwise a global speaker is heard twice (once via
   *  the RelayBot in the Discord channel, once directly via LiveKit). The
   *  Command Net (commander room) keeps the default subscribe behaviour. */
  constructor(private readonly publishOnly = false) {}

  /** Toggle the output (receive) mute.
   *
   *  Build-107 went the "set `<audio>.muted=true`" route, but live test
   *  showed that fails after the first peer PTT cycle — livekit-client
   *  handles track-state changes in ways that bypass our element-level
   *  mute (no TrackMuted/TrackUnmuted ever fires in the log, yet the
   *  user hears the peer). Switching strategy: UNSUBSCRIBE every remote
   *  audio publication while muted, RESUBSCRIBE on unmute. No audio
   *  data reaches us at all, regardless of what livekit does with
   *  attached <audio> elements internally.
   *
   *  Element-level mute is still set as a fast-path so the silence is
   *  instantaneous even before the unsubscribe round-trip completes.
   *
   *  Roster speaking-state is unaffected: that flows over commander:list
   *  from the bridge, not over the audio track. */
  setOutputMuted(muted: boolean): void {
    this.outputMuted = muted;
    // Fast-path: silence already-attached elements instantly.
    const tracked = this.applyOutputMuteToAttached();
    // Authoritative: toggle subscriptions on every remote audio track.
    let toggled = 0;
    if (this.room) {
      for (const participant of this.room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          if (publication.kind !== Track.Kind.Audio) continue;
          try {
            publication.setSubscribed(!muted);
            toggled++;
          } catch (e) {
            void warn(
              `[livekit] setSubscribed(${!muted}) failed for ${participant.identity}: ${String(e)}`,
            );
          }
        }
      }
    }
    void info(
      `[livekit] setOutputMuted(${muted}) tracked=${tracked} subscribe-toggled=${toggled}`,
    );
  }

  /** Re-applies the current outputMuted flag to every attached remote
   *  element. Cheap and idempotent. Still kept for the TrackMuted/
   *  TrackUnmuted event paths even though those don't always fire —
   *  when they do, this is a fast safety net. */
  private reassertOutputMute(): void {
    if (!this.outputMuted) return;
    this.applyOutputMuteToAttached();
  }

  private applyOutputMuteToAttached(): number {
    const globalPct = clampPct(this.deviceConfig.outputVolumePct);
    let count = 0;
    for (const remote of this.attachedRemotes.values()) {
      remote.element.muted = this.outputMuted;
      if (this.outputMuted) {
        remote.element.volume = 0;
      } else {
        const userPct = clampPct(this.remoteVolumes.get(remote.userId) ?? 100);
        remote.element.volume = (userPct / 100) * (globalPct / 100);
      }
      count++;
    }
    return count;
  }

  setListeners(listeners: Listeners): void {
    this.listeners = listeners;
  }

  /** Per-user volume preference (0..100). Persists locally — caller
   *  takes care of storing this in the Tauri settings store. Applied
   *  to currently-attached audio + remembered for future joins.
   *  Folded with the global output volume so the element's .volume
   *  reflects (per-user × global). */
  setRemoteVolume(userId: string, pct: number): void {
    const v = clampPct(pct);
    this.remoteVolumes.set(userId, v);
    const remote = this.attachedRemotes.get(userId);
    if (remote && !this.outputMuted) {
      // Don't override the zero-volume that setOutputMuted set if the
      // user is muted right now — re-applies on unmute.
      const globalPct = clampPct(this.deviceConfig.outputVolumePct);
      remote.element.volume = (v / 100) * (globalPct / 100);
    }
  }

  /** Bulk init from the persisted map. Called once on mount before
   *  the first LiveKit connect, so any subscribed track picks up the
   *  saved volume at attach time. */
  setRemoteVolumes(map: Record<string, number>): void {
    this.remoteVolumes.clear();
    for (const [userId, pct] of Object.entries(map)) {
      this.remoteVolumes.set(userId, clampPct(pct));
    }
    if (this.outputMuted) return; // mute wins; volumes re-apply on unmute
    const globalPct = clampPct(this.deviceConfig.outputVolumePct);
    for (const [userId, remote] of this.attachedRemotes.entries()) {
      const pct = this.remoteVolumes.get(userId) ?? 100;
      remote.element.volume = (pct / 100) * (globalPct / 100);
    }
  }

  /** Replace the current device config and apply changes live: switch
   *  remote-element sinks + volume immediately, rebuild the mic capture
   *  if the capture device changed, and update the gain node otherwise. */
  async applyDeviceConfig(next: DeviceConfig): Promise<void> {
    const prev = this.deviceConfig;
    this.deviceConfig = { ...next };

    // Apply combined per-user × global to each element's .volume, and
    // re-route to the user's chosen output device. When output-mute
    // is on, leave .volume at 0 (setOutputMuted owns it until unmute).
    const globalPct = clampPct(next.outputVolumePct);
    for (const [userId, remote] of this.attachedRemotes.entries()) {
      if (!this.outputMuted) {
        const userPct = this.remoteVolumes.get(userId) ?? 100;
        remote.element.volume = (userPct / 100) * (globalPct / 100);
      }
      if (next.outputDeviceId && supportsSetSinkId(remote.element)) {
        try {
          await remote.element.setSinkId(next.outputDeviceId);
        } catch {
          // device unplugged / permission revoked — keep on default
        }
      }
    }

    // Mic gain — three cases:
    //   • chain already installed → just rewrite gain.value (live, cheap)
    //   • no chain, user wants unity (100%) → nothing to do
    //   • no chain, user wants non-unity → install now (one-time cost,
    //     causes a brief renegotiation as the published track is replaced)
    const wantGain = clampGain(next.micGainPct);
    if (this.gainNode) {
      this.gainNode.gain.value = wantGain / 100;
    } else if (wantGain !== 100 && this.localTrack) {
      await this.installMicGain(this.localTrack);
    }

    // Mic device — switching requires re-acquiring the capture track,
    // which only matters when LiveKit is currently connected. If the
    // device id actually changed, hot-swap.
    if (this.room && prev.micDeviceId !== next.micDeviceId) {
      try {
        await this.room.switchActiveDevice("audioinput", next.micDeviceId ?? "default");
      } catch {
        // LiveKit will keep using the previous device; nothing fatal.
      }
    }
  }

  async connect(url: string, token: string): Promise<void> {
    void info(`[livekit] connect → ${url}`);
    if (this.room) {
      void info("[livekit] tearing down previous room before reconnect");
      await this.disconnect();
    }
    this.emitStatus("connecting");

    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        // AGC ON: pegelt zu leise Mics automatisch hoch, drosselt
        // laute. Bis wir den mic-gain-Slider WebView2-kompatibel
        // wieder einschalten, ist das die zuverlässigste Variante,
        // damit alle auf einem ähnlichen Lautstärke-Niveau ankommen.
        autoGainControl: true,
        // Honour the user's mic-device pick at connect time. If undefined,
        // LiveKit asks the browser for "default" which is what we want.
        ...(this.deviceConfig.micDeviceId ? { deviceId: this.deviceConfig.micDeviceId } : {}),
      },
    });

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      this.speakingUserIds = new Set(speakers.map((s) => s.name || s.identity).filter(Boolean));
      this.emitRoster();
    });
    room.on(RoomEvent.ParticipantConnected, (p) => {
      void info(`[livekit] participant connected: identity=${p.identity} name=${p.name}`);
      this.listeners.participantsChanged?.(room.numParticipants);
      this.emitRoster();
      // If we're output-muted, prevent the auto-subscribe from kicking
      // in for this newcomer's existing audio tracks. New tracks they
      // publish AFTER joining are caught by the TrackPublished handler.
      if (this.outputMuted) {
        for (const pub of p.trackPublications.values()) {
          if (pub.kind === Track.Kind.Audio) {
            try {
              pub.setSubscribed(false);
            } catch (e) {
              void warn(`[livekit] auto-unsubscribe-on-connect failed: ${String(e)}`);
            }
          }
        }
      }
    });
    room.on(RoomEvent.ParticipantDisconnected, (p) => {
      void info(`[livekit] participant disconnected: identity=${p.identity}`);
      this.listeners.participantsChanged?.(room.numParticipants);
      this.speakingUserIds.delete(p.name || p.identity);
      this.emitRoster();
    });
    room.on(RoomEvent.Disconnected, (reason) => {
      void info(`[livekit] room disconnected, reason=${String(reason)}`);
      this.emitStatus("idle");
    });
    // Belt-and-suspenders for the rare case the events DO fire on a
    // peer track-state change. Authority is unsubscribe; this just
    // catches anything that slips past in the brief window before the
    // unsubscribe-on-mute round-trip lands.
    room.on(RoomEvent.TrackMuted, () => this.reassertOutputMute());
    room.on(RoomEvent.TrackUnmuted, () => this.reassertOutputMute());
    // New publication after the participant was already connected (mid-
    // session add). Unsubscribe immediately if we're muted, otherwise
    // let the auto-subscribe + TrackSubscribed pipeline take over.
    room.on(RoomEvent.TrackPublished, (publication, participant) => {
      void info(
        `[livekit] track published kind=${publication.kind} by ${participant.identity}`,
      );
      if (this.outputMuted && publication.kind === Track.Kind.Audio) {
        try {
          publication.setSubscribed(false);
        } catch (e) {
          void warn(`[livekit] auto-unsubscribe-on-publish failed: ${String(e)}`);
        }
      }
    });
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      // Publish-only rooms must never play remote audio (defence-in-depth on
      // top of autoSubscribe:false). See the publishOnly field.
      if (this.publishOnly) return;
      // Self-hearing diagnostic: an SFU should never deliver our own
      // published track back to us, but if it ever does (LiveKit bug,
      // identity-suffix race during fast PTT cycles, weird relay
      // config) we want loud evidence in the log instead of a silent
      // echo of the user's own voice.
      const localIdentity = room.localParticipant.identity;
      const localName = room.localParticipant.name;
      const isSelfByIdentity = participant.identity === localIdentity;
      const isSelfByName = !!localName && participant.name === localName;
      void info(
        `[livekit] track subscribed kind=${track.kind} from identity=${participant.identity} name=${participant.name} (local identity=${localIdentity} name=${localName} isSelfByIdentity=${isSelfByIdentity} isSelfByName=${isSelfByName})`,
      );
      if (isSelfByIdentity || isSelfByName) {
        void warn(
          `[livekit] REFUSING to attach a track that appears to belong to the local participant — this is a self-hearing protection. If you can hear yourself anyway, the source is not LiveKit (likely Discord echoing your mic back, or an OS-side audio loopback like Stereo Mix).`,
        );
        return;
      }
      if (track.kind === Track.Kind.Audio) {
        this.attachRemoteAudio(track, participant);
      }
    });
    room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      void info(`[livekit] track unsubscribed kind=${track.kind} from ${participant.identity}`);
      this.detachRemoteAudio(track, participant);
    });

    try {
      // Explicit ICE config: WebView2 in Tauri-production sometimes does
      // not collect srflx candidates by itself, leaving the connection
      // with only filtered host candidates. Public STUN servers give the
      // browser its reflexive address; openrelay TURN is a no-auth-needed
      // free fallback when direct UDP/TCP can't traverse NAT.
      await room.connect(url, token, {
        // Publish-only (relay) rooms never subscribe — the RelayBots are the
        // only legitimate consumers; a subscribing companion would hear global
        // speakers twice (RelayBot + direct LiveKit).
        autoSubscribe: !this.publishOnly,
        rtcConfig: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun.cloudflare.com:3478" },
            {
              urls: [
                "turn:openrelay.metered.ca:80",
                "turn:openrelay.metered.ca:443",
                "turn:openrelay.metered.ca:443?transport=tcp",
              ],
              username: "openrelayproject",
              credential: "openrelayproject",
            },
          ],
          iceTransportPolicy: "all",
        },
      });
      // Publish the mic up-front but muted so PTT can toggle audio in/out
      // without paying the ICE/DTLS handshake cost on every key tap.
      await room.localParticipant.setMicrophoneEnabled(true);
      const pub = room.localParticipant.audioTrackPublications.values().next().value;
      if (pub?.track && "kind" in pub.track && pub.track.kind === Track.Kind.Audio) {
        this.localTrack = pub.track as LocalAudioTrack;
        const mst = this.localTrack.mediaStreamTrack;
        void info(
          `[livekit] mic published — track sid=${this.localTrack.sid} mediaStreamTrack id=${mst?.id} enabled=${mst?.enabled} muted=${mst?.muted} label="${mst?.label}"`,
        );
        await this.localTrack.mute();
        void info(`[livekit] mic muted (PTT idle, ready)`);
        await this.installMicGain(this.localTrack);
      } else {
        void warn(`[livekit] setMicrophoneEnabled returned but no audio track publication found`);
      }
      this.room = room;
      this.emitStatus("connected");
      this.listeners.participantsChanged?.(room.numParticipants);
      this.emitRoster();
      void info(
        `[livekit] connected → ${room.numParticipants} participant(s), local sid=${room.localParticipant.sid} identity=${room.localParticipant.identity} name=${room.localParticipant.name}`,
      );
    } catch (err) {
      this.emitStatus("error", String(err));
      void logError(`[livekit] connect failed: ${String(err)}`);
      throw err;
    }
  }

  async setMuted(muted: boolean): Promise<void> {
    if (!this.localTrack) return;
    void info(`[livekit] local mic ${muted ? "MUTED" : "UNMUTED"}`);
    if (muted) {
      await this.localTrack.mute();
    } else {
      await this.localTrack.unmute();
    }
  }

  async disconnect(): Promise<void> {
    if (this.localTrack) {
      this.localTrack = null;
    }
    if (this.room) {
      const r = this.room;
      this.room = null;
      await r.disconnect();
    }
    this.tearDownMicGain();
    // Remove ONLY this instance's attached <audio> elements. A global
    // querySelectorAll("audio[data-dccc-track]") would also nuke the elements
    // owned by a *coexisting* LivekitAudio instance — in mission mode the
    // bridge/guild room and the mission commander room run side by side, so
    // tearing down one room would silence the other (one-way audio: you keep
    // publishing but stop hearing the remote). Scope cleanup to attachedRemotes.
    for (const remote of this.attachedRemotes.values()) {
      remote.element.srcObject = null;
      remote.element.remove();
    }
    this.attachedRemotes.clear();
    this.speakingUserIds.clear();
    this.listeners.rosterChanged?.([]);
    this.emitStatus("idle");
  }

  isConnected(): boolean {
    return this.room?.state === "connected";
  }

  /** Wraps the published mic track in `Web Audio -> GainNode -> destination`
   *  so the user-configured mic-gain (0..200%) takes effect on the wire.
   *  LiveKit doesn't expose a built-in pre-publish gain control — running
   *  through a GainNode + replacing the published track is the canonical
   *  workaround.
   *
   *  TEMPORARILY DISABLED: the Web Audio mic-gain chain silenced
   *  published audio in WebView2 (same WebRTC + Web Audio interop
   *  fragility that broke remote playback earlier). Until we have
   *  a proven WebView2-compatible path, mic-gain is a no-op and the
   *  raw mic track is always published. The Settings slider for
   *  mic-gain stays in the UI for now but has no effect — re-enable
   *  when we find a working amplification path. */
  private async installMicGain(_track: LocalAudioTrack): Promise<void> {
    const gainPct = clampGain(this.deviceConfig.micGainPct);
    void info(`[livekit] installMicGain skipped (gainPct=${gainPct}) — feature disabled until WebView2 gain pipeline works`);
  }

  private tearDownMicGain(): void {
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
    this.gainNode = null;
  }

  /** Wire a freshly-subscribed remote audio track through a per-user
   *  GainNode so the user can balance individual voices. Replaces the
   *  default `track.attach()` flow because that flow only exposes
   *  `element.volume` (0..1) — we need 0..200%.
   *
   *  The participant.name field carries the Discord userId (the
   *  livekit identity has a random suffix to dodge duplicate-identity
   *  races on fast PTT cycles; the name doesn't). When we can't
   *  resolve a userId, fall back to the identity so balancing still
   *  works on a per-LiveKit-participant basis. */
  private attachRemoteAudio(track: RemoteTrack, participant: RemoteParticipant): void {
    const userId = participant.name || participant.identity;
    if (!userId) return;
    const mediaStreamTrack = track.mediaStreamTrack;
    if (!mediaStreamTrack) return;

    // Tear down any prior attachment for this user (e.g. they
    // reconnected with a fresh livekit identity but same userId).
    this.detachRemoteAudioByUserId(userId);

    // Plain track.attach() + element.volume. Web Audio interop with
    // WebView2's WebRTC remote streams is too fragile (multiple
    // failed attempts: createMediaElementSource silences, primer
    // muting leaks, ctx.destination doesn't always route). For now
    // we accept the 0..100% per-user range and use the element's
    // own volume slider — which is rock-solid.
    const element = track.attach() as HTMLAudioElement;
    element.dataset.dcccTrack = userId;
    document.body.appendChild(element);

    // Effective volume = per-user × global, both 0..1. Zeroed when
    // output-mute is on, matching setOutputMuted's belt-and-suspenders.
    const userPct = clampPct(this.remoteVolumes.get(userId) ?? 100);
    const globalPct = clampPct(this.deviceConfig.outputVolumePct);
    const baseVolume = (userPct / 100) * (globalPct / 100);
    element.volume = this.outputMuted ? 0 : baseVolume;
    element.muted = this.outputMuted;

    if (this.deviceConfig.outputDeviceId && supportsSetSinkId(element)) {
      element.setSinkId(this.deviceConfig.outputDeviceId).catch((e) => {
        void warn(`[livekit] setSinkId failed for ${userId}: ${String(e)}`);
      });
    }

    void info(
      `[livekit] attached remote audio for ${userId} (user=${userPct}% × global=${globalPct}% = element.volume=${element.volume.toFixed(2)})`,
    );

    this.attachedRemotes.set(userId, { element, userId });
  }

  private detachRemoteAudio(track: RemoteTrack, participant: RemoteParticipant): void {
    const userId = participant.name || participant.identity;
    if (userId) {
      this.detachRemoteAudioByUserId(userId);
    }
    // Also clean up any default-attached elements (the Web Audio
    // fallback path above).
    track.detach().forEach((el) => el.remove());
  }

  private detachRemoteAudioByUserId(userId: string): void {
    const existing = this.attachedRemotes.get(userId);
    if (!existing) return;
    existing.element.srcObject = null;
    existing.element.remove();
    this.attachedRemotes.delete(userId);
  }

  private emitStatus(status: AudioStatus, detail?: string): void {
    this.listeners.status?.(status, detail);
  }

  /** Build the current remote roster (self excluded) and emit it. Called on
   *  every participant join/leave, track sub/unsub, and active-speaker change. */
  private emitRoster(): void {
    if (!this.listeners.rosterChanged) return;
    // Dedup by userId: during a fast reconnect a user briefly has two LiveKit
    // participants (old identity-suffix not yet evicted, new one joined). The
    // name (=userId) is stable, so collapse them to avoid a duplicate roster row.
    const byUser = new Map<string, RosterEntry>();
    if (this.room) {
      for (const p of this.room.remoteParticipants.values()) {
        const userId = p.name || p.identity;
        if (!userId) continue;
        const speaking = this.speakingUserIds.has(userId);
        const existing = byUser.get(userId);
        if (existing) existing.speaking = existing.speaking || speaking;
        else byUser.set(userId, { userId, speaking });
      }
    }
    this.listeners.rosterChanged([...byUser.values()]);
  }
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
function clampGain(n: number): number {
  return Math.max(0, Math.min(300, Math.round(n)));
}
function supportsSetSinkId(
  el: HTMLAudioElement,
): el is HTMLAudioElement & { setSinkId: (id: string) => Promise<void> } {
  return typeof (el as unknown as { setSinkId?: unknown }).setSinkId === "function";
}
