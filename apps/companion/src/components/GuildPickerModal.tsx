import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "./kit/Icon";
import type { SavedGuild } from "../lib/store";

type Props = {
  /** Saved server list shown in the dropdown. */
  savedGuilds: SavedGuild[];
  /** Which guild ID to pre-select in the dropdown (last-used). */
  lastGuildId?: string;
  /** Bridge URL — passed to the warning when empty so the user knows
   *  they need Settings first. */
  bridgeUrlConfigured: boolean;
  /** User clicked VERBINDEN with a valid Snowflake. The picker has
   *  already persisted savedGuilds if the user chose to remember. */
  onConfirm: (guildId: string) => void | Promise<void>;
  /** User clicked the remove icon next to a saved guild. The picker
   *  expects the new list back; passes it to the store update. */
  onRemoveSaved: (next: SavedGuild[]) => void | Promise<void>;
  /** User saved or updated a guild (label edit or "save for later"
   *  checkbox). The picker expects the new list back. */
  onUpsertSaved: (next: SavedGuild[]) => void | Promise<void>;
  onClose: () => void;
};

const MANUAL_KEY = "__manual__";
const SNOWFLAKE = /^[0-9]{17,20}$/;

export function GuildPickerModal({
  savedGuilds,
  lastGuildId,
  bridgeUrlConfigured,
  onConfirm,
  onRemoveSaved,
  onUpsertSaved,
  onClose,
}: Props): JSX.Element {
  const initialPick =
    lastGuildId && savedGuilds.some((g) => g.id === lastGuildId)
      ? lastGuildId
      : savedGuilds[0]?.id ?? MANUAL_KEY;

  const [selected, setSelected] = useState<string>(initialPick);
  const [manualId, setManualId] = useState<string>("");
  const [manualLabel, setManualLabel] = useState<string>("");
  const [remember, setRemember] = useState<boolean>(true);
  const [manageMode, setManageMode] = useState<boolean>(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const manualMode = selected === MANUAL_KEY;
  const resolvedGuildId = manualMode ? manualId.trim() : selected;
  const isValid = SNOWFLAKE.test(resolvedGuildId);

  const onSubmit = useCallback(async () => {
    if (!isValid) return;
    if (manualMode && remember) {
      const label = manualLabel.trim() || undefined;
      const exists = savedGuilds.find((g) => g.id === resolvedGuildId);
      const next: SavedGuild[] = exists
        ? savedGuilds.map((g) => (g.id === resolvedGuildId ? { id: g.id, label: label ?? g.label } : g))
        : [...savedGuilds, { id: resolvedGuildId, ...(label ? { label } : {}) }];
      await onUpsertSaved(next);
    }
    await onConfirm(resolvedGuildId);
  }, [isValid, manualMode, remember, manualLabel, resolvedGuildId, savedGuilds, onUpsertSaved, onConfirm]);

  const onRemoveOne = useCallback(
    async (id: string) => {
      await onRemoveSaved(savedGuilds.filter((g) => g.id !== id));
      if (selected === id) setSelected(savedGuilds[0]?.id ?? MANUAL_KEY);
    },
    [savedGuilds, onRemoveSaved, selected],
  );

  const formatOptionLabel = useMemo(
    () => (g: SavedGuild) => (g.label ? `${g.label} · ${g.id}` : g.id),
    [],
  );

  return (
    <div className="cc-modal-backdrop" onClick={onClose}>
      <div className="cc-modal cc-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="cc-modal-title">
          SERVER WÄHLEN<span className="sep"> // </span><em>GUILD</em>
        </div>

        {!bridgeUrlConfigured ? (
          <div className="cc-banner warn">
            <Icon.x size={12} />
            Keine Bridge-URL gesetzt. Öffne erst die Einstellungen.
          </div>
        ) : null}

        {!manageMode ? (
          <>
            {savedGuilds.length > 0 ? (
              <div className="cc-field">
                <label className="cc-label" htmlFor="guild-pick">Gespeicherte Server</label>
                <select
                  id="guild-pick"
                  className="cc-select-native"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {savedGuilds.map((g) => (
                    <option key={g.id} value={g.id}>{formatOptionLabel(g)}</option>
                  ))}
                  <option value={MANUAL_KEY}>— Neue Server-ID eingeben —</option>
                </select>
              </div>
            ) : null}

            {manualMode || savedGuilds.length === 0 ? (
              <>
                <div className="cc-field" style={{ marginTop: savedGuilds.length === 0 ? 0 : 10 }}>
                  <label className="cc-label" htmlFor="manual-id">Discord-Server-ID</label>
                  <input
                    id="manual-id"
                    className="cc-input mono"
                    type="text"
                    placeholder="z.B. 1507108854071169117"
                    value={manualId}
                    onChange={(e) => setManualId(e.target.value)}
                    autoComplete="off"
                    inputMode="numeric"
                  />
                  <span className="cc-hint">
                    Rechtsklick auf den Server in Discord (Developer-Mode an) → „ID kopieren".
                  </span>
                </div>

                <div className="cc-field" style={{ marginTop: 10 }}>
                  <label className="cc-label" htmlFor="manual-label">Label (optional)</label>
                  <input
                    id="manual-label"
                    className="cc-input"
                    type="text"
                    placeholder="z.B. RDOC Mainserver"
                    value={manualLabel}
                    onChange={(e) => setManualLabel(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <label
                  className="cc-row"
                  style={{ gap: 8, marginTop: 6, cursor: "pointer", userSelect: "none" }}
                >
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    style={{ cursor: "pointer" }}
                  />
                  <span className="cc-label" style={{ margin: 0 }}>Für später speichern</span>
                </label>
              </>
            ) : null}

            {savedGuilds.length > 0 ? (
              <button
                type="button"
                className="cc-btn ghost sm"
                style={{ alignSelf: "flex-start" }}
                onClick={() => setManageMode(true)}
              >
                <Icon.settings size={11} />
                LISTE VERWALTEN
              </button>
            ) : null}
          </>
        ) : (
          <>
            <div className="cc-card-title"><span>GESPEICHERTE SERVER</span></div>
            {savedGuilds.length === 0 ? (
              <span className="cc-hint">— keine —</span>
            ) : (
              <div className="cc-col" style={{ gap: 6 }}>
                {savedGuilds.map((g) => (
                  <div key={g.id} className="cc-prow" style={{ padding: "6px 10px" }}>
                    <div className="cc-prow-name" style={{ fontSize: 12 }}>
                      {g.label ? <strong>{g.label}</strong> : <em style={{ color: "var(--dim)" }}>(ohne Label)</em>}
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--dim)" }}>{g.id}</div>
                    </div>
                    <button
                      type="button"
                      className="cc-btn red sm"
                      onClick={() => onRemoveOne(g.id)}
                      title="Aus Liste entfernen"
                    >
                      <Icon.x size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="cc-btn ghost sm"
              style={{ alignSelf: "flex-start" }}
              onClick={() => setManageMode(false)}
            >
              ZURÜCK
            </button>
          </>
        )}

        <div className="cc-modal-actions">
          <button type="button" className="cc-btn ghost" onClick={onClose}>
            ABBRECHEN
          </button>
          {!manageMode ? (
            <button
              type="button"
              className="cc-btn green"
              onClick={onSubmit}
              disabled={!isValid || !bridgeUrlConfigured}
              title={
                !bridgeUrlConfigured
                  ? "Erst Bridge-URL in den Einstellungen setzen"
                  : !isValid
                    ? "Snowflake-Format: 17–20 Ziffern"
                    : "Verbinden"
              }
            >
              <Icon.key size={12} />
              VERBINDEN
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
