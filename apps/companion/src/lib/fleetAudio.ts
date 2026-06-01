import { LivekitAudio } from "./livekit";

export type FleetStatus = "idle" | "connecting" | "connected" | "error";

type StatusListener = (status: FleetStatus, detail?: string) => void;

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
  private participantCount = 0;

  setStatusListener(fn: StatusListener): void {
    this.statusListener = fn;
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
    });
  }

  /** Number of OTHER participants in the room (excludes self). */
  setParticipantsListener(fn: (count: number) => void): void {
    this.participantsListener = fn;
  }

  getParticipantCount(): number {
    return this.participantCount;
  }

  getStatus(): FleetStatus {
    return this.status;
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
