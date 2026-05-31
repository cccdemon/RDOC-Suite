import { useState } from "react";
import { Icon } from "./kit/Icon";

type Props = {
  onConfirm: (livekitUrl: string, token: string, room: string, opTitle?: string) => void;
  onClose: () => void;
  error?: string | null;
};

export function FleetVoiceModal({ onConfirm, onClose, error }: Props) {
  const [raw, setRaw] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const handleConnect = () => {
    try {
      const data = JSON.parse(raw.trim()) as Record<string, unknown>;
      const livekitUrl = String(data.livekitUrl ?? "");
      const token = String(data.token ?? "");
      const room = String(data.room ?? "");
      const opTitle = data.opTitle ? String(data.opTitle) : undefined;
      if (!livekitUrl || !token) throw new Error("livekitUrl and token are required");
      setParseError(null);
      onConfirm(livekitUrl, token, room, opTitle);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid token payload");
    }
  };

  const displayError = parseError ?? error;

  return (
    <div className="cc-modal-backdrop">
      <div className="cc-modal cc-fade-in">
        <div className="cc-modal-header">
          <span>FLEET VOICE</span>
          <button type="button" className="cc-btn ghost sm" onClick={onClose}>
            <Icon.x size={12} />
          </button>
        </div>
        <div className="cc-modal-body">
          <p className="cc-hint" style={{ marginBottom: 10 }}>
            On the operation page, click "Get Voice Token" and paste the JSON here.
          </p>
          <textarea
            className="cc-input"
            style={{ fontFamily: "var(--font-mono)", fontSize: 11, resize: "vertical", minHeight: 80, width: "100%", boxSizing: "border-box" }}
            placeholder='{"livekitUrl":"wss://...","token":"...","room":"...","opTitle":"..."}'
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          {displayError ? (
            <div className="cc-banner error" style={{ marginTop: 8 }}>
              <Icon.x size={12} />
              {displayError}
            </div>
          ) : null}
        </div>
        <div className="cc-modal-footer">
          <button type="button" className="cc-btn ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="cc-btn green"
            onClick={handleConnect}
            disabled={!raw.trim()}
          >
            Verbinden
          </button>
        </div>
      </div>
    </div>
  );
}
