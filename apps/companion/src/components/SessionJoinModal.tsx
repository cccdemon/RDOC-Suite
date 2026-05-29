import { useCallback, useState } from "react";
import { Icon } from "./kit/Icon";

type Props = {
  onConfirm: (inviteToken: string) => void;
  onClose: () => void;
  error?: string | null;
  loading?: boolean;
};

export function SessionJoinModal({ onConfirm, onClose, error, loading }: Props): JSX.Element {
  const [token, setToken] = useState("");

  const handleSubmit = useCallback(() => {
    const trimmed = token.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  }, [token, onConfirm]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="cc-card modal-card cc-fade-in"
        style={{ maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="cc-card-tick"></span>
        <div className="cc-card-title">
          <span>SESSION BEITRETEN</span>
          <button type="button" className="cc-btn ghost sm" onClick={onClose}>
            <Icon.x size={12} />
          </button>
        </div>

        <p className="cc-hint" style={{ marginBottom: 12 }}>
          Invite-Token vom Admiral eingeben, um einer Session beizutreten.
        </p>

        <div className="cc-field">
          <label className="cc-label">INVITE TOKEN</label>
          <input
            type="text"
            className="cc-input"
            placeholder="Token einfügen…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            autoFocus
            disabled={loading}
          />
        </div>

        {error ? (
          <div className="cc-banner error" style={{ marginTop: 8 }}>
            <Icon.x size={12} />
            {error === "invalid_token" || error === "not_found"
              ? "Token ungültig oder abgelaufen."
              : error === "already_used"
              ? "Token wurde bereits verwendet."
              : `Fehler: ${error}`}
          </div>
        ) : null}

        <div className="cc-col" style={{ gap: 8, marginTop: 14 }}>
          <button
            type="button"
            className="cc-btn green full lg"
            disabled={!token.trim() || loading}
            onClick={handleSubmit}
          >
            {loading ? "…" : <><Icon.key size={14} /> BEITRETEN</>}
          </button>
          <button
            type="button"
            className="cc-btn ghost full"
            onClick={onClose}
            disabled={loading}
          >
            ABBRECHEN
          </button>
        </div>
      </div>
    </div>
  );
}
