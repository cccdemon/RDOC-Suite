import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Icon } from "./kit/Icon";
import { HotkeyCapture } from "./HotkeyCapture";
import { buildConfig } from "../lib/config";
import {
  enumerateAudioDevices,
  ensureDevicePermission,
  type EnumeratedDevices,
} from "../lib/devices";
import {
  MAX_PTT_SOUND_BYTES,
  MAX_PTT_SOUND_SECONDS,
  type PttSoundSlot,
} from "../lib/store";

/** Read a File into a `data:…;base64,…` URL (self-contained, persistable). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

export type SettingsDraft = {
  bridgeUrl: string;
  fleetplannerUrl: string;
  /** PTT-1 (LOCAL): bridge w/o mission, commander room with mission. */
  localHotkey: string;
  /** PTT-2 (GLOBAL): Discord relay. */
  globalHotkey: string;
  micDeviceId?: string;
  outputDeviceId?: string;
  outputVolumePct: number;
  micGainPct: number;
  feedbackSoundsEnabled: boolean;
  feedbackSoundsVolumePct: number;
  /** Custom own-PTT press/release samples. null = synthesized chirp. */
  pttPressSound: PttSoundSlot;
  pttReleaseSound: PttSoundSlot;
  duckingEnabled: boolean;
  duckingTargetVolumePct: number;
};

type Props = {
  /** Current persisted values — used as initial form state. */
  initial: SettingsDraft;
  /** Called when user clicks SAVE with valid values. */
  onSave: (next: SettingsDraft) => void | Promise<void>;
  /** Shows future Suite relay controls only for authorized users. */
  canUseRelay?: boolean;
  /** Called when user clicks CANCEL or hits Escape / clicks the backdrop. */
  onClose: () => void;
};

type TestStatus = "idle" | "testing" | "ok" | "fail";

const DEFAULT_DEVICE_KEY = "__default__";

