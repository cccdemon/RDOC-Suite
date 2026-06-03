import { LivekitAudio, type DeviceConfig, type RosterEntry } from "./livekit";

export type FleetStatus = "idle" | "connecting" | "connected" | "error";
export type { RosterEntry } from "./livekit";

type StatusListener = (status: FleetStatus, detail?: string) => void;
type RosterListener = (entries: RosterEntry[]) => void;

/**
 * Manages a dedicated LiveKit connection for fleet operation unit rooms.
 * Unlike RelayAudio, the token is provided directly by the caller
 * (obtained from GET /api/ops/:id/voice-token on the fleetplanner) rather
 * than fetched from the bridge.
 */
export class FleetAudio {
  private audio = new LivekitAudio();
  private status: FleetStatus = "idle";
  private statusListener: StatusListener | null = null;
  private participantsListener: ((count: number) => void) | null = null;
  private rosterListener: RosterListener | null = null;
  private participantCount = 0;

  private wireListeners(): void {
    this.audio.setListeners({
      status: (s, detail) => {
        const mapped: FleetStatus =
          s === "connected" ? "connected" :
          s === "connecting" ? "connecting" :
          s === "error" ? "error" : "idle";
        if (this.status !== mapped) {
          this.status = mapped;
          this.statusListener?.(mapped, detail);
        }
      },
      participantsChanged: (count) => {
        this.participantCount = count;
        this.participantsListener?.(count);
      },
      rosterChanged: (entries) => {
        this.rosterListener?.(entries);
      },
    });
  }

  setStatusListener(fn: StatusListener): void {
    this.statusListener = fn;
    this.wireListeners();
  }

  /** Number of OTHER participants in the room (excludes self). */
  setParticipantsListener(fn: (count: number) => void): void {
    this.participantsListener = fn;
  }

  /** Live roster of OTHER participants (userId + speaking) for the commander
   *  room — lets the UI render the same participant list as the Bridge roster. */
  setRosterListener(fn: RosterListener): void {
    this.rosterListener = fn;
    this.wireListeners();
  }

  getParticipantCount(): number {
    return this.participantCount;
  }

  getStatus(): FleetStatus {
    return this.status;
  }

  /** Output device / volume routing. MUST be applied before connect so the
   *  first subscribed track attaches to the user's chosen output device — the
   *  commander room is otherwise silent on a non-default playback device. */
  async applyDeviceConfig(cfg: DeviceConfig): Promise<void> {
    await this.audio.applyDeviceConfig(cfg);
  }

  setOutputMuted(muted: boolean): void {
    this.audio.setOutputMuted(muted);
  }

  setRemoteVolumes(map: Record<string, number>): void {
    this.audio.setRemoteVolumes(map);
  }

  setRemoteVolume(userId: string, pct: number): void {
    this.audio.setRemoteVolume(userId, pct);
  }

  async connect(livekitUrl: string, token: string): Promise<void> {
    await this.audio.connect(livekitUrl, token);
  }

  async disconnect(): Promise<void> {
    await this.audio.disconnect();
    this.participantCount = 0;
    this.participantsListener?.(0);
    this.setStatus("idle");
  }

  async setPttActive(active: boolean): Promise<void> {
    await this.audio.setMuted(!active);
  }

  private setStatus(status: FleetStatus, detail?: string): void {
    if (this.status !== status) {
      this.status = status;
      this.statusListener?.(status, detail);
    }
  }
}
