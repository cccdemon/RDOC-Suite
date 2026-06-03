import type { FleetStatus } from "../lib/fleetAudio";
import type { RelayStatus } from "../lib/relayAudio";
import { Icon } from "./kit/Icon";

type Props = {
  opTitle: string | null;
  /** The user's own display name, shown in mission mode (Bridge roster absent). */
  selfName: string | null;
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
  /** Global Radio (relay) connection + live PTT state, so the panel can show
   *  the same connected/SENDEN feedback as the commander block. */
  relayStatus: RelayStatus;
  relayPttActive: boolean;
  onRelayPtt: (pressed: boolean) => void;
  discordVoiceOk: boolean;
  expectedChannelName: string | null;
};

function relayDot(s: RelayStatus): string {
  if (s === "connected") return "cyan";
  if (s === "error") return "red";
  return "dim";
}

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
  relayStatus,
  relayPttActive,
  onRelayPtt,
  discordVoiceOk,
  expectedChannelName,
  selfName,
}: Props): JSX.Element {
  return (
    <div className="mission-panel">
      <div
        className="cc-banner info"
        style={{ flexDirection: "column", alignItems: "flex-start", gap: "2px" }}
      >
        <span style={{ fontWeight: 600 }}>{opTitle ?? "MISSION ACTIVE"}</span>
        {selfName ? <span className="text-dim">You: {selfName}</span> : null}
      </div>

      {!discordVoiceOk ? (
        <div className="cc-banner warn">
          Please join your advised Voice channel {expectedChannelName ?? "on Discord"} first.
        </div>
      ) : null}

      <div className="mission-rooms">
        {/* COMMANDER / Command Net (PTT-1) — only for users with a commander room */}
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
              disabled={!discordVoiceOk || commanderStatus !== "connected"}
              title={`Commander Channel · Hotkey: ${localHotkey}`}
            >
              <Icon.radio size={14} />
              {commanderPttActive ? "SENDEN" : "PTT"}
            </button>
          </div>
        ) : null}

        {/* GLOBAL RADIO / Relay Net (PTT-2). Usable → room row with PTT;
            otherwise a clean status banner (avoids cramped inline text). */}
        {discordVoiceOk && relayAvailable ? (
          <div className="mission-room">
            <div className={`mission-room-status ${relayDot(relayStatus)}`} />
            <div className="mission-room-info">
              <span className="mission-room-name">GLOBAL RADIO</span>
              <span className="mission-room-hotkey text-dim">
                {globalHotkey}
                {relayStatus === "connected" ? " · verbunden" : " · …"}
              </span>
            </div>
            <button
              type="button"
              className={`cc-btn ${relayPttActive ? "green" : relayStatus === "connected" ? "cyan" : "ghost"} mission-ptt`}
              onMouseDown={() => onRelayPtt(true)}
              onMouseUp={() => onRelayPtt(false)}
              onMouseLeave={() => { if (relayPttActive) onRelayPtt(false); }}
              disabled={relayStatus !== "connected"}
              title={`Global Radio (Discord Relay) · Hotkey: ${globalHotkey}`}
            >
              <Icon.radio size={14} />
              {relayPttActive ? "SENDEN" : "PTT"}
            </button>
          </div>
        ) : (
          <div className="cc-banner info">
            GLOBAL RADIO — {!discordVoiceOk ? "erst Discord-Voice beitreten" : "für dich nicht freigegeben"}
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
