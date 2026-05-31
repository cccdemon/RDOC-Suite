import { useState } from "react";

type Props = {
  onApply: (token: string, url: string) => void;
  onClose: () => void;
};

function parseFleetVoiceLink(raw: string): { token: string; url: string } | null {
  try {
    const normalized = raw.trim().replace(/^dccc:\/\//, "https://dccc.local/");
    const u = new URL(normalized);
    if (!u.pathname.startsWith("/fleet-voice") && !u.hostname.includes("fleet-voice")) {
      // also accept raw query string without host check
    }
    const token = u.searchParams.get("token");
    const url = u.searchParams.get("url");
    if (!token || !url) return null;
    return { token, url };
  } catch {
    return null;
  }
}

export function MissionLinkModal({ onApply, onClose }: Props): JSX.Element {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (): void => {
    const parsed = parseFleetVoiceLink(value);
    if (!parsed) {
      setError("Ungültiger Link. Erwartet: dccc://fleet-voice?token=...&url=...");
      return;
    }
    setError(null);
    onApply(parsed.token, parsed.url);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">MISSION VOICE LINK EINFÜGEN</div>
        <p className="text-dim text-sm" style={{ marginBottom: "1rem" }}>
          Füge den dccc://fleet-voice?… Link ein, den dir der Flottenleitende geschickt hat.
        </p>
        <textarea
          className="modal-input text-mono"
          rows={3}
          placeholder="dccc://fleet-voice?token=...&url=..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ width: "100%", fontSize: ".75rem", padding: ".4rem" }}
          autoFocus
        />
        {error ? <div className="text-sm" style={{ color: "var(--cc-red)", marginTop: ".4rem" }}>{error}</div> : null}
        <div style={{ display: "flex", gap: ".5rem", marginTop: "1rem", justifyContent: "flex-end" }}>
          <button type="button" className="cc-btn ghost sm" onClick={onClose}>Abbrechen</button>
          <button type="button" className="cc-btn cyan sm" onClick={onSubmit}>Anwenden</button>
        </div>
      </div>
    </div>
  );
}