export function SettingsModal({ initial, onSave, onClose, canUseRelay = false }: Props): JSX.Element {
  const [draft, setDraft] = useState<SettingsDraft>(initial);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testDetail, setTestDetail] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [devices, setDevices] = useState<EnumeratedDevices>({
    inputs: [],
    outputs: [],
    outputSelectable: false,
  });
  const [permState, setPermState] = useState<"unknown" | "asking" | "granted" | "denied">(
    "unknown",
  );
  const [soundError, setSoundError] = useState<string | null>(null);
  const pressInputRef = useRef<HTMLInputElement | null>(null);
  const releaseInputRef = useRef<HTMLInputElement | null>(null);

  // Validate a picked audio file (size + decodable + duration) and, if it
  // passes, store it as a self-contained data URL in the draft. Caps keep
  // settings.json small and the chirp short.
  const applyPickedSound = useCallback(
    async (cue: "press" | "release", file: File | null | undefined): Promise<void> => {
      setSoundError(null);
      if (!file) return;
      if (file.size > MAX_PTT_SOUND_BYTES) {
        setSoundError(
          `Datei zu groß: ${Math.round(file.size / 1024)} KB (max ${Math.round(
            MAX_PTT_SOUND_BYTES / 1024,
          )} KB).`,
        );
        return;
      }
      let duration: number;
      try {
        const buf = await file.arrayBuffer();
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(buf.slice(0));
        duration = decoded.duration;
        void ctx.close();
      } catch {
        setSoundError("Format nicht abspielbar. Probiere mp3, wav, ogg, flac oder m4a.");
        return;
      }
      if (duration > MAX_PTT_SOUND_SECONDS) {
        setSoundError(
          `Zu lang: ${duration.toFixed(1)} s (max ${MAX_PTT_SOUND_SECONDS} s).`,
        );
        return;
      }
      const dataUrl = await fileToDataUrl(file);
      const slot: PttSoundSlot = { name: file.name, dataUrl };
      setDraft((d) => ({
        ...d,
        ...(cue === "press" ? { pttPressSound: slot } : { pttReleaseSound: slot }),
      }));
    },
    [],
  );

  const testSound = useCallback(
    (slot: PttSoundSlot): void => {
      if (!slot) return;
      const a = new Audio(slot.dataUrl);
      a.volume = Math.max(0, Math.min(1, draft.feedbackSoundsVolumePct / 100));
      void a.play().catch(() => {});
    },
    [draft.feedbackSoundsVolumePct],
  );

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Enumerate devices when the modal opens. Labels will be empty if the
  // mic permission isn't granted yet — the "Geräte freigeben" button
  // below triggers the OS prompt + a re-enumeration.
  useEffect(() => {
    let cancelled = false;
    void enumerateAudioDevices().then((d) => {
      if (cancelled) return;
      setDevices(d);
      // If any device label is non-empty, permission is implicitly granted.
      const hasLabels = d.inputs.some((x) => x.label.length > 0);
      setPermState(hasLabels ? "granted" : "unknown");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onRequestDevicePermission = useCallback(async () => {
    setPermState("asking");
    try {
      await ensureDevicePermission();
      const d = await enumerateAudioDevices();
      setDevices(d);
      setPermState("granted");
    } catch {
      setPermState("denied");
    }
  }, []);

  const onTest = useCallback(async () => {
    const trimmed = draft.bridgeUrl.trim();
    if (!trimmed) {
      setTestStatus("fail");
      setTestDetail("URL ist leer");
      return;
    }
    setTestStatus("testing");
    setTestDetail(null);
    try {
      const { bridgeHttpUrl } = buildConfig(trimmed);
      const res = await fetch(`${bridgeHttpUrl}/health`, { method: "GET" });
      if (res.ok) {
        setTestStatus("ok");
        setTestDetail("Bridge antwortet");
      } else {
        setTestStatus("fail");
        setTestDetail(`HTTP ${res.status}`);
      }
    } catch (err) {
      setTestStatus("fail");
      setTestDetail(String(err));
    }
  }, [draft.bridgeUrl]);

  const onSubmit = useCallback(async () => {
    const trimmed = draft.bridgeUrl.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSave({
        ...draft,
        bridgeUrl: trimmed,
        localHotkey: draft.localHotkey.trim() || initial.localHotkey,
        globalHotkey: draft.globalHotkey.trim() || initial.globalHotkey,
      });
    } finally {
      setSaving(false);
    }
  }, [draft, initial.localHotkey, initial.globalHotkey, onSave]);

  const needPerm = permState !== "granted" && (devices.inputs.length === 0 || !devices.inputs[0]?.label);

  const renderSoundRow = (
    cue: "press" | "release",
    label: string,
    slot: PttSoundSlot,
    inputRef: RefObject<HTMLInputElement>,
  ): JSX.Element => (
    <div className="cc-field" style={{ marginTop: 10 }}>
      <label className="cc-label">{label}</label>
      <div className="cc-row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span
          className="cc-hint"
          style={{
            textTransform: "none",
            marginRight: "auto",
            maxWidth: 230,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {slot ? slot.name : "Standard (synthetisch)"}
        </span>
        <button type="button" className="cc-btn ghost sm" onClick={() => inputRef.current?.click()}>
          Auswählen…
        </button>
        <button type="button" className="cc-btn cyan sm" disabled={!slot} onClick={() => testSound(slot)}>
          Test
        </button>
        <button
          type="button"
          className="cc-btn ghost sm"
          disabled={!slot}
          onClick={() =>
            setDraft((d) => ({
              ...d,
              ...(cue === "press" ? { pttPressSound: null } : { pttReleaseSound: null }),
            }))
          }
        >
          Zurücksetzen
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        style={{ display: "none" }}
        onChange={(e) => {
          void applyPickedSound(cue, e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );

  return (
    <div className="cc-modal-backdrop" onClick={onClose}>
      <div className="cc-modal cc-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="cc-modal-title">
          EINSTELLUNGEN<span className="sep"> // </span><em>VERBINDUNG + AUDIO</em>
        </div>

        {/* ── Bridge URL ─────────────────────────────────── */}
        <div className="cc-field">
          <label className="cc-label" htmlFor="bridge-url">Bridge-URL</label>
          <input
            id="bridge-url"
            className="cc-input mono"
            type="text"
            placeholder="https://commander.example.org/dccc"
            value={draft.bridgeUrl}
            onChange={(e) => {
              setDraft((d) => ({ ...d, bridgeUrl: e.target.value }));
              setTestStatus("idle");
              setTestDetail(null);
            }}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="cc-hint">
            Origin der Bridge — inkl. Protokoll und ggf. /pfad-präfix. Trailing slash optional.
          </span>
          <div className="cc-row" style={{ marginTop: 4 }}>
            <button type="button" className="cc-btn cyan sm" onClick={onTest} disabled={testStatus === "testing"}>
              {testStatus === "testing" ? <Icon.loader size={12} className="cc-spin" /> : <Icon.wifi size={12} />}
              {testStatus === "testing" ? "TESTE..." : "VERBINDUNG TESTEN"}
            </button>
            {testStatus === "ok" ? <span className="cc-badge green"><Icon.check size={10} />OK</span> : null}
            {testStatus === "fail" ? <span className="cc-badge red"><Icon.x size={10} />FEHLER</span> : null}
            {testDetail ? <span className="cc-hint">{testDetail}</span> : null}
          </div>
        </div>

        {/* ── Mission / Fleetplanner URL ─────────────────── */}
        <div className="cc-field">
          <label className="cc-label" htmlFor="fleetplanner-url">Mission/Fleetplanner-URL</label>
          <input
            id="fleetplanner-url"
            className="cc-input mono"
            type="text"
            placeholder="https://suite.raumdock.org/fleetplanner"
            value={draft.fleetplannerUrl}
            onChange={(e) => setDraft((d) => ({ ...d, fleetplannerUrl: e.target.value }))}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="cc-hint">
            Fleetplanner-Origin — Default für Mission-Links. Leer lassen wenn nicht genutzt.
          </span>
        </div>

        {/* ── PTT-1 (LOCAL) ──────────────────────────────── */}
        <div className="cc-field">
          <label className="cc-label">PTT-Hotkey (Lokal)</label>
          <HotkeyCapture
            value={draft.localHotkey}
            onChange={(v) => setDraft((d) => ({ ...d, localHotkey: v }))}
          />
          <span className="cc-hint">
            Sprechtaste für deinen lokalen Kanal — ohne Mission die Bridge (Squad Link),
            mit aktiver Mission der Commander-Kanal. Mouse4 / Mouse5 = Seitentasten an
            Gaming-Mäusen. Esc bricht ab.
          </span>
        </div>

        {/* ── PTT-2 (GLOBAL / Relay) ─────────────────────── */}
        {canUseRelay ? (
          <div className="cc-field">
            <label className="cc-label">PTT-Hotkey (Global / Voice-to-All)</label>
            <HotkeyCapture
              value={draft.globalHotkey}
              onChange={(v) => setDraft((d) => ({ ...d, globalHotkey: v }))}
            />
            <span className="cc-hint">
              Sprechtaste für den Discord-Relay-Kanal (Global). Sichtbar nur, wenn dein
              Server Voice-to-All freigeschaltet hat.
            </span>
          </div>
        ) : null}

        {/* ── Audio: Devices + Volume ────────────────────── */}
        <div className="cc-card" style={{ padding: "12px 14px", marginTop: 4 }}>
          <span className="cc-card-tick"></span>
          <div className="cc-card-title"><span>AUDIO // I/O</span></div>

          {needPerm ? (
            <div className="cc-banner warn" style={{ marginBottom: 10 }}>
              <Icon.mic size={12} />
              Mikrofon-Berechtigung fehlt — ohne sie kann die Companion keine Geräte­namen anzeigen.
              <button
                type="button"
                className="cc-btn cyan sm"
                style={{ marginLeft: "auto" }}
                onClick={onRequestDevicePermission}
                disabled={permState === "asking"}
              >
                {permState === "asking" ? <Icon.loader size={11} className="cc-spin" /> : <Icon.check size={11} />}
                GERÄTE FREIGEBEN
              </button>
            </div>
          ) : null}

          {permState === "denied" ? (
            <div className="cc-banner error" style={{ marginBottom: 10 }}>
              <Icon.x size={12} />
              Berechtigung verweigert — in den Windows-Einstellungen für „RDCC" zulassen, dann
              Companion neu starten.
            </div>
          ) : null}

          <div className="cc-field">
            <label className="cc-label" htmlFor="mic-device">Mikrofon</label>
            <select
              id="mic-device"
              className="cc-select-native"
              value={draft.micDeviceId ?? DEFAULT_DEVICE_KEY}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  micDeviceId: e.target.value === DEFAULT_DEVICE_KEY ? undefined : e.target.value,
                }))
              }
            >
              <option value={DEFAULT_DEVICE_KEY}>System-Standard</option>
              {devices.inputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          </div>

          <div className="cc-field" style={{ marginTop: 10 }}>
            <label className="cc-label" htmlFor="out-device">
              Ausgabe
              {!devices.outputSelectable ? (
                <span className="cc-hint" style={{ marginLeft: 8, textTransform: "none" }}>
                  — Plattform unterstützt keine Auswahl, OS-Standard wird genutzt
                </span>
              ) : null}
            </label>
            <select
              id="out-device"
              className="cc-select-native"
              disabled={!devices.outputSelectable}
              value={draft.outputDeviceId ?? DEFAULT_DEVICE_KEY}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  outputDeviceId: e.target.value === DEFAULT_DEVICE_KEY ? undefined : e.target.value,
                }))
              }
            >
              <option value={DEFAULT_DEVICE_KEY}>System-Standard</option>
              {devices.outputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          </div>

          <div className="cc-field" style={{ marginTop: 14 }}>
            <label className="cc-label">
              Ausgabe-Lautstärke <span style={{ color: "var(--cyan)", marginLeft: 6 }}>{draft.outputVolumePct} %</span>
            </label>
            <input
              type="range"
              className="cc-range"
              min={0}
              max={100}
              step={1}
              value={draft.outputVolumePct}
              onChange={(e) => setDraft((d) => ({ ...d, outputVolumePct: Number(e.target.value) }))}
            />
          </div>

          {/* Mic-Gain slider removed: the Web Audio pipeline that
              powered it silenced published audio in WebView2. Browser
              AGC (autoGainControl: true on the LiveKit capture) now
              handles level normalisation automatically. A proper
              user-controllable gain will return via a Rust-side mic
              capture (cpal) → processed track → LiveKit publish path. */}

          {/* ── Feedback sounds (Etappe 3.1) ────────────────── */}
          <div className="cc-field" style={{ marginTop: 14 }}>
            <label className="cc-label">
              <input
                type="checkbox"
                checked={draft.feedbackSoundsEnabled}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, feedbackSoundsEnabled: e.target.checked }))
                }
                style={{ marginRight: 6, verticalAlign: "middle" }}
              />
              Funk-Sounds (PTT-Klicks + eingehendes Funkrauschen)
            </label>
            <span className="cc-hint">
              Kurzer Funkrauschen-Sound beim Drücken/Loslassen der PTT-Taste und wenn ein anderer Commander zu reden anfängt.
            </span>
          </div>

          <div className="cc-field" style={{ marginTop: 10 }}>
            <label className="cc-label">
              Funk-Sounds Lautstärke{" "}
              <span style={{ color: "var(--cyan)", marginLeft: 6 }}>{draft.feedbackSoundsVolumePct} %</span>
            </label>
            <input
              type="range"
              className="cc-range"
              min={0}
              max={100}
              step={5}
              value={draft.feedbackSoundsVolumePct}
              disabled={!draft.feedbackSoundsEnabled}
              onChange={(e) =>
                setDraft((d) => ({ ...d, feedbackSoundsVolumePct: Number(e.target.value) }))
              }
            />
          </div>

          {/* ── Custom PTT sounds ──────────────────────────── */}
          <div className="cc-field" style={{ marginTop: 14 }}>
            <label className="cc-label">Eigene PTT-Sounds</label>
            <span className="cc-hint">
              Ersetze die synthetischen Funk-Klicks beim Drücken/Loslassen durch eigene Dateien.
              Eingehendes Funkrauschen bleibt synthetisch. Max{" "}
              {Math.round(MAX_PTT_SOUND_BYTES / 1024)} KB, {MAX_PTT_SOUND_SECONDS} s. Lautstärke +
              An/Aus folgen den Funk-Sound-Reglern oben.
            </span>
          </div>
          {renderSoundRow("press", "PTT drücken", draft.pttPressSound, pressInputRef)}
          {renderSoundRow("release", "PTT loslassen", draft.pttReleaseSound, releaseInputRef)}
          {soundError ? (
            <div className="cc-banner error" style={{ marginTop: 8 }}>
              <Icon.x size={12} />
              {soundError}
            </div>
          ) : null}

          {/* ── Discord-Ducking (Etappe 3.2) ───────────────── */}
          <div className="cc-field" style={{ marginTop: 14 }}>
            <label className="cc-label">
              <input
                type="checkbox"
                checked={draft.duckingEnabled}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, duckingEnabled: e.target.checked }))
                }
                style={{ marginRight: 6, verticalAlign: "middle" }}
              />
              Discord automatisch leiser stellen
            </label>
            <span className="cc-hint">
              Solange du selbst per PTT sprichst ODER ein anderer Commander über die Bridge funkt, wird die Discord-Lautstärke abgesenkt — damit der Funk besser durchkommt. Wenn keine Squad-Audio mehr aktiv ist, geht Discord auf den vorherigen Pegel zurück.
            </span>
          </div>

          <div className="cc-field" style={{ marginTop: 10 }}>
            <label className="cc-label">
              Discord-Lautstärke während Funk{" "}
              <span style={{ color: "var(--cyan)", marginLeft: 6 }}>{draft.duckingTargetVolumePct} %</span>
            </label>
            <input
              type="range"
              className="cc-range"
              min={0}
              max={100}
              step={5}
              value={draft.duckingTargetVolumePct}
              disabled={!draft.duckingEnabled}
              onChange={(e) =>
                setDraft((d) => ({ ...d, duckingTargetVolumePct: Number(e.target.value) }))
              }
            />
          </div>
        </div>

        <div className="cc-modal-actions">
          <button type="button" className="cc-btn ghost" onClick={onClose} disabled={saving}>
            ABBRECHEN
          </button>
          <button
            type="button"
            className="cc-btn cyan"
            onClick={onSubmit}
            disabled={saving || !draft.bridgeUrl.trim()}
          >
            {saving ? <Icon.loader size={12} className="cc-spin" /> : <Icon.check size={12} />}
            SPEICHERN
          </button>
        </div>
      </div>
    </div>
  );
}
