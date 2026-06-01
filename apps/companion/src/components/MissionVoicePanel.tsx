import type { FleetStatus } from "../lib/fleetAudio";
import { Icon } from "./kit/Icon";

type Props = {
  opTitle: string | null;
  commanderStatus: FleetStatus;
  commanderPttActive: boolean;
  hasCommanderRoom: boolean;
  /** Other commanders currently in the commander room (LiveKit, excl. self). */
  commanderParticipants: number;
  onCommanderPtt: (pressed: boolean) => void;
  onDisconnect: () => void;
  /** PTT-1 hotkey — drives the commander room in mission mode. */
  localHotkey: string;
  /** PTT-2 hotkey — Discord relay (global). */
  globalHotkey: string;
  /** Whether the relay/global path is available for this user. */
  relayAvailable: boolean;
};

function statusColor(s: FleetStatus): string {
  if (s === "connected") return "cyan";
  if (s === "error") return "red";
  return "dim";
}

export function MissionVoicePanel({
  opTitle,
  commanderStatus,
  commanderPttActive,
  hasCommanderRoom,
  commanderParticipants,
  onCommanderPtt,
  onDisconnect,
  localHotkey,
  globalHotkey,
  relayAvailable,
}: Props): JSX.Element {
  return (
    <div className="mission-panel">
      <div className="mission-op-title">
        {opTitle ?? "MISSION ACTIVE"}
      </div>

      <div className="mission-rooms">
        {hasCommanderRoom ? (
          <div className="mission-room">
            <div className={`mission-room-status ${statusColor(commanderStatus)}`} />
            <div className="mission-room-info">
              <span className="mission-room-name">COMMANDER</span>
              <span className="mission-room-hotkey text-dim">
                {localHotkey}
                {commanderStatus === "connected"
                  ? ` · ${commanderParticipants + 1} im Kanal (inkl. dir)`
                  : ""}
              </span>
            </div>
            <button
              type="button"
              className={`cc-btn ${commanderPttActive ? "green" : commanderStatus === "connected" ? "cyan" : "ghost"} mission-ptt`}
              onMouseDown={() => onCommanderPtt(true)}
              onMouseUp={() => onCommanderPtt(false)}
              onMouseLeave={() => { if (commanderPttActive) onCommanderPtt(false); }}
              disabled={commanderStatus !== "connected"}
              title={`Commander Channel · Hotkey: ${localHotkey}`}
            >
              <Icon.radio size={14} />
              {commanderPttActive ? "SENDEN" : "PTT"}
            </button>
          </div>
        ) : (
          <div className="mission-room">
            <div className="mission-room-info">
              <span className="mission-room-name">GLOBAL</span>
              <span className="mission-room-hotkey text-dim">
                {relayAvailable ? globalHotkey : "—"}
              </span>
            </div>
            <span className="text-dim text-sm" style={{ alignSelf: "center" }}>
              {relayAvailable
                ? "Sprich über VOICE TO ALL (Global)"
                : "Kein Commander-Kanal — nur zuhören"}
            </span>
          </div>
        )}
      </div>

      <button
        type="button"
        className="cc-btn ghost sm mission-disconnect"
        onClick={onDisconnect}
        title="Mission Voice trennen"
      >
        <Icon.power size={12} />
        TRENNEN
      </button>
    </div>
  );
}
