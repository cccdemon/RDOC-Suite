/** Synthesized PTT / squad-link sound feedback.
 *
 *  No samples bundled — every cue is a short burst of bandpass-filtered
 *  white noise with an envelope, generated live via Web Audio. Sounds
 *  like a brief radio-static click, in the same audio context as the
 *  rest of the playback.
 *
 *  Four cues:
 *    - playPttPress      → user pressed their own PTT
 *    - playPttRelease    → user released their own PTT
 *    - playIncomingStart → another commander started transmitting
 *    - playIncomingStop  → another commander stopped transmitting
 *
 *  Volume + on/off come from the persisted Settings store; the App
 *  applies them via setEnabled / setVolume on mount and on save.
 */

/** The four feedback cues. Only `press` / `release` are user-customisable
 *  for now; incoming cues stay synthesized. */
export type FeedbackCue = "press" | "release" | "incomingStart" | "incomingStop";

type BurstShape = {
  /** Linear ramp-up time (seconds). */
  attack: number;
  /** Sustain time at peak (seconds). */
  sustain: number;
  /** Linear ramp-down time (seconds). */
  release: number;
  /** Center frequency of the bandpass — lower = bassier "thump",
   *  higher = sharper "click". */
  centerHz: number;
  /** Bandpass Q — higher = narrower band, more tonal. */
  qFactor: number;
  /** Peak gain 0..1 BEFORE the global volume slider applies. */
  peakGain: number;
};

class FeedbackAudio {
  private ctx: AudioContext | null = null;
  private enabled = true;
  /** Auto-suppressed while the user is output-muted: if you can't
   *  hear the other commanders, you don't want a chirp telling you
   *  they're talking either. Separate from `enabled` so the user's
   *  "feedback sounds on" setting isn't clobbered. */
  private suppressed = false;
  /** 0..1, post-multiplied onto every burst's peakGain. */
  private volume = 0.5;
  /** User-supplied samples, per cue. When a cue has one, it plays instead
   *  of the synthesized burst. Decoded once via setCustomSound. */
  private customBuffers: Partial<Record<FeedbackCue, AudioBuffer>> = {};

  /** Install (or clear) a custom sample for a cue. Pass the raw encoded
   *  file bytes (mp3/wav/ogg/flac/…) and they're decoded via the shared
   *  AudioContext; pass null to drop back to the synthesized burst.
   *  decodeAudioData works on a suspended context (no user gesture needed),
   *  so this is safe to call at startup. Returns the decoded duration in
   *  seconds for the caller to validate / display, or throws on a format
   *  the WebView can't decode. */
  async setCustomSound(cue: FeedbackCue, bytes: ArrayBuffer | null): Promise<number | null> {
    if (bytes === null) {
      delete this.customBuffers[cue];
      return null;
    }
    const ctx = this.getContext();
    // decodeAudioData detaches the ArrayBuffer; callers must pass a copy
    // if they need to reuse it.
    const buffer = await ctx.decodeAudioData(bytes);
    this.customBuffers[cue] = buffer;
    return buffer.duration;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Sync with the output-mute state. Called from App.tsx whenever
   *  the user toggles output-mute or loads the persisted state. */
  setSuppressed(suppressed: boolean): void {
    this.suppressed = suppressed;
  }

  /** Accepts the 0..100 percent from the Settings UI. */
  setVolumePct(pct: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    this.volume = clamped / 100;
  }

  private getContext(): AudioContext {
    if (!this.ctx) {
      // Defer creating the AudioContext until the first cue —
      // Chromium / WebView2 only allow it after a user gesture, and
      // the first PTT press counts as that gesture.
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private playBurst(shape: BurstShape): void {
    if (!this.enabled || this.suppressed || this.volume === 0) return;
    const ctx = this.getContext();
    const now = ctx.currentTime;
    const total = shape.attack + shape.sustain + shape.release;

    // White-noise source.
    const sampleCount = Math.max(1, Math.floor(ctx.sampleRate * total));
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    // Bandpass to shape the noise into something radio-like.
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = shape.centerHz;
    filter.Q.value = shape.qFactor;

    // ADR envelope.
    const gain = ctx.createGain();
    const peak = shape.peakGain * this.volume;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + shape.attack);
    gain.gain.setValueAtTime(peak, now + shape.attack + shape.sustain);
    gain.gain.linearRampToValueAtTime(0, now + total);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + total + 0.02);
  }

  /** Play a user-supplied sample through the volume gate. Same enabled/
   *  suppressed/volume rules as the synthesized bursts. */
  private playCustom(buffer: AudioBuffer): void {
    if (!this.enabled || this.suppressed || this.volume === 0) return;
    const ctx = this.getContext();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = this.volume;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  }

  /** Own PTT pressed: custom sample if set, else a sharp tonal click. */
  playPttPress(): void {
    if (this.customBuffers.press) {
      this.playCustom(this.customBuffers.press);
      return;
    }
    this.playBurst({
      attack: 0.005,
      sustain: 0.05,
      release: 0.04,
      centerHz: 1800,
      qFactor: 2.5,
      peakGain: 0.45,
    });
  }

  /** Own PTT released: custom sample if set, else a lower, softer tail-out. */
  playPttRelease(): void {
    if (this.customBuffers.release) {
      this.playCustom(this.customBuffers.release);
      return;
    }
    this.playBurst({
      attack: 0.02,
      sustain: 0.03,
      release: 0.08,
      centerHz: 900,
      qFactor: 2,
      peakGain: 0.3,
    });
  }

  /** Remote commander started talking: gentle higher-pitched ramp-up. */
  playIncomingStart(): void {
    this.playBurst({
      attack: 0.03,
      sustain: 0.04,
      release: 0.05,
      centerHz: 2200,
      qFactor: 3,
      peakGain: 0.28,
    });
  }

  /** Remote commander stopped talking: gentle lower ramp-down. */
  playIncomingStop(): void {
    this.playBurst({
      attack: 0.04,
      sustain: 0.03,
      release: 0.08,
      centerHz: 1100,
      qFactor: 3,
      peakGain: 0.22,
    });
  }
}

export const feedbackAudio = new FeedbackAudio();
