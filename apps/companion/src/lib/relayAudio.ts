import { buildConfig } from "./config";
import { LivekitAudio } from "./livekit";

export type RelayStatus = "idle" | "connecting" | "connected" | "error";

type StatusListener = (status: RelayStatus, detail?: string) => void;

/**
 * Manages a secondary LiveKit connection for Voice-to-All relay.
 * Bridge mode can still fetch a publisher token from GET /relay/token via
 * connect(), but mission Relay Voice uses connectWithToken() with the
 * Fleetplanner-issued mission relay room token.
 */
export class RelayAudio {
  private audio = new LivekitAudio();
  private status: RelayStatus = "idle";
  private statusListener: StatusListener | null = null;

  setStatusListener(fn: StatusListener): void {
    this.statusListener = fn;
    this.audio.setListeners({
      status: (s, detail) => {
        const mapped: RelayStatus =
          s === "connected" ? "connected" :
          s === "connecting" ? "connecting" :
          s === "error" ? "error" : "idle";
        if (this.status !== mapped) {
          this.status = mapped;
          this.statusListener?.(mapped, detail);
        }
      },
    });
  }

  getStatus(): RelayStatus {
    return this.status;
  }

  async connect(bridgeUrl: string, bearerToken: string, guildId?: string): Promise<void> {
    const { bridgeHttpUrl } = buildConfig(bridgeUrl);
    const qs = guildId ? `?guildId=${encodeURIComponent(guildId)}` : "";
    let data: { token: string; url: string };
    try {
      const res = await fetch(`${bridgeHttpUrl}/relay/token${qs}`, {
        headers: { authorization: `Bearer ${bearerToken}` },
      });
      if (!res.ok) {
        this.setStatus("error", `relay token ${res.status}`);
        return;
      }
      data = (await res.json()) as { token: string; url: string };
    } catch {
      this.setStatus("error", "relay token fetch failed");
      return;
    }
    await this.audio.connect(data.url, data.token);
  }

  async connectWithToken(livekitUrl: string, token: string): Promise<void> {
    await this.audio.connect(livekitUrl, token);
  }

  async disconnect(): Promise<void> {
    await this.audio.disconnect();
    this.setStatus("idle");
  }

  async setPttActive(active: boolean): Promise<void> {
    await this.audio.setMuted(!active);
  }

  private setStatus(status: RelayStatus, detail?: string): void {
    if (this.status !== status) {
      this.status = status;
      this.statusListener?.(status, detail);
    }
  }
}
