import type { FleetStatus } from "../lib/fleetAudio";
import { Icon } from "./kit/Icon";

type Props = {
  opTitle: string | null;
  commanderStatus: FleetStatus;
  globalStatus: FleetStatus;
  commanderPttActive: boolean;
  globalPttActive: boolean;
  hasCommanderRoom: boolean;
  onCommanderPtt: (pressed: boolean) => void;
  onGlobalPtt: (pressed: boolean) => void;
  onDisconnect: () => void;
  commanderHotkey: string;
  globalHotkey: string;
};

function statusColor(s: FleetStatus): string {
  if (s === "connected") return "cyan";
  if (s === "error") return "red";
  return "dim";
}

export function MissionVoicePanel({
  opTitle,
  commanderStatus,
  globalStatus,
  commanderPttActive,
  globalPttActive,
  hasCommanderRoom,
  onCommanderPtt,
  onGlobalPtt,
  onDisconnect,
  commanderHotkey,
  globalHotkey,
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
              <span className="mission-room-hotkey text-dim">{commanderHotkey}</span>
            </div>
            <button
              type="button"
              className={`cc-btn ${commanderPttActive ? "green" : commanderStatus === "connected" ? "cyan" : "ghost"} mission-ptt`}
              onMouseDown={() => onCommanderPtt(true)}
              onMouseUp={() => onCommanderPtt(false)}
              onMouseLeave={() => { if (commanderPttActive) onCommanderPtt(false); }}
              disabled={commanderStatus !== "connected"}
              title={`Commander Channel · Hotkey: ${commanderHotkey}`}
            >
              <Icon.radio size={14} />
              {commanderPttActive ? "SENDEN" : "PTT"}
            </button>
          </div>
        ) : null}

        <div className="mission-room">
          <div className={`mission-room-status ${statusColor(globalStatus)}`} />
          <div className="mission-room-info">
            <span className="mission-room-name">GLOBAL</span>
            <span className="mission-room-hotkey text-dim">{globalHotkey}</span>
          </div>
          <button
            type="button"
            className={`cc-btn ${globalPttActive ? "green" : globalStatus === "connected" ? "cyan" : "ghost"} mission-ptt`}
            onMouseDown={() => onGlobalPtt(true)}
            onMouseUp={() => onGlobalPtt(false)}
            onMouseLeave={() => { if (globalPttActive) onGlobalPtt(false); }}
            disabled={globalStatus !== "connected"}
            title={`Global Channel · Hotkey: ${globalHotkey}`}
          >
            <Icon.radio size={14} />
            {globalPttActive ? "SENDEN" : "PTT"}
          </button>
        </div>
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
