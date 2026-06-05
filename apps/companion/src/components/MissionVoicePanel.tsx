import type { FleetStatus, RosterEntry } from "../lib/fleetAudio";
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
  /** Live roster of OTHER commanders (userId + speaking) — rendered like the
   *  Bridge SQUAD ROSTER so the two modes look the same. */
  commanderRoster: RosterEntry[];
  /** userId → display name for the roster (LiveKit only carries the userId). */
  commanderNames: Record<string, string>;
  /** Per-user playback levels (0..100), keyed by userId. */
  remoteVolumes: Record<string, number>;
  onRemoteVolumeChange: (userId: string, pct: number) => void;
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
  commanderRoster,
  commanderNames,
  remoteVolumes,
  onRemoteVolumeChange,
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

      {hasCommanderRoom && !discordVoiceOk ? (
        <div className="cc-banner warn">
          Command Net: please join the event channel or a unit voice channel
          {expectedChannelName ? ` (${expectedChannelName})` : ""} first.
        </div>
      ) : null}

      <div className="mission-rooms">
        {/* COMMANDER / Command Net (PTT-1) — only for users with a commander room */}
        {hasCommanderRoom ? (
          <div className="mission-room">
            <div className="mission-room-info">
              <div className={`mission-room-status ${statusColor(commanderStatus)}`} />
              <span className="mission-room-name">
                Command Net <span className="mission-room-key">({localHotkey})</span>
              </span>
              <span className="mission-room-meta text-dim">
                {commanderStatus === "connected"
                  ? `${commanderParticipants + 1} im Kanal`
                  : "…"}
              </span>
            </div>
            <button
              type="button"
              className={`cc-btn ${commanderPttActive ? "green" : commanderStatus === "connected" ? "cyan" : "ghost"} mission-ptt`}
              onMouseDown={() => onCommanderPtt(true)}
              onMouseUp={() => onCommanderPtt(false)}
              onMouseLeave={() => { if (commanderPttActive) onCommanderPtt(false); }}
              disabled={!discordVoiceOk || commanderStatus !== "connected"}
              title={`Command Net · Hotkey: ${localHotkey}`}
            >
              <Icon.radio size={14} />
              {commanderPttActive ? "SENDEN" : "PTT"}
            </button>
          </div>
        ) : null}

        {/* Commander roster — mirrors the Bridge SQUAD ROSTER so both modes
            look the same. Live LiveKit presence + speaking; per-user volume. */}
        {hasCommanderRoom && commanderStatus === "connected" ? (
          <div className="cc-card">
            <span className="cc-card-tick"></span>
            <div className="cc-card-title">
              <span>COMMANDER ROSTER</span>
              <span className="cc-badge dim">{commanderRoster.length + 1}</span>
            </div>
            <div className="cc-col" style={{ gap: 4 }}>
              {/* Self first, no slider (own track isn't played back). */}
              <div className={`cc-prow ${commanderPttActive ? "speaking" : ""}`}>
                <span className="cc-prow-tick"></span>
                <div className="cc-avatar">
                  {commanderPttActive ? <Icon.mic size={14} /> : <Icon.headphones size={14} />}
                </div>
                <div className="cc-prow-name">{selfName ?? "You"} <span className="text-dim">(du)</span></div>
                <div className="cc-prow-state">{commanderPttActive ? "TALKING" : "IDLE"}</div>
              </div>
              {commanderRoster.map((c) => {
                const vol = remoteVolumes[c.userId] ?? 100;
                return (
                  <div key={c.userId} className={`cc-prow ${c.speaking ? "speaking" : ""}`}>
                    <span className="cc-prow-tick"></span>
                    <div className="cc-avatar">
                      {c.speaking ? <Icon.mic size={14} /> : <Icon.headphones size={14} />}
                    </div>
                    <div className="cc-prow-name">{commanderNames[c.userId] ?? c.userId}</div>
                    <div className="cc-prow-vol" title={`Lautstärke ${vol}%`}>
                      <Icon.volume size={11} />
                      <input
                        type="range"
                        className="cc-range cc-range-sm"
                        min={0}
                        max={100}
                        step={5}
                        value={vol}
                        onChange={(e) => onRemoteVolumeChange(c.userId, Number(e.target.value))}
                      />
                      <span className="cc-prow-vol-val">{vol}%</span>
                    </div>
                    <div className="cc-prow-state">{c.speaking ? "TALKING" : "IDLE"}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* GLOBAL RADIO / Relay Net (PTT-2). Independent of the Commander Net
            channel gate — usable as long as the user is on the same Discord. */}
        {relayAvailable ? (
          <div className="mission-room">
            <div className="mission-room-info">
              <div className={`mission-room-status ${relayDot(relayStatus)}`} />
              <span className="mission-room-name">
                Global Radio Net : Permission Granted{" "}
                <span className="mission-room-key">({globalHotkey})</span>
              </span>
              <span className="mission-room-meta text-dim">
                {relayStatus === "connected" ? "verbunden" : "…"}
              </span>
            </div>
            <button
              type="button"
              className={`cc-btn ${relayPttActive ? "green" : relayStatus === "connected" ? "cyan" : "ghost"} mission-ptt`}
              onMouseDown={() => onRelayPtt(true)}
              onMouseUp={() => onRelayPtt(false)}
              onMouseLeave={() => { if (relayPttActive) onRelayPtt(false); }}
              disabled={relayStatus !== "connected"}
              title={`Global Radio Net · Hotkey: ${globalHotkey}`}
            >
              <Icon.radio size={14} />
              {relayPttActive ? "SENDEN" : "PTT"}
            </button>
          </div>
        ) : (
          <div className="cc-banner info">GLOBAL RADIO — für dich nicht freigegeben</div>
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
