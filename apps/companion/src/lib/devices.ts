/** Audio I/O device enumeration for the settings modal.
 *
 *  The browser's enumerateDevices() returns devices with EMPTY labels
 *  until the user has granted mic permission. We auto-prompt for it
 *  when ensureDevicePermission() is called, so the settings modal can
 *  show readable names. The permission tracks for the lifetime of the
 *  WebView2 origin — a fresh `tauri:dev` may re-prompt; the installed
 *  EXE remembers once granted. */

export type AudioDevice = {
  deviceId: string;
  label: string;
  /** Browser-internal grouping (e.g. headset that pairs an input + output). */
  groupId: string;
};

export type EnumeratedDevices = {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
  /** True when the platform supports per-element output routing
   *  (HTMLAudioElement.setSinkId). Chromium / WebView2 = true; older
   *  Firefox / iOS Safari = false. UI grays out the output dropdown
   *  in the false case. */
  outputSelectable: boolean;
};

const EMPTY: EnumeratedDevices = { inputs: [], outputs: [], outputSelectable: false };

/** Trigger the mic-permission prompt if it hasn't been granted yet.
 *  Resolves on grant, rejects with the underlying error on denial. We
 *  immediately stop the tracks we got — we only wanted the permission
 *  side-effect so enumerateDevices() returns labels. */
export async function ensureDevicePermission(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}

export async function enumerateAudioDevices(): Promise<EnumeratedDevices> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) return EMPTY;
  const all = await navigator.mediaDevices.enumerateDevices();
  const inputs: AudioDevice[] = [];
  const outputs: AudioDevice[] = [];
  for (const d of all) {
    if (d.kind === "audioinput") {
      inputs.push({ deviceId: d.deviceId, label: d.label || "Unbekanntes Mikrofon", groupId: d.groupId });
    } else if (d.kind === "audiooutput") {
      outputs.push({ deviceId: d.deviceId, label: d.label || "Unbekannte Ausgabe", groupId: d.groupId });
    }
  }
  const outputSelectable =
    typeof HTMLMediaElement !== "undefined" &&
    typeof (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId === "function";
  return { inputs, outputs, outputSelectable };
}
