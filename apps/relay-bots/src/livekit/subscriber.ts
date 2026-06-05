import {
  AudioStream,
  Room,
  RoomEvent,
  TrackKind,
  type RemoteAudioTrack,
  type AudioFrame,
} from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";

export type PcmHandler = (pcm: Buffer, speakerUserId?: string) => void;

const SUBSCRIBER_IDENTITY = "voice-relay-bot-service";
const TOKEN_TTL = 86400; // 24 h — service reconnects on expiry anyway

export class LivekitSubscriber {
  private room: Room;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  // Stored for auto-reconnect
  private livekitUrl = "";
  private apiKey = "";
  private apiSecret = "";
  private roomName = "";

  /** Active per-track reader loops, keyed by LiveKit track sid. Lets us tear a
   *  reader down on TrackUnsubscribed / ParticipantDisconnected / reconnect, so
   *  a stale loop can't keep pushing PCM — which doubled audio and overflowed
   *  the relay buffer after every reconnect/restart. */
  private readers = new Map<
    string,
    { stopped: boolean; reader: ReadableStreamDefaultReader<AudioFrame> }
  >();

  constructor(private readonly onFrame: PcmHandler) {
    this.room = new Room();
  }

  async connect(url: string, apiKey: string, apiSecret: string, roomName: string): Promise<void> {
    this.livekitUrl = url;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.roomName = roomName;

    const token = await mintToken(apiKey, apiSecret, roomName);

    this.room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (track.kind !== TrackKind.KIND_AUDIO) return;
      const audioTrack = track as RemoteAudioTrack;
      // Replace any prior reader for this track sid (dedupe on re-subscribe).
      this.stopReader(audioTrack.sid);
      this.readAudioTrack(audioTrack, speakerUserIdFromIdentity(participant.identity));
    });

    this.room.on(RoomEvent.TrackUnsubscribed, (track) => {
      this.stopReader(track.sid);
    });

    this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      for (const pub of participant.trackPublications.values()) {
        this.stopReader(pub.sid);
      }
    });

    this.room.on(RoomEvent.Disconnected, () => {
      // Kill every reader before the room object is replaced on reconnect,
      // otherwise the old loops keep pushing PCM into the mixer.
      this.stopAllReaders();
      if (this.destroyed) return;
      console.warn("[LivekitSubscriber] disconnected — reconnecting in 3 s");
      this.reconnectTimer = setTimeout(() => void this.reconnect(), 3000);
    });

    await this.room.connect(url, token);
    console.log(`[LivekitSubscriber] connected to room "${roomName}"`);
  }

  private async reconnect(): Promise<void> {
    if (this.destroyed) return;
    this.room = new Room();
    try {
      await this.connect(this.livekitUrl, this.apiKey, this.apiSecret, this.roomName);
    } catch (err) {
      console.error("[LivekitSubscriber] reconnect failed:", err);
      this.reconnectTimer = setTimeout(() => void this.reconnect(), 5000);
    }
  }

  private readAudioTrack(track: RemoteAudioTrack, speakerUserId?: string): void {
    const sid = track.sid;
    const stream = new AudioStream(track, {
      sampleRate: 48000,
      numChannels: 1,
    });
    const reader = stream.getReader();
    const handle = { stopped: false, reader };
    if (sid) this.readers.set(sid, handle);

    void (async () => {
      try {
        while (!this.destroyed && !handle.stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          this.onFrame(toStereoPcm(value), speakerUserId);
        }
      } catch (err) {
        if (!this.destroyed && !handle.stopped) {
          console.warn("[LivekitSubscriber] audio stream stopped:", err);
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // already released (e.g. cancel() in flight) — ignore
        }
        if (sid && this.readers.get(sid) === handle) this.readers.delete(sid);
      }
    })();
  }

  /** Stop + drop the reader loop for a single track sid. */
  private stopReader(sid: string | undefined): void {
    if (!sid) return;
    const h = this.readers.get(sid);
    if (!h) return;
    h.stopped = true;
    void h.reader.cancel().catch(() => undefined);
    this.readers.delete(sid);
  }

  /** Stop every active reader loop (reconnect / shutdown). */
  private stopAllReaders(): void {
    for (const h of this.readers.values()) {
      h.stopped = true;
      void h.reader.cancel().catch(() => undefined);
    }
    this.readers.clear();
  }

  async disconnect(): Promise<void> {
    this.destroyed = true;
    this.stopAllReaders();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.room.disconnect();
  }
}

function speakerUserIdFromIdentity(identity: string | undefined): string | undefined {
  if (!identity) return undefined;
  const suffix = identity.match(/^(.*)-[0-9a-f]{8}$/i);
  return suffix?.[1] || identity;
}

async function mintToken(apiKey: string, apiSecret: string, roomName: string): Promise<string> {
  const at = new AccessToken(apiKey, apiSecret, {
    identity: SUBSCRIBER_IDENTITY,
    name: "Voice Relay Bot Service",
    ttl: TOKEN_TTL,
  });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: false,
    canSubscribe: true,
    canPublishData: false,
    roomRecord: false,
  });
  return at.toJwt();
}

/**
 * Convert an AudioFrame (mono or stereo, s16le) to a stereo Buffer.
 * @discordjs/voice StreamType.Raw requires stereo 48 kHz s16le.
 */
function toStereoPcm(frame: AudioFrame): Buffer {
  const numChannels = (frame as unknown as { numChannels?: number }).numChannels ?? frame.channels ?? 1;
  const data = frame.data as Int16Array;

  if (numChannels === 2) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  // Mono → stereo: interleave each sample with itself
  const stereo = new Int16Array(data.length * 2);
  for (let i = 0; i < data.length; i++) {
    const s = data[i] ?? 0;
    stereo[i * 2] = s;
    stereo[i * 2 + 1] = s;
  }
  return Buffer.from(stereo.buffer);
}
